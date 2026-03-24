import { prisma } from "#configs/prisma.config.js";
import { getMilitaryRankLabel } from "#services/militaries/profile-reference.js";
import { getClaimedMilitaryOrThrow } from "#services/sizeRegistrationWorkflow/common.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import { hasAnyRole } from "#src/shared/auth/roleGuards.js";

function parsePositiveYear(value, fieldName, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new AppError({
        message: `${fieldName} là bắt buộc`,
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "YEAR_REQUIRED",
      });
    }
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 3000) {
    throw new AppError({
      message: `${fieldName} không hợp lệ`,
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "INVALID_YEAR",
    });
  }

  return parsed;
}

function getActorUnitId(actor) {
  const unitId = Number.parseInt(actor?.unitId, 10);
  if (!Number.isInteger(unitId) || unitId <= 0) {
    throw new AppError({
      message: "Không xác định được đơn vị người dùng",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "INVALID_ACTOR_UNIT",
    });
  }
  return unitId;
}

function getMilitaryDisplayGender(military) {
  return String(military?.genderCatalog?.code || military?.gender || "").toUpperCase() || null;
}

function matchesYearRange({ year, transferInYear, transferOutYear }) {
  if (!Number.isInteger(Number(year))) return false;
  if (Number(year) < Number(transferInYear)) return false;
  if (transferOutYear !== null && transferOutYear !== undefined && Number(year) > Number(transferOutYear)) {
    return false;
  }
  return true;
}

function buildStandardCondition(rawCampaignContent) {
  if (!rawCampaignContent?.conditionField || !rawCampaignContent?.conditionOperator) {
    return null;
  }

  return {
    field: String(rawCampaignContent.conditionField),
    operator: String(rawCampaignContent.conditionOperator),
    issueYearOffset:
      rawCampaignContent.conditionIssueYearOffset === null ||
      rawCampaignContent.conditionIssueYearOffset === undefined
        ? null
        : Number(rawCampaignContent.conditionIssueYearOffset),
  };
}

function matchStandardCondition({ standardCondition, military, asOfYear }) {
  if (!standardCondition) return true;

  if (standardCondition.field !== "INITIAL_COMMISSIONING_YEAR") {
    return true;
  }

  const left = Number(military?.initialCommissioningYear || 0);
  const right = Number(asOfYear) + Number(standardCondition.issueYearOffset || 0);

  switch (standardCondition.operator) {
    case "GT":
      return left > right;
    case "GTE":
      return left >= right;
    case "LT":
      return left < right;
    case "LTE":
      return left <= right;
    case "EQ":
      return left === right;
    case "NEQ":
      return left !== right;
    default:
      return true;
  }
}

function matchesItemRule(rule, military) {
  if (!rule) return true;

  const expectedGender = String(rule.gender || "ANY").toUpperCase();
  if (expectedGender !== "ANY" && expectedGender !== getMilitaryDisplayGender(military)) {
    return false;
  }

  const expectedRankGroup = String(rule.rankGroup || "ANY").toUpperCase();
  const rankGroup = String(military?.rankGroup || "").toUpperCase();
  if (expectedRankGroup !== "ANY" && expectedRankGroup !== rankGroup) {
    return false;
  }

  return true;
}

function matchesServiceLifeRule(rule, military) {
  const expectedGender = String(rule?.gender || "ANY").toUpperCase();
  const expectedRankGroup = String(rule?.rankGroup || "ANY").toUpperCase();

  if (expectedGender !== "ANY" && expectedGender !== getMilitaryDisplayGender(military)) {
    return false;
  }

  const rankGroup = String(military?.rankGroup || "").toUpperCase();
  if (expectedRankGroup !== "ANY" && expectedRankGroup !== rankGroup) {
    return false;
  }

  return true;
}

function resolveServiceLifeForCategory({
  categoryId,
  military,
  rulesByCategoryId,
  fallbackServiceLifeYears = 0,
  preferredTypeId = null,
}) {
  const categoryRules = rulesByCategoryId.get(Number(categoryId)) || [];
  const typeOrder = preferredTypeId
    ? new Map([[Number(preferredTypeId), 0]])
    : new Map(
        (military?.typeAssignments || []).map((entry, index) => [Number(entry.typeId), index]),
      );

  const matchedRule = [...categoryRules]
    .filter((rule) => typeOrder.has(Number(rule.typeId)) && matchesServiceLifeRule(rule, military))
    .sort((left, right) => {
      return Number(typeOrder.get(Number(left.typeId))) - Number(typeOrder.get(Number(right.typeId)));
    })[0];

  if (!matchedRule) {
    return {
      serviceLifeYears: Number(fallbackServiceLifeYears || 0),
      appliedType: null,
      source: fallbackServiceLifeYears ? "STANDARD_DEFAULT" : "UNKNOWN",
    };
  }

  return {
    serviceLifeYears: Number(matchedRule.serviceLifeYears || 0),
    appliedType: matchedRule.type
      ? {
          id: matchedRule.type.id,
          code: matchedRule.type.code,
          name: matchedRule.type.name || null,
        }
      : null,
    source: "TYPE_RULE",
  };
}

function getComparableMilitaryFieldValue(military, field) {
  switch (field) {
    case "initialCommissioningYear":
      return Number(military?.initialCommissioningYear || 0);
    case "gender":
      return getMilitaryDisplayGender(military);
    case "rank":
      return String(military?.rank || "");
    case "rankGroup":
      return String(military?.rankGroup || "");
    case "position":
      return String(military?.position || "");
    case "assignedUnitId":
      return Number(military?.assignedUnitId || 0);
    case "assignedUnit":
      return String(military?.assignedUnit || "");
    case "militaryCode":
      return String(military?.militaryCode || "");
    case "unitId":
      return Number(military?.unitId || 0);
    default:
      return null;
  }
}

