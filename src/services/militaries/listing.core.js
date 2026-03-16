import { prisma } from "#configs/prisma.config.js";
import { normalizeVietnameseSearchText } from "#utils/searchNormalizer.js";
import {
  normalizeMilitaryType,
  parseLimit,
  parsePage,
  parseSortBy,
  parseSortDirection,
  parseInteger,
  resolveScopeUnitId,
} from "#services/militaries/common.js";
import {
  buildScopeWhereCondition,
  buildYearAssignmentCondition,
  toSortableYearValue,
} from "#services/militaries/listing.shared.js";
import {
  getMilitaryRankLabel,
  resolveMilitaryRankSearchCandidates,
} from "#services/militaries/profile-reference.js";
import { hasMilitaryTransferLogTable } from "#services/militaries/transfer-log.shared.js";
import {
  analyzeAssignmentHistory,
  evaluateMilitaryUnitYearState,
} from "#services/militaries/unit-history.js";

function formatMilitaryTypesFromAssignments(assignments) {
  const types = (assignments || [])
    .map((item) => item?.type?.code)
    .filter(Boolean);

  return {
    types,
    type: types[0] || "",
    typeDisplay: types.join(", "),
  };
}

export function createMilitaryListingService({ buildMilitarySearchNormalized }) {
  let hasSearchNormalizedColumnCache = null;

  async function hasSearchNormalizedColumn() {
    if (typeof hasSearchNormalizedColumnCache === "boolean") {
      return hasSearchNormalizedColumnCache;
    }

    try {
      const rows = await prisma.$queryRawUnsafe(
        `
          SELECT COUNT(*) AS total
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'militaries'
            AND COLUMN_NAME = 'searchNormalized'
        `,
      );
      hasSearchNormalizedColumnCache = Number(rows?.[0]?.total || 0) > 0;
      return hasSearchNormalizedColumnCache;
    } catch {
      hasSearchNormalizedColumnCache = false;
      return false;
    }
  }

  async function backfillMissingSearchNormalized() {
    const hasColumn = await hasSearchNormalizedColumn();
    if (!hasColumn) return 0;

    const rows = await prisma.military.findMany({
      where: {
        deletedAt: null,
        searchNormalized: "",
      },
      take: 200,
      select: {
        id: true,
        fullname: true,
        militaryCode: true,
        rank: true,
        rankGroup: true,
        position: true,
        gender: true,
        genderCatalog: {
          select: {
            code: true,
          },
        },
        assignedUnit: true,
        typeAssignments: {
          where: {
            type: {
              deletedAt: null,
            },
          },
          select: {
            type: {
              select: {
                code: true,
              },
            },
          },
        },
        unit: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!rows.length) return 0;

    await prisma.$transaction(
      rows.map((row) => {
        const typeText = row.typeAssignments
          .map((item) => item.type?.code)
          .filter(Boolean)
          .join(" ");

        return prisma.military.update({
          where: { id: row.id },
          data: {
            searchNormalized: buildMilitarySearchNormalized({
              fullname: row.fullname,
              militaryCode: row.militaryCode,
              rank: `${row.rank} ${getMilitaryRankLabel(row.rank)}`,
              position: row.position,
              gender: row.genderCatalog?.code || row.gender,
              type: typeText,
              assignedUnit: row.assignedUnit,
              unitName: row.unit?.name,
            }),
          },
        });
      }),
    );

    return rows.length;
  }

  async function list({
    actor,
    unitId,
    type,
    year,
    search,
    sortBy,
    sortDir,
    page,
    limit,
    assuranceScope,
  }) {
    const scopeUnitId = resolveScopeUnitId(actor, unitId);
    const selectedYear = parseInteger(year, "year") || new Date().getFullYear();
    const keyword = String(search || "").trim();
    const normalizedType = type
      ? normalizeMilitaryType(type, { required: false, fieldName: "type" })
      : null;
    const selectedTypeRecord = normalizedType
      ? await prisma.militaryTypeCatalog.findFirst({
          where: {
            codeNormalized: normalizedType,
            deletedAt: null,
          },
          select: {
            id: true,
          },
        })
      : null;
    const selectedTypeId = selectedTypeRecord?.id || null;
    const keywordNormalized = normalizeVietnameseSearchText(keyword);
    const rankSearchCandidates = resolveMilitaryRankSearchCandidates(keywordNormalized);
    const normalizedSortBy = parseSortBy(sortBy);
    const direction = parseSortDirection(sortDir);
    const currentYear = new Date().getFullYear();
    const normalizedAssuranceScope = String(assuranceScope || "year")
      .trim()
      .toLowerCase();
    const useCurrentAssuranceOnly = normalizedAssuranceScope === "current";
    const currentPage = parsePage(page);
    const pageSize = parseLimit(limit);
    const skip = (currentPage - 1) * pageSize;
    if (normalizedType && !selectedTypeId) {
      return {
        year: selectedYear,
        assuranceScope: useCurrentAssuranceOnly ? "current" : "year",
        militaries: [],
        scopeUnitId,
        search: keyword,
        searchNormalized: keywordNormalized,
        sortBy: normalizedSortBy,
        sortDir: direction,
        pagination: {
          page: currentPage,
          limit: pageSize,
          total: 0,
          totalPages: 0,
        },
      };
    }
    const hasNormalizedColumn = keywordNormalized
      ? await hasSearchNormalizedColumn()
      : false;
    const hasTransferLogTable = await hasMilitaryTransferLogTable();

    if (keywordNormalized && hasNormalizedColumn) {
      await backfillMissingSearchNormalized();
    }

    const yearAssignmentCondition = buildYearAssignmentCondition({
      selectedYear,
      useCurrentAssuranceOnly,
      currentYear,
    });
    const { snapshotYear } = yearAssignmentCondition;

    const where = {
      deletedAt: null,
      ...buildScopeWhereCondition({
        scopeUnitId,
        snapshotYear,
        snapshotTypeId: selectedTypeId,
      }),
      ...(normalizedType
        ? {
            typeAssignments: {
              some: {
                type: {
                  deletedAt: null,
                  codeNormalized: normalizedType,
                },
              },
            },
          }
        : {}),
      ...(keywordNormalized
        ? hasNormalizedColumn
          ? {
              OR: [
                {
                  searchNormalized: {
                    contains: keywordNormalized,
                  },
                },
              ],
            }
          : {
              OR: [
                { fullname: { contains: keyword } },
                { militaryCode: { contains: keyword } },
                ...(rankSearchCandidates.rankCodes.length
                  ? [{ rank: { in: rankSearchCandidates.rankCodes } }]
                  : []),
                ...(rankSearchCandidates.rankGroups.length
                  ? [{ rankGroup: { in: rankSearchCandidates.rankGroups } }]
                  : []),
                { position: { contains: keyword } },
                { gender: { contains: keyword } },
                {
                  genderCatalog: {
                    is: {
                      code: { contains: keyword },
                    },
                  },
                },
                { assignedUnit: { contains: keyword } },
                {
                  typeAssignments: {
                    some: {
                      type: {
                        deletedAt: null,
                        code: {
                          contains: keyword,
                        },
                      },
                    },
                  },
                },
                {
                  unit: {
                    name: {
                      contains: keyword,
                    },
                  },
                },
              ],
            }
        : {}),
    };

    let orderBy = { fullname: direction };
    if (normalizedSortBy === "claimStatus") {
      orderBy = {
        claimedByUserId: direction,
      };
    } else if (normalizedSortBy === "assignedUnit") {
      orderBy = {
        assignedUnit: direction,
      };
    } else if (
      normalizedSortBy === "unitTransferInYear" ||
      normalizedSortBy === "unitTransferOutYear" ||
      normalizedSortBy === "type"
    ) {
      orderBy = {
        fullname: direction,
      };
    } else {
      orderBy = {
        [normalizedSortBy]: direction,
      };
    }

    const [total, militaries] = await prisma.$transaction([
      prisma.military.count({ where }),
      prisma.military.findMany({
        where,
        select: {
          id: true,
          fullname: true,
          rank: true,
          rankGroup: true,
          position: true,
          gender: true,
          genderCatalog: {
            select: {
              code: true,
            },
          },
          militaryCode: true,
          initialCommissioningYear: true,
          assignedUnit: true,
          unitId: true,
          claimedByUserId: true,
          claimedAt: true,
          importBatchId: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
          typeAssignments: {
            where: {
              type: {
                deletedAt: null,
              },
            },
            select: {
              type: {
                select: {
                  id: true,
                  code: true,
                },
              },
            },
            orderBy: {
              typeId: "asc",
            },
          },
          unit: {
            select: {
              id: true,
              name: true,
            },
          },
          militaryUnits: {
            where: {
              AND: [
                ...(selectedTypeId
                  ? [{ OR: [{ typeId: selectedTypeId }, { typeId: null }] }]
                  : []),
                ...(scopeUnitId ? [{ unitId: scopeUnitId }] : []),
              ],
            },
            include: {
              unit: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
            orderBy: [
              { typeId: "desc" },
              { transferInYear: "desc" },
              { transferOutYear: "asc" },
              { id: "desc" },
            ],
            take: scopeUnitId ? 50 : 10,
          },
          transferRequests: {
            where: {
              ...(selectedTypeId ? { typeId: selectedTypeId } : {}),
              transferYear: {
                lte: selectedYear,
              },
            },
            select: {
              id: true,
              typeId: true,
              status: true,
              fromUnitId: true,
              transferYear: true,
              toUnitId: true,
              fromUnit: {
                select: {
                  id: true,
                  name: true,
                },
              },
              toUnit: {
                select: {
                  id: true,
                  name: true,
                },
              },
              requestedAt: true,
            },
            orderBy: {
              requestedAt: "desc",
            },
            take: 5,
          },
          ...(hasTransferLogTable
            ? {
                transferLogs: {
                  where: {
                    transferYear: {
                      lte: selectedYear,
                    },
                    ...(scopeUnitId
                      ? {
                          OR: [
                            { fromUnitId: scopeUnitId },
                            { toUnitId: scopeUnitId },
                          ],
                        }
                      : {}),
                  },
                  select: {
                    id: true,
                    transferYear: true,
                    note: true,
                    fromExternalUnitName: true,
                    toExternalUnitName: true,
                    fromUnitId: true,
                    toUnitId: true,
                    fromUnit: {
                      select: {
                        id: true,
                        name: true,
                      },
                    },
                    toUnit: {
                      select: {
                        id: true,
                        name: true,
                      },
                    },
                    createdAt: true,
                  },
                  orderBy: [
                    { transferYear: "desc" },
                    { createdAt: "desc" },
                  ],
                  take: 10,
                },
              }
            : {}),
          yearlyRegistrations: {
            where: {
              year: selectedYear,
              deletedAt: null,
            },
            select: {
              id: true,
              categoryId: true,
              sizeId: true,
              category: {
                select: {
                  id: true,
                  name: true,
                  isOneSize: true,
                },
              },
              size: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
            orderBy: {
              categoryId: "asc",
            },
          },
        },
        orderBy,
        skip,
        take: pageSize,
      }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

    const mappedMilitaries = militaries
      .map((military) => {
        const assignmentHistory = Array.isArray(military.militaryUnits) ? military.militaryUnits : [];
        const assignmentAnalysis = analyzeAssignmentHistory({
          assignments: assignmentHistory,
          year: snapshotYear,
          typeId: selectedTypeId,
          scopeUnitId,
          strictEnd: true,
        });
        const currentAssignment =
          assignmentAnalysis.currentAssignment && assignmentAnalysis.currentAssignment.unit
            ? {
                transferInYear: assignmentAnalysis.currentAssignment.transferInYear,
                transferOutYear: assignmentAnalysis.currentAssignment.transferOutYear,
                unit: assignmentAnalysis.currentAssignment.unit,
              }
            : null;
        const {
          militaryUnits: _militaryUnits,
          transferRequests: _transferRequests,
          transferLogs: _transferLogs,
          ...militaryBase
        } = military;
        const typeInfo = formatMilitaryTypesFromAssignments(military.typeAssignments);
        const unitName =
          military.assignedUnit ||
          currentAssignment?.unit?.name ||
          assignmentAnalysis.latestAssignment?.unit?.name ||
          military.unit?.name;
        const yearState = evaluateMilitaryUnitYearState({
          assignments: assignmentHistory,
          transferRequests: military.transferRequests || [],
          currentYear: selectedYear,
          unitId: scopeUnitId,
          typeId: selectedTypeId,
        });
        const latestTransferRequest = military.transferRequests?.[0] || null;
        const pendingTransferRequest =
          yearState.isHasReqTransfer === "waiting" ? yearState.matchedRequest || null : null;
        const acceptedTransferRequest =
          yearState.isHasReqTransfer === "accepted" ? yearState.matchedRequest || null : null;
        const hasActiveAssignmentForRegistration = !!currentAssignment;
        const canRegisterSizes =
          hasActiveAssignmentForRegistration && yearState.isHasReqTransfer === false;
        const registrationLockReason = !hasActiveAssignmentForRegistration
          ? "TRANSFERRED_OUT"
          : yearState.isHasReqTransfer === "waiting"
            ? "PENDING_TRANSFER"
            : yearState.isHasReqTransfer === "accepted"
              ? "TRANSFER_ACCEPTED"
              : null;

        const filteredYearlyRegistrations = (military.yearlyRegistrations || []).filter(
          (item) => !item.category?.isOneSize,
        );
        const transferLogs = Array.isArray(military.transferLogs) ? military.transferLogs : [];
        const transferInDetail = transferLogs.find((item) => {
          if (!item) return false;
          if (Number(item.transferYear || 0) !== Number(currentAssignment?.transferInYear || 0)) {
            return false;
          }
          if (!currentAssignment?.unit?.id) return false;
          return Number(item.toUnitId || 0) === Number(currentAssignment.unit.id);
        }) || null;
        const transferOutDetail = transferLogs.find((item) => {
          if (!item) return false;
          if (
            Number(item.transferYear || 0) !==
            Number(assignmentAnalysis.latestTransferOutAssignment?.transferOutYear || 0)
          ) {
            return false;
          }
          if (scopeUnitId) {
            return Number(item.fromUnitId || 0) === Number(scopeUnitId);
          }
          return Boolean(item.fromUnitId || item.fromExternalUnitName);
        }) || null;

        return {
          ...militaryBase,
          rank: getMilitaryRankLabel(military.rank),
          rankCode: military.rank,
          gender: military.genderCatalog?.code || military.gender,
          ...typeInfo,
          assignedUnit: unitName,
          unitTransferInYear:
            yearState.includeAnalysis.includeAssignment?.transferInYear ||
            yearState.showAnalysis.showAssignment?.transferInYear ||
            currentAssignment?.transferInYear ||
            assignmentAnalysis.latestAssignment?.transferInYear ||
            null,
          unitTransferOutYear:
            yearState.showAnalysis.showAssignment?.transferOutYear ||
            yearState.includeAnalysis.latestTransferOutAssignment?.transferOutYear ||
            assignmentAnalysis.latestTransferOutAssignment?.transferOutYear ||
            null,
          hasHistoricalTransferOut: assignmentAnalysis.hasHistoricalTransferOut,
          isIncludeUnit: yearState.isIncludeUnit,
          isShowMilitary: yearState.isShowMilitary,
          isHasReqTransfer: yearState.isHasReqTransfer,
          canCut: yearState.canCut,
          displayStatus: yearState.displayStatus,
          yearState: {
            currentYear: yearState.currentYear,
            unitId: yearState.unitId,
            typeId: yearState.typeId,
            isIncludeUnit: yearState.isIncludeUnit,
            isShowMilitary: yearState.isShowMilitary,
            canCut: yearState.canCut,
            isHasReqTransfer: yearState.isHasReqTransfer,
            displayStatus: yearState.displayStatus,
            matchedRequest: yearState.matchedRequest
              ? {
                  id: yearState.matchedRequest.id,
                  typeId: yearState.matchedRequest.typeId,
                  status: yearState.matchedRequest.status,
                  fromUnitId: yearState.matchedRequest.fromUnitId,
                  toUnitId: yearState.matchedRequest.toUnitId,
                  transferYear: yearState.matchedRequest.transferYear,
                  requestedAt: yearState.matchedRequest.requestedAt,
                }
              : null,
            includeAnalysis: {
              hasAnyAssignment: yearState.includeAnalysis.hasAnyAssignment,
              hasHistoricalTransferOut: yearState.includeAnalysis.hasHistoricalTransferOut,
              hasTransferOutOnOrBeforeYear:
                yearState.includeAnalysis.hasTransferOutOnOrBeforeYear,
              currentAssignment: yearState.includeAnalysis.currentAssignment,
              latestAssignment: yearState.includeAnalysis.latestAssignment,
              latestTransferOutAssignment:
                yearState.includeAnalysis.latestTransferOutAssignment,
              assignments: yearState.includeAnalysis.assignments,
            },
            showAnalysis: {
              hasAnyAssignment: yearState.showAnalysis.hasAnyAssignment,
              hasHistoricalTransferOut: yearState.showAnalysis.hasHistoricalTransferOut,
              hasTransferOutOnOrBeforeYear:
                yearState.showAnalysis.hasTransferOutOnOrBeforeYear,
              currentAssignment: yearState.showAnalysis.currentAssignment,
              latestAssignment: yearState.showAnalysis.latestAssignment,
              latestTransferOutAssignment:
                yearState.showAnalysis.latestTransferOutAssignment,
              assignments: yearState.showAnalysis.assignments,
            },
          },
          transferInDetail: transferInDetail
            ? {
                id: transferInDetail.id,
                transferYear: transferInDetail.transferYear,
                note: transferInDetail.note,
                fromUnitId: transferInDetail.fromUnitId,
                toUnitId: transferInDetail.toUnitId,
                fromUnitName:
                  transferInDetail.fromUnit?.name ||
                  transferInDetail.fromExternalUnitName ||
                  null,
                toUnitName:
                  transferInDetail.toUnit?.name ||
                  transferInDetail.toExternalUnitName ||
                  null,
              }
            : null,
          transferOutDetail: transferOutDetail
            ? {
                id: transferOutDetail.id,
                transferYear: transferOutDetail.transferYear,
                note: transferOutDetail.note,
                fromUnitId: transferOutDetail.fromUnitId,
                toUnitId: transferOutDetail.toUnitId,
                fromUnitName:
                  transferOutDetail.fromUnit?.name ||
                  transferOutDetail.fromExternalUnitName ||
                  null,
                toUnitName:
                  transferOutDetail.toUnit?.name ||
                  transferOutDetail.toExternalUnitName ||
                  null,
              }
            : null,
          latestTransferRequest,
          pendingTransferRequest,
          acceptedTransferRequest,
          canRegisterSizes,
          registrationLockReason,
          yearlyRegistrations: filteredYearlyRegistrations,
          yearlySizeSummary: filteredYearlyRegistrations
            .map((item) => `${item.category.name}: ${item.size.name}`)
            .join(" | "),
        };
      })
      .sort((a, b) => {
        if (normalizedSortBy === "type") {
          const left = String(a.typeDisplay || "");
          const right = String(b.typeDisplay || "");
          if (left === right) return 0;
          return direction === "asc"
            ? left.localeCompare(right)
            : right.localeCompare(left);
        }

        if (
          normalizedSortBy !== "unitTransferInYear" &&
          normalizedSortBy !== "unitTransferOutYear"
        ) {
          return 0;
        }
        const left = toSortableYearValue({
          value: a[normalizedSortBy],
          direction,
        });
        const right = toSortableYearValue({
          value: b[normalizedSortBy],
          direction,
        });
        return direction === "asc" ? left - right : right - left;
      });

    return {
      year: selectedYear,
      assuranceScope: useCurrentAssuranceOnly ? "current" : "year",
      militaries: mappedMilitaries,
      scopeUnitId,
      search: keyword,
      searchNormalized: keywordNormalized,
      sortBy: normalizedSortBy,
      sortDir: direction,
      pagination: {
        page: currentPage,
        limit: pageSize,
        total,
        totalPages,
        hasPrev: currentPage > 1,
        hasNext: totalPages > 0 && currentPage < totalPages,
      },
      total,
    };
  }

  return {
    hasSearchNormalizedColumn,
    backfillMissingSearchNormalized,
    list,
  };
}