function resolveModeClauseValue(clause, issueYear) {
  if (clause.valueSource === "ISSUE_YEAR") return Number(issueYear);
  if (clause.valueSource === "CURRENT_YEAR") return new Date().getFullYear();
  return clause.value;
}

function compareModeClause(fieldValue, operator, expectedValue) {
  switch (String(operator || "EQ")) {
    case "EQ":
      return fieldValue === expectedValue;
    case "NEQ":
      return fieldValue !== expectedValue;
    case "GT":
      return Number(fieldValue) > Number(expectedValue);
    case "GTE":
      return Number(fieldValue) >= Number(expectedValue);
    case "LT":
      return Number(fieldValue) < Number(expectedValue);
    case "LTE":
      return Number(fieldValue) <= Number(expectedValue);
    case "IN":
      return Array.isArray(expectedValue) && expectedValue.includes(fieldValue);
    case "NOT_IN":
      return Array.isArray(expectedValue) && !expectedValue.includes(fieldValue);
    case "CONTAINS":
      return String(fieldValue || "").includes(String(expectedValue || ""));
    case "STARTS_WITH":
      return String(fieldValue || "").startsWith(String(expectedValue || ""));
    case "ENDS_WITH":
      return String(fieldValue || "").endsWith(String(expectedValue || ""));
    case "IS_TRUE":
      return Boolean(fieldValue) === true;
    case "IS_FALSE":
      return Boolean(fieldValue) === false;
    default:
      return false;
  }
}

function evaluateModeRuleConfig({ mode, military, issueYear }) {
  const clauses = Array.isArray(mode?.ruleConfig?.clauses) ? mode.ruleConfig.clauses : [];
  if (clauses.length === 0) {
    return { matched: true };
  }

  const clauseResults = clauses.map((clause) =>
    compareModeClause(
      getComparableMilitaryFieldValue(military, clause.field),
      clause.operator,
      resolveModeClauseValue(clause, issueYear),
    ),
  );

  const combinator = String(mode?.ruleCombinator || "ALL").toUpperCase();
  return {
    matched: combinator === "ANY" ? clauseResults.some(Boolean) : clauseResults.every(Boolean),
  };
}

function evaluateModeForMilitary({ mode, military, issueYear }) {
  const militaryTypeIds = new Set(
    (military?.typeAssignments || []).map((entry) => Number(entry.typeId || entry.type?.id || 0)),
  );
  const modeType = mode?.militaryTypes?.[0]?.type || null;
  const hasRequiredType = modeType ? militaryTypeIds.has(Number(modeType.id)) : false;
  const includedMilitaryIds = new Set(
    (mode?.includedMilitaries || []).map((entry) => String(entry.militaryId || entry.military?.id || "")),
  );
  const excludedMilitaryIds = new Set(
    (mode?.excludedMilitaries || []).map((entry) => String(entry.militaryId || entry.military?.id || "")),
  );

  const isIncluded = includedMilitaryIds.has(String(military.id));
  const isExcluded = excludedMilitaryIds.has(String(military.id));
  const ruleEvaluation = evaluateModeRuleConfig({ mode, military, issueYear });

  if (!hasRequiredType) {
    return {
      applicable: false,
      reason: "Không thuộc loại quân nhân áp dụng của chế độ",
      modeType: modeType
        ? {
            id: modeType.id,
            code: modeType.code,
            name: modeType.name || null,
          }
        : null,
    };
  }

  if (isExcluded) {
    return {
      applicable: false,
      reason: "Quân nhân nằm trong danh sách loại trừ",
      modeType: modeType
        ? {
            id: modeType.id,
            code: modeType.code,
            name: modeType.name || null,
          }
        : null,
    };
  }

  if (!ruleEvaluation.matched && !isIncluded) {
    return {
      applicable: false,
      reason: "Quân nhân không thỏa quy tắc chung của chế độ",
      modeType: modeType
        ? {
            id: modeType.id,
            code: modeType.code,
            name: modeType.name || null,
          }
        : null,
    };
  }

  return {
    applicable: true,
    reason:
      isIncluded && !ruleEvaluation.matched
        ? "Quân nhân được chỉ định áp dụng trực tiếp"
        : "Đủ điều kiện theo loại quân nhân và quy tắc",
    modeType: modeType
      ? {
          id: modeType.id,
          code: modeType.code,
          name: modeType.name || null,
        }
      : null,
  };
}

function buildStatusText({
  currentlyApplicable,
  lastIssuedYear,
  serviceLifeYears,
  nextEligibleYear,
  annualQuota,
  issuedInCurrentYear,
  remainingInCurrentYear,
  asOfYear,
}) {
  if (!currentlyApplicable) {
    return "Chưa đến điều kiện áp dụng";
  }

  if (issuedInCurrentYear > 0 && remainingInCurrentYear > 0 && Number(lastIssuedYear) === Number(asOfYear)) {
    return `Đang cấp dở năm ${asOfYear}, còn ${remainingInCurrentYear}/${annualQuota}`;
  }

  if (remainingInCurrentYear <= 0 && annualQuota > 0) {
    return `Đã cấp đủ ${issuedInCurrentYear}/${annualQuota} trong năm ${asOfYear}`;
  }

  if (lastIssuedYear === null) {
    return "Chưa từng cấp phát";
  }

  if (serviceLifeYears <= 0) {
    return "Không giới hạn niên hạn";
  }

  if (nextEligibleYear !== null && Number(asOfYear) >= Number(nextEligibleYear)) {
    return `Đã đến niên hạn từ năm ${nextEligibleYear}`;
  }

  return `Chưa đến niên hạn, sớm nhất từ năm ${nextEligibleYear}`;
}

function resolveServiceLifeTimeline({
  issueYears = [],
  referenceYear,
  serviceLifeYears,
}) {
  const normalizedYears = [...new Set(
    (issueYears || [])
      .map((year) => Number(year))
      .filter((year) => Number.isInteger(year)),
  )].sort((left, right) => left - right);

  let previousIssuedYear = null;
  let nextIssuedYear = null;

  normalizedYears.forEach((year) => {
    if (year <= Number(referenceYear)) {
      previousIssuedYear = year;
      return;
    }
    if (nextIssuedYear === null) {
      nextIssuedYear = year;
    }
  });

  const normalizedServiceLifeYears = Number(serviceLifeYears || 0);
  const nextEligibleYear =
    previousIssuedYear !== null && normalizedServiceLifeYears > 0
      ? previousIssuedYear + normalizedServiceLifeYears
      : null;
  const windowCycleSpan =
    previousIssuedYear !== null &&
    nextIssuedYear !== null &&
    normalizedServiceLifeYears > 0
      ? (nextIssuedYear - previousIssuedYear) / normalizedServiceLifeYears
      : null;
  const overdueByHistoricalWindow =
    nextEligibleYear !== null &&
    Number(referenceYear) >= Number(nextEligibleYear) &&
    windowCycleSpan !== null &&
    windowCycleSpan > 2;
  const dueByServiceLife =
    previousIssuedYear === null ||
    normalizedServiceLifeYears <= 0 ||
    (nextEligibleYear !== null && Number(referenceYear) >= Number(nextEligibleYear)) ||
    overdueByHistoricalWindow;

  return {
    previousIssuedYear,
    nextIssuedYear,
    nextEligibleYear,
    windowCycleSpan,
    overdueByHistoricalWindow,
    dueByServiceLife,
  };
}

function buildMilitarySummary(military) {
  return {
    id: military.id,
    fullname: military.fullname,
    militaryCode: military.militaryCode,
    rank: getMilitaryRankLabel(military.rank),
    rankCode: military.rank,
    rankGroup: military.rankGroup,
    gender: getMilitaryDisplayGender(military),
    position: military.position,
    assignedUnitId: military.assignedUnitId || null,
    assignedUnit: military.assignedUnit || null,
    initialCommissioningYear: military.initialCommissioningYear,
    unit: military.unit
      ? {
          id: military.unit.id,
          name: military.unit.name,
        }
      : null,
    types: (military.typeAssignments || []).map((entry) => ({
      id: entry.type.id,
      code: entry.type.code,
      name: entry.type.name || null,
    })),
  };
}

async function resolveLedgerMilitary({ actor, militaryId }) {
  const isSuperAdmin = hasAnyRole(actor, ["SUPER_ADMIN"]);
  const isAdmin = isSuperAdmin || hasAnyRole(actor, ["ADMIN"]);

  let targetMilitaryId = String(militaryId || "").trim();

  if (!targetMilitaryId) {
    const claimedMilitary = await getClaimedMilitaryOrThrow(actor);
    targetMilitaryId = claimedMilitary.id;
  }

  const military = await prisma.military.findFirst({
    where: {
      id: targetMilitaryId,
      deletedAt: null,
    },
    include: {
      unit: {
        select: { id: true, name: true },
      },
      genderCatalog: {
        select: { code: true, name: true },
      },
      typeAssignments: {
        where: {
          type: {
            deletedAt: null,
          },
        },
        orderBy: [{ typeId: "asc" }],
        include: {
          type: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      },
    },
  });

  if (!military) {
    throw new AppError({
      message: "Quân nhân không tồn tại",
      statusCode: HTTP_CODES.NOT_FOUND,
      errorCode: "MILITARY_NOT_FOUND",
    });
  }

  if (isAdmin) {
    if (!isSuperAdmin) {
      const actorUnitId = Number(getActorUnitId(actor));
      const hasOpenAssignmentInActorUnit =
        Number(military.unitId) === actorUnitId ||
        Boolean(
          await prisma.militaryUnit.findFirst({
            where: {
              militaryId: military.id,
              unitId: actorUnitId,
              transferOutYear: null,
            },
            select: {
              id: true,
            },
          }),
        );

      if (!hasOpenAssignmentInActorUnit) {
        throw new AppError({
          message: "ADMIN chỉ được xem sổ quân trang của quân nhân thuộc đơn vị mình",
          statusCode: HTTP_CODES.FORBIDDEN,
          errorCode: "MILITARY_SCOPE_FORBIDDEN",
        });
      }
    }

    return {
      military,
      accessScope: isSuperAdmin ? "system" : "unit",
    };
  }

  const claimedMilitary = await getClaimedMilitaryOrThrow(actor);
  if (String(claimedMilitary.id) !== String(military.id)) {
    throw new AppError({
      message: "Bạn không được truy cập sổ quân trang của quân nhân khác",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "PERSONAL_LEDGER_FORBIDDEN",
    });
  }

  return {
    military,
    accessScope: "self",
  };
}

function groupTimelineEntries(entries = []) {
  const yearMap = new Map();

  entries.forEach((entry) => {
    const year = Number(entry.issuedYear || 0);
    if (!yearMap.has(year)) {
      yearMap.set(year, {
        year,
        vouchers: [],
      });
    }
    yearMap.get(year).vouchers.push(entry);
  });

  return [...yearMap.values()]
    .sort((left, right) => right.year - left.year)
    .map((group) => ({
      ...group,
      vouchers: group.vouchers.sort((left, right) => {
        const leftTime = new Date(left.issuedAt || 0).getTime();
        const rightTime = new Date(right.issuedAt || 0).getTime();
        if (leftTime !== rightTime) return rightTime - leftTime;
        return String(right.voucherNo || "").localeCompare(String(left.voucherNo || ""));
      }),
    }));
}

function overlapsAssignmentRange({ assignment, yearFrom = null, yearTo = null }) {
  const startYear = Number(assignment?.transferInYear || 0);
  const endYear =
    assignment?.transferOutYear === null || assignment?.transferOutYear === undefined
      ? Number.MAX_SAFE_INTEGER
      : Number(assignment.transferOutYear);

  if (yearTo !== null && startYear > Number(yearTo)) {
    return false;
  }

  if (yearFrom !== null && endYear < Number(yearFrom)) {
    return false;
  }

  return true;
}

function buildTransferHistoryGroups({
  assignments = [],
  militaryTypes = [],
  yearFrom = null,
  yearTo = null,
}) {
  const exactTypeIds = new Set(
    assignments
      .map((assignment) => Number(assignment?.typeId || 0))
      .filter((value) => Number.isInteger(value) && value > 0),
  );
  const fallbackSingleType =
    exactTypeIds.size === 0 && militaryTypes.length === 1 ? militaryTypes[0] : null;
  const groupedAssignments = new Map();

  assignments.forEach((assignment) => {
    let groupKey = "shared";
    let type = null;

    if (Number.isInteger(Number(assignment?.typeId)) && Number(assignment.typeId) > 0) {
      groupKey = `type:${assignment.typeId}`;
      type = assignment.type
        ? {
            id: assignment.type.id,
            code: assignment.type.code,
            name: assignment.type.name || null,
          }
        : null;
    } else if (fallbackSingleType) {
      groupKey = `type:${fallbackSingleType.id}`;
      type = fallbackSingleType;
    }

    if (!groupedAssignments.has(groupKey)) {
      groupedAssignments.set(groupKey, {
        key: groupKey,
        type,
        isLegacyShared: groupKey === "shared",
        periods: [],
      });
    }

    groupedAssignments.get(groupKey).periods.push(assignment);
  });

  return [...groupedAssignments.values()]
    .map((group) => {
      const sortedAssignments = [...group.periods].sort((left, right) => {
        const leftIn = Number(left.transferInYear || 0);
        const rightIn = Number(right.transferInYear || 0);
        if (leftIn !== rightIn) return leftIn - rightIn;
        const leftOut = left.transferOutYear === null ? Number.MAX_SAFE_INTEGER : Number(left.transferOutYear);
        const rightOut =
          right.transferOutYear === null ? Number.MAX_SAFE_INTEGER : Number(right.transferOutYear);
        if (leftOut !== rightOut) return leftOut - rightOut;
        return String(left.id || "").localeCompare(String(right.id || ""));
      });

      const periods = sortedAssignments
        .map((assignment, index) => {
          const previousAssignment = sortedAssignments[index - 1] || null;
          const nextAssignment = sortedAssignments[index + 1] || null;
          const cameFromExternal = !previousAssignment;
          const transferredToUnit =
            nextAssignment && Number(nextAssignment.transferInYear || 0) >= Number(assignment.transferOutYear || 0)
              ? nextAssignment.unit
              : null;
          const transferredToExternal =
            assignment.transferOutYear !== null &&
            assignment.transferOutYear !== undefined &&
            !transferredToUnit;

          return {
            id: assignment.id,
            transferInYear: assignment.transferInYear,
            transferOutYear: assignment.transferOutYear,
            unit: assignment.unit
              ? {
                  id: assignment.unit.id,
                  name: assignment.unit.name,
                }
              : null,
            sourceUnitName: previousAssignment?.unit?.name || "Ngoài hệ thống",
            destinationUnitName:
              assignment.transferOutYear === null || assignment.transferOutYear === undefined
                ? null
                : transferredToUnit?.name || "Ngoài hệ thống",
            isCurrent: assignment.transferOutYear === null || assignment.transferOutYear === undefined,
            cameFromExternal,
            transferredToExternal,
          };
        })
        .filter((assignment) =>
          overlapsAssignmentRange({
            assignment,
            yearFrom,
            yearTo,
          }),
        );

      return {
        ...group,
        periods,
      };
    })
    .filter((group) => group.periods.length > 0)
    .sort((left, right) => {
      if (left.isLegacyShared !== right.isLegacyShared) {
        return left.isLegacyShared ? 1 : -1;
      }
      return String(left.type?.code || "").localeCompare(String(right.type?.code || ""));
    });
}

export async function getPersonalEquipmentLedger({
  actor,
  militaryId,
  query = {},
} = {}) {
  const asOfYear = parsePositiveYear(query?.asOfYear, "asOfYear") || new Date().getFullYear();
  const yearFrom = parsePositiveYear(query?.yearFrom, "yearFrom");
  const yearTo = parsePositiveYear(query?.yearTo, "yearTo");

  if (yearFrom !== null && yearTo !== null && yearTo < yearFrom) {
    throw new AppError({
      message: "yearTo phải lớn hơn hoặc bằng yearFrom",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "INVALID_YEAR_RANGE",
    });
  }

  const { military, accessScope } = await resolveLedgerMilitary({
    actor,
    militaryId,
  });

  const effectiveYearFrom = yearFrom ?? null;
  const effectiveYearTo = yearTo ?? null;
  const typeIds = (military.typeAssignments || []).map((entry) => Number(entry.typeId));

  const [
    subjectMemberships,
    standardVouchers,
    modeVouchers,
    activeModes,
    modeCategoryBaselines,
    transferAssignments,
  ] = await Promise.all([
    prisma.militaryAllocationSubjectMembership.findMany({
      where: {
        militaryId: military.id,
      },
      orderBy: [{ transferInYear: "asc" }, { createdAt: "asc" }],
      include: {
        subject: {
          select: {
            id: true,
            name: true,
            unitId: true,
          },
        },
      },
    }),
    prisma.supplyAllocationIssueVoucher.findMany({
      where: {
        militaryId: military.id,
        ...(effectiveYearFrom !== null || effectiveYearTo !== null
          ? {
              issuedYear: {
                ...(effectiveYearFrom !== null ? { gte: effectiveYearFrom } : {}),
                ...(effectiveYearTo !== null ? { lte: effectiveYearTo } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
      include: {
        unit: {
          select: { id: true, name: true },
        },
        warehouse: {
          select: { id: true, name: true },
        },
        subject: {
          select: { id: true, name: true },
        },
        createdBy: {
          select: {
            id: true,
            username: true,
            email: true,
            profile: {
              select: { fullName: true },
            },
            military: {
              select: { fullname: true },
            },
          },
        },
        items: {
          include: {
            appliedType: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
        },
      },
    }),
    prisma.allocationModeIssueVoucher.findMany({
      where: {
        militaryId: military.id,
        ...(effectiveYearFrom !== null || effectiveYearTo !== null
          ? {
              issuedYear: {
                ...(effectiveYearFrom !== null ? { gte: effectiveYearFrom } : {}),
                ...(effectiveYearTo !== null ? { lte: effectiveYearTo } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
      include: {
        unit: {
          select: { id: true, name: true },
        },
        warehouse: {
          select: { id: true, name: true },
        },
        mode: {
          include: {
            militaryTypes: {
              include: {
                type: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
        createdBy: {
          select: {
            id: true,
            username: true,
            email: true,
            profile: {
              select: { fullName: true },
            },
            military: {
              select: { fullname: true },
            },
          },
        },
        items: {
          include: {
            category: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
            appliedType: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
        },
      },
    }),
    prisma.allocationMode.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [
          { scope: "SYSTEM" },
          { scope: "UNIT", unitId: military.unitId },
        ],
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      include: {
        unit: {
          select: { id: true, name: true },
        },
        categories: {
          where: {
            deletedAt: null,
            isActive: true,
          },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: {
            category: {
              select: {
                id: true,
                name: true,
                code: true,
                unitOfMeasure: {
                  select: { id: true, name: true },
                },
              },
            },
          },
        },
        militaryTypes: {
          include: {
            type: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
        },
        includedMilitaries: {
          select: {
            militaryId: true,
            military: {
              select: {
                id: true,
                fullname: true,
              },
            },
          },
        },
        excludedMilitaries: {
          select: {
            militaryId: true,
            military: {
              select: {
                id: true,
                fullname: true,
              },
            },
          },
        },
      },
    }),
    prisma.allocationModeMilitaryCategoryBaseline.findMany({
      where: {
        militaryId: military.id,
        typeId: {
          in: typeIds.length ? typeIds : [-1],
        },
      },
      select: {
        categoryId: true,
        typeId: true,
        latestIssuedYear: true,
      },
    }),
    prisma.militaryUnit.findMany({
      where: {
        militaryId: military.id,
      },
      orderBy: [{ typeId: "asc" }, { transferInYear: "asc" }, { id: "asc" }],
      include: {
        unit: {
          select: {
            id: true,
            name: true,
          },
        },
        type: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
    }),
  ]);

  const activeMemberships = subjectMemberships.filter((entry) =>
    matchesYearRange({
      year: asOfYear,
      transferInYear: entry.transferInYear,
      transferOutYear: entry.transferOutYear,
    }),
  );
  const activeSubjectIds = activeMemberships.map((entry) => Number(entry.subjectId));

  const standards = activeSubjectIds.length
    ? await prisma.supplyAllocationStandard.findMany({
        where: {
          unitId: military.unitId,
          subjectId: {
            in: activeSubjectIds,
          },
          deletedAt: null,
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        include: {
          subject: {
            select: {
              id: true,
              name: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
            },
          },
          campaignContent: true,
          items: {
            orderBy: [{ item: { name: "asc" } }, { itemId: "asc" }],
            include: {
              rule: true,
              item: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  unitOfMeasure: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      })
    : [];

  const categoryIds = [
    ...new Set([
      ...standards.map((entry) => Number(entry.categoryId)),
      ...activeModes.flatMap((mode) => (mode.categories || []).map((entry) => Number(entry.categoryId))),
    ]),
  ];

  const serviceLifeRules = categoryIds.length && typeIds.length
    ? await prisma.supplyAllocationServiceLifeRule.findMany({
        where: {
          unitId: military.unitId,
          categoryId: {
            in: categoryIds,
          },
          typeId: {
            in: typeIds,
          },
          deletedAt: null,
        },
        orderBy: [{ typeId: "asc" }, { categoryId: "asc" }],
        include: {
          type: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      })
    : [];

  const rulesByCategoryId = serviceLifeRules.reduce((map, rule) => {
    const key = Number(rule.categoryId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(rule);
    return map;
  }, new Map());

  const standardAggregateByItemKey = new Map();
  const standardAggregateByStandardId = new Map();
  const timelineEntries = [];

  standardVouchers.forEach((voucher) => {
    const normalizedVoucher = {
      id: voucher.id,
      voucherNo: voucher.voucherNo,
      type: "STANDARD",
      issuedAt: voucher.issuedAt ? voucher.issuedAt.toISOString() : null,
      issuedYear: voucher.issuedYear,
      note: voucher.note || null,
      receiverName: voucher.military?.fullname || military.fullname,
      warehouse: voucher.warehouse
        ? {
            id: voucher.warehouse.id,
            name: voucher.warehouse.name,
          }
        : null,
      source: voucher.subject
        ? {
            id: voucher.subject.id,
            name: voucher.subject.name,
            type: "subject",
          }
        : null,
      createdBy: voucher.createdBy
        ? {
            id: voucher.createdBy.id,
            username: voucher.createdBy.username,
            displayName:
              voucher.createdBy.profile?.fullName ||
              voucher.createdBy.military?.fullname ||
              voucher.createdBy.username,
          }
        : null,
      items: (voucher.items || []).map((item) => ({
        id: item.id,
        standardId: item.standardId,
        itemId: item.itemId,
        categoryName: item.categoryName || null,
        itemName: item.itemName,
        itemCode: item.itemCode || null,
        unitOfMeasureName: item.unitOfMeasureName || null,
        quantity: item.quantity,
        serviceLifeYears: item.serviceLifeYears,
        appliedType: item.appliedType
          ? {
              id: item.appliedType.id,
              code: item.appliedType.code,
              name: item.appliedType.name || null,
            }
          : item.appliedTypeId
            ? {
                id: item.appliedTypeId,
                code: item.appliedTypeCode || null,
                name: item.appliedTypeName || null,
              }
            : null,
      })),
    };
    timelineEntries.push(normalizedVoucher);

    (voucher.items || []).forEach((item) => {
      const itemKey = `${Number(item.standardId)}:${Number(item.itemId)}`;
      const standardStats = standardAggregateByStandardId.get(Number(item.standardId)) || {
        lastIssuedYear: null,
        totalQuantity: 0,
        currentYearQuantity: 0,
        relatedVoucherIds: new Set(),
        issuedYears: new Set(),
      };
      standardStats.lastIssuedYear =
        standardStats.lastIssuedYear === null
          ? Number(voucher.issuedYear)
          : Math.max(Number(standardStats.lastIssuedYear), Number(voucher.issuedYear));
      standardStats.totalQuantity += Number(item.quantity || 0);
      if (Number(voucher.issuedYear) === Number(asOfYear)) {
        standardStats.currentYearQuantity += Number(item.quantity || 0);
      }
      standardStats.relatedVoucherIds.add(String(voucher.id));
      standardStats.issuedYears.add(Number(voucher.issuedYear));
      standardAggregateByStandardId.set(Number(item.standardId), standardStats);

      const itemStats = standardAggregateByItemKey.get(itemKey) || {
        lastIssuedYear: null,
        totalQuantity: 0,
        currentYearQuantity: 0,
        relatedVoucherIds: new Set(),
        issuedYears: new Set(),
      };
      itemStats.lastIssuedYear =
        itemStats.lastIssuedYear === null
          ? Number(voucher.issuedYear)
          : Math.max(Number(itemStats.lastIssuedYear), Number(voucher.issuedYear));
      itemStats.totalQuantity += Number(item.quantity || 0);
      if (Number(voucher.issuedYear) === Number(asOfYear)) {
        itemStats.currentYearQuantity += Number(item.quantity || 0);
      }
      itemStats.relatedVoucherIds.add(String(voucher.id));
      itemStats.issuedYears.add(Number(voucher.issuedYear));
      standardAggregateByItemKey.set(itemKey, itemStats);
    });
  });

  const standardBook = standards.flatMap((standard) => {
    const standardCondition = buildStandardCondition(standard.campaignContent);
    const currentlyApplicable = matchStandardCondition({
      standardCondition,
      military,
      asOfYear,
    });
    const serviceLifeData = resolveServiceLifeForCategory({
      categoryId: standard.categoryId,
      military,
      rulesByCategoryId,
      fallbackServiceLifeYears: standard.serviceLifeYears,
    });

    return (standard.items || [])
      .filter((item) => Number(item.quantity || 0) > 0)
      .filter((item) => matchesItemRule(item.rule, military))
      .map((item) => {
        const itemKey = `${Number(standard.id)}:${Number(item.itemId)}`;
        const itemStats = standardAggregateByItemKey.get(itemKey) || {
          lastIssuedYear: null,
          totalQuantity: 0,
          currentYearQuantity: 0,
          relatedVoucherIds: new Set(),
          issuedYears: new Set(),
        };
        const annualQuota = Number(item.quantity || 0);
        const issuedInCurrentYear = Number(itemStats.currentYearQuantity || 0);
        const remainingInCurrentYear = Math.max(annualQuota - issuedInCurrentYear, 0);
        const timeline = resolveServiceLifeTimeline({
          issueYears: [...itemStats.issuedYears],
          referenceYear: asOfYear,
          serviceLifeYears: Number(serviceLifeData.serviceLifeYears || 0),
        });
        const lastIssuedYear = timeline.previousIssuedYear;
        const nextEligibleYear = timeline.nextEligibleYear;
        const canContinuePartialIssue =
          issuedInCurrentYear > 0 &&
          remainingInCurrentYear > 0 &&
          Number(lastIssuedYear) === Number(asOfYear);
        const dueByServiceLife = timeline.dueByServiceLife;
        const isDue =
          currentlyApplicable &&
          remainingInCurrentYear > 0 &&
          (dueByServiceLife || canContinuePartialIssue);

        return {
          key: `standard:${standard.id}:${item.itemId}`,
          sourceType: "STANDARD",
          standardId: standard.id,
          subject: standard.subject
            ? {
                id: standard.subject.id,
                name: standard.subject.name,
              }
            : null,
          category: standard.category
            ? {
                id: standard.category.id,
                name: standard.category.name,
              }
            : null,
          item: item.item
            ? {
                id: item.item.id,
                name: item.item.name,
                code: item.item.code || null,
                unitOfMeasure: item.item.unitOfMeasure
                  ? {
                      id: item.item.unitOfMeasure.id,
                      name: item.item.unitOfMeasure.name,
                    }
                  : null,
              }
            : null,
          annualQuota,
          issuedInCurrentYear,
          remainingInCurrentYear,
          totalIssuedQuantity: Number(itemStats.totalQuantity || 0),
          currentlyApplicable,
          isDue,
          statusText: buildStatusText({
            currentlyApplicable,
            lastIssuedYear,
            serviceLifeYears: Number(serviceLifeData.serviceLifeYears || 0),
            nextEligibleYear,
            annualQuota,
            issuedInCurrentYear,
            remainingInCurrentYear,
            asOfYear,
          }),
          serviceLifeYears: Number(serviceLifeData.serviceLifeYears || 0),
          serviceLifeSource: serviceLifeData.source,
          appliedType: serviceLifeData.appliedType,
          lastIssuedYear,
          nextEligibleYear,
          campaignContent: String(standard.campaignContent?.content || "").trim() || null,
          standardCondition,
          relatedVoucherCount: itemStats.relatedVoucherIds.size,
          relatedVoucherIds: [...itemStats.relatedVoucherIds],
        };
      });
  });

  const modeAggregateByRowKey = new Map();
  const modeBaselineYearByTypeCategoryKey = new Map(
    (modeCategoryBaselines || []).map((entry) => [
      `${Number(entry.typeId)}:${Number(entry.categoryId)}`,
      Number(entry.latestIssuedYear),
    ]),
  );

  modeVouchers.forEach((voucher) => {
    const normalizedVoucher = {
      id: voucher.id,
      voucherNo: voucher.voucherNo,
      type: "MODE",
      issuedAt: voucher.issuedAt ? new Date(voucher.issuedAt).toISOString() : null,
      issuedYear: voucher.issuedYear,
      note: voucher.note || null,
      receiverName: voucher.receiverName || military.fullname,
      warehouse: voucher.warehouse
        ? {
            id: voucher.warehouse.id,
            name: voucher.warehouse.name,
          }
        : null,
      source: voucher.mode
        ? {
            id: voucher.mode.id,
            name: voucher.mode.name,
            code: voucher.mode.code || null,
            type: "mode",
          }
        : null,
      createdBy: voucher.createdBy
        ? {
            id: voucher.createdBy.id,
            username: voucher.createdBy.username,
            displayName:
              voucher.createdBy.profile?.fullName ||
              voucher.createdBy.military?.fullname ||
              voucher.createdBy.username,
          }
        : null,
      items: (voucher.items || []).map((item) => ({
        id: item.id,
        categoryId: item.categoryId,
        categoryName: item.categoryName || item.category?.name || null,
        quantity: item.quantity,
        serviceLifeYears: item.serviceLifeYears,
        versionName: item.versionName || null,
        colorName: item.colorName || null,
        unitOfMeasureName: item.unitOfMeasureName || null,
        appliedType: item.appliedType
          ? {
              id: item.appliedType.id,
              code: item.appliedType.code,
              name: item.appliedType.name || null,
            }
          : null,
        lastIssuedYear: item.lastIssuedYear,
        nextEligibleYear: item.nextEligibleYear,
        wasDue: Boolean(item.wasDue),
      })),
    };
    timelineEntries.push(normalizedVoucher);

    (voucher.items || []).forEach((item) => {
      const rowKey = `${String(voucher.modeId)}:${Number(item.categoryId)}`;
      const stats = modeAggregateByRowKey.get(rowKey) || {
        lastIssuedYear: null,
        totalQuantity: 0,
        currentYearQuantity: 0,
        relatedVoucherIds: new Set(),
        issuedYears: new Set(),
      };
      stats.lastIssuedYear =
        stats.lastIssuedYear === null
          ? Number(voucher.issuedYear)
          : Math.max(Number(stats.lastIssuedYear), Number(voucher.issuedYear));
      stats.totalQuantity += Number(item.quantity || 0);
      if (Number(voucher.issuedYear) === Number(asOfYear)) {
        stats.currentYearQuantity += Number(item.quantity || 0);
      }
      stats.relatedVoucherIds.add(String(voucher.id));
      stats.issuedYears.add(Number(voucher.issuedYear));
      modeAggregateByRowKey.set(rowKey, stats);
    });
  });

  const modeBook = activeModes
    .map((mode) => {
      const evaluation = evaluateModeForMilitary({
        mode,
        military,
        issueYear: asOfYear,
      });

      if (!evaluation.applicable) return [];

      return (mode.categories || []).map((modeCategory) => {
        const rowKey = `${String(mode.id)}:${Number(modeCategory.categoryId)}`;
        const stats = modeAggregateByRowKey.get(rowKey) || {
          lastIssuedYear: null,
          totalQuantity: 0,
          currentYearQuantity: 0,
          relatedVoucherIds: new Set(),
          issuedYears: new Set(),
        };
        const serviceLifeData = resolveServiceLifeForCategory({
          categoryId: modeCategory.categoryId,
          military,
          rulesByCategoryId,
          fallbackServiceLifeYears: 0,
          preferredTypeId: evaluation.modeType?.id || null,
        });
        const modeQuantity = Number(modeCategory.quantity || 0);
        const issuedInCurrentYear = Number(stats.currentYearQuantity || 0);
        const remainingInCurrentYear = Math.max(modeQuantity - issuedInCurrentYear, 0);
        const importedBaselineYear = modeBaselineYearByTypeCategoryKey.get(
          `${Number(evaluation.modeType?.id || serviceLifeData.appliedType?.id || 0)}:${Number(modeCategory.categoryId)}`,
        );
        const timeline = resolveServiceLifeTimeline({
          issueYears: [
            ...stats.issuedYears,
            ...(importedBaselineYear ? [importedBaselineYear] : []),
          ],
          referenceYear: asOfYear,
          serviceLifeYears: Number(serviceLifeData.serviceLifeYears || 0),
        });
        const lastIssuedYear = timeline.previousIssuedYear;
        const nextEligibleYear = timeline.nextEligibleYear;
        const canContinuePartialIssue =
          issuedInCurrentYear > 0 &&
          remainingInCurrentYear > 0 &&
          Number(lastIssuedYear) === Number(asOfYear);
        const dueByServiceLife = timeline.dueByServiceLife;
        const isDue =
          remainingInCurrentYear > 0 &&
          (dueByServiceLife || canContinuePartialIssue);

        return {
          key: `mode:${mode.id}:${modeCategory.categoryId}`,
          sourceType: "MODE",
          modeId: mode.id,
          mode: {
            id: mode.id,
            code: mode.code,
            name: mode.name,
            scope: mode.scope,
          },
          category: modeCategory.category
            ? {
                id: modeCategory.category.id,
                name: modeCategory.category.name,
                code: modeCategory.category.code || null,
                unitOfMeasure: modeCategory.category.unitOfMeasure
                  ? {
                      id: modeCategory.category.unitOfMeasure.id,
                      name: modeCategory.category.unitOfMeasure.name,
                    }
                  : null,
              }
            : null,
          configuredQuantity: modeQuantity,
          issuedInCurrentYear,
          remainingInCurrentYear,
          totalIssuedQuantity: Number(stats.totalQuantity || 0),
          serviceLifeYears: Number(serviceLifeData.serviceLifeYears || 0),
          serviceLifeSource: serviceLifeData.source,
          appliedType: evaluation.modeType || serviceLifeData.appliedType,
          importedBaselineYear: importedBaselineYear || null,
          lastIssuedYear,
          nextEligibleYear,
          isDue,
          statusText: buildStatusText({
            currentlyApplicable: true,
            lastIssuedYear,
            serviceLifeYears: Number(serviceLifeData.serviceLifeYears || 0),
            nextEligibleYear,
            annualQuota: modeQuantity,
            issuedInCurrentYear,
            remainingInCurrentYear,
            asOfYear,
          }),
          relatedVoucherCount: stats.relatedVoucherIds.size,
          relatedVoucherIds: [...stats.relatedVoucherIds],
          ruleReason: evaluation.reason,
        };
      });
    })
    .flat();

  const subjectMembershipSummary = subjectMemberships.map((entry) => ({
    id: entry.id,
    subject: entry.subject
      ? {
          id: entry.subject.id,
          name: entry.subject.name,
        }
      : null,
    transferInYear: entry.transferInYear,
    transferOutYear: entry.transferOutYear,
    isActiveAtAsOfYear: matchesYearRange({
      year: asOfYear,
      transferInYear: entry.transferInYear,
      transferOutYear: entry.transferOutYear,
    }),
  }));

  const militarySummary = buildMilitarySummary(military);
  const transferHistory = buildTransferHistoryGroups({
    assignments: transferAssignments,
    militaryTypes: militarySummary.types,
    yearFrom: effectiveYearFrom,
    yearTo: effectiveYearTo,
  });
  const timeline = groupTimelineEntries(timelineEntries);

  return {
    military: militarySummary,
    access: {
      scope: accessScope,
      isSelf: accessScope === "self",
      canViewUnitMilitaryLedger: accessScope === "unit" || accessScope === "system",
    },
    filters: {
      asOfYear,
      yearFrom: effectiveYearFrom,
      yearTo: effectiveYearTo,
    },
    subjectMemberships: subjectMembershipSummary,
    transferHistory,
    standardBook,
    modeBook,
    timeline,
    vouchers: timelineEntries.sort((left, right) => {
      const leftTime = new Date(left.issuedAt || 0).getTime();
      const rightTime = new Date(right.issuedAt || 0).getTime();
      if (leftTime !== rightTime) return rightTime - leftTime;
      return String(right.voucherNo || "").localeCompare(String(left.voucherNo || ""));
    }),
    summary: {
      activeSubjects: subjectMembershipSummary.filter((entry) => entry.isActiveAtAsOfYear).length,
      dueStandardRows: standardBook.filter((entry) => entry.isDue).length,
      dueModeRows: modeBook.filter((entry) => entry.isDue).length,
      totalRelatedVouchers: timelineEntries.length,
      totalStandardRows: standardBook.length,
      totalModeRows: modeBook.length,
      totalTransferGroups: transferHistory.length,
      totalTransferPeriods: transferHistory.reduce(
        (sum, group) => sum + Number(group.periods?.length || 0),
        0,
      ),
    },
  };
}
