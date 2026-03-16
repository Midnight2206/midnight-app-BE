import path from "path";
import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import {
  assertImportAccess,
  parseMultipartFormData,
  resolveScopeUnitId,
} from "#services/militaries/common.js";
import {
  hasYearRangeOverlap,
  normalizeTransferEndYear,
  parseXlsxRows,
} from "#services/militaries/importMilitary.shared.js";
import {
  normalizeMilitaryTypeCodesInput,
  resolveMilitaryTypeCatalogRecords,
} from "#services/militaries/type-catalog.js";
import {
  getMilitaryRankLabel,
  normalizeMilitaryRankCode,
  resolveMilitaryGenderCatalogRecord,
  resolveMilitaryRankGroupFromCode,
} from "#services/militaries/profile-reference.js";

function normalizeAssignedUnitName(name) {
  return String(name || "").normalize("NFC").trim();
}

function normalizeAssignedUnitNameForCompare(name) {
  return normalizeAssignedUnitName(name).toLowerCase();
}

function formatYearRange(startYear, endYear) {
  return `${startYear}-${endYear ?? "nay"}`;
}

function normalizeImportTypeCode(typeValue) {
  const normalizedCodes = normalizeMilitaryTypeCodesInput(typeValue, {
    required: false,
    fieldName: "type",
  });
  if (!normalizedCodes?.length) return null;
  return normalizedCodes[0];
}

export async function importByTemplate({
  actor,
  req,
  hasSearchNormalizedColumn,
  buildMilitarySearchNormalized,
}) {
  assertImportAccess(actor);

  const { fields, files } = await parseMultipartFormData(req);

  if (!files.file) {
    throw new AppError({
      message: "File is required (field name: file)",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "FILE_REQUIRED",
    });
  }

  const scopeUnitId = resolveScopeUnitId(actor, fields.unitId);
  if (!scopeUnitId) {
    throw new AppError({
      message: "unitId is required",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "UNIT_REQUIRED",
    });
  }

  const unit = await prisma.unit.findFirst({
    where: { id: scopeUnitId, deletedAt: null },
  });

  if (!unit) {
    throw new AppError({
      message: "Unit not found",
      statusCode: HTTP_CODES.NOT_FOUND,
      errorCode: "UNIT_NOT_FOUND",
    });
  }

  const fileName = files.file.filename || "import-file";
  const extension = path.extname(fileName).toLowerCase();

  if (extension !== ".xlsx") {
    throw new AppError({
      message: "Unsupported file type. Please upload .xlsx only",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "UNSUPPORTED_IMPORT_FILE",
    });
  }

  const importTypeCode = normalizeImportTypeCode(fields.type);
  const rows = await parseXlsxRows(files.file.content, {
    forcedTypeCode: importTypeCode,
  });
  const requestedTypeCodes = [...new Set(rows.flatMap((row) => row.types || []))];
  const typeCatalogRows = await resolveMilitaryTypeCatalogRecords({
    value: requestedTypeCodes,
    required: true,
    fieldName: "types",
  });
  const typeCatalogByCode = new Map(
    typeCatalogRows.map((item) => [item.codeNormalized, item]),
  );
  const codes = rows.map((row) => row.militaryCode.trim().toUpperCase());
  const uniqueCodes = new Set(codes);

  if (uniqueCodes.size !== codes.length) {
    throw new AppError({
      message: "Duplicate militaryCode found in import file",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "DUPLICATE_MILITARY_CODE_IN_FILE",
    });
  }

  const existingMilitaries = await prisma.military.findMany({
    where: {
      militaryCode: {
        in: [...uniqueCodes],
      },
    },
    select: {
      id: true,
      militaryCode: true,
      unitId: true,
      assignedUnit: true,
      deletedAt: true,
      unit: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  const existingByCode = new Map(
    existingMilitaries.map((item) => [item.militaryCode, item]),
  );
  const existingActiveMilitaryIds = existingMilitaries
    .filter((item) => !item.deletedAt)
    .map((item) => item.id);
  const existingAssignments =
    existingActiveMilitaryIds.length > 0
      ? await prisma.militaryUnit.findMany({
          where: {
            militaryId: {
              in: existingActiveMilitaryIds,
            },
          },
          select: {
            militaryId: true,
            unitId: true,
            transferInYear: true,
            transferOutYear: true,
            unit: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: [
            {
              transferInYear: "asc",
            },
          ],
        })
      : [];
  const existingTypeAssignments =
    existingActiveMilitaryIds.length > 0
      ? await prisma.militaryTypeAssignment.findMany({
          where: {
            militaryId: {
              in: existingActiveMilitaryIds,
            },
          },
          select: {
            militaryId: true,
            type: {
              select: {
                codeNormalized: true,
              },
            },
          },
        })
      : [];
  const assignmentsByMilitaryId = new Map();
  for (const assignment of existingAssignments) {
    const list = assignmentsByMilitaryId.get(assignment.militaryId) || [];
    list.push(assignment);
    assignmentsByMilitaryId.set(assignment.militaryId, list);
  }
  const typeCodesByMilitaryId = new Map();
  for (const assignment of existingTypeAssignments) {
    const set = typeCodesByMilitaryId.get(assignment.militaryId) || new Set();
    if (assignment.type?.codeNormalized) {
      set.add(assignment.type.codeNormalized);
    }
    typeCodesByMilitaryId.set(assignment.militaryId, set);
  }

  const rowsForNewMilitary = [];
  const rowsForExistingMilitaryAssignment = [];
  const rowsForExistingMilitaryTypeOnly = [];
  const conflictRows = [];

  for (const row of rows) {
    const existed = existingByCode.get(row.militaryCode);
    if (!existed) {
      rowsForNewMilitary.push(row);
      continue;
    }

    if (existed.deletedAt) {
      conflictRows.push({
        rowNumber: row.rowNumber,
        militaryCode: row.militaryCode,
        reason:
          "Mã quân nhân đã tồn tại trong hệ thống nhưng đang ở trạng thái đã xóa mềm",
        existingMilitaryId: existed.id,
        existingUnitId: existed.unitId,
        existingUnitName: existed.assignedUnit || existed.unit?.name || null,
      });
      continue;
    }

    const existingTypeSet = typeCodesByMilitaryId.get(existed.id) || new Set();
    const pendingTypeCodes = row.types.filter((typeCode) => !existingTypeSet.has(typeCode));
    if (pendingTypeCodes.length === 0) {
      conflictRows.push({
        rowNumber: row.rowNumber,
        militaryCode: row.militaryCode,
        reason: `Mã quân nhân đã tồn tại và đã có sẵn trong danh sách ${row.types.join(", ")}`,
        existingMilitaryId: existed.id,
        existingUnitId: existed.unitId,
        existingUnitName: existed.assignedUnit || existed.unit?.name || null,
      });
      continue;
    }

    const existingTimeline = assignmentsByMilitaryId.get(existed.id) || [];
    const leftStart = row.unitTransferInYear;
    const leftEnd = normalizeTransferEndYear(row.unitTransferOutYear);
    const conflicted = existingTimeline.find((assignment) => {
      const rightStart = assignment.transferInYear;
      const rightEnd = normalizeTransferEndYear(assignment.transferOutYear);
      return hasYearRangeOverlap({ leftStart, leftEnd, rightStart, rightEnd });
    });

    if (conflicted) {
      // Allow enriching type assignments when row overlaps the current unit timeline.
      // In this case, we do not create a new militaryUnit row.
      if (conflicted.unitId === scopeUnitId) {
        rowsForExistingMilitaryTypeOnly.push({
          row: {
            ...row,
            types: pendingTypeCodes,
          },
          military: existed,
        });
        for (const typeCode of pendingTypeCodes) {
          existingTypeSet.add(typeCode);
        }
        typeCodesByMilitaryId.set(existed.id, existingTypeSet);
        continue;
      }

      const minAllowedYearText =
        conflicted.transferOutYear === null
          ? "không thể import vì đơn vị cũ chưa cắt bảo đảm"
          : `chỉ có thể import khi năm chuyển đến >= ${conflicted.transferOutYear}`;
      conflictRows.push({
        rowNumber: row.rowNumber,
        militaryCode: row.militaryCode,
        reason: `Trùng giai đoạn bảo đảm với đơn vị ${conflicted.unit?.name || `#${conflicted.unitId}`} (${formatYearRange(
          conflicted.transferInYear,
          conflicted.transferOutYear,
        )}), ${minAllowedYearText}.`,
        existingMilitaryId: existed.id,
        existingUnitId: conflicted.unitId,
        existingUnitName: conflicted.unit?.name || null,
      });
      continue;
    }

    rowsForExistingMilitaryAssignment.push({
      row: {
        ...row,
        types: pendingTypeCodes,
      },
      military: existed,
    });
    for (const typeCode of pendingTypeCodes) {
      existingTypeSet.add(typeCode);
    }
    typeCodesByMilitaryId.set(existed.id, existingTypeSet);

    existingTimeline.push({
      militaryId: existed.id,
      unitId: scopeUnitId,
      transferInYear: row.unitTransferInYear,
      transferOutYear: row.unitTransferOutYear,
      unit: {
        id: scopeUnitId,
        name: unit.name,
      },
    });
    assignmentsByMilitaryId.set(existed.id, existingTimeline);
  }

  const hasNormalizedColumn = await hasSearchNormalizedColumn();
  const result = await prisma.$transaction(async (tx) => {
    const requestedAssignedUnitNames = [
      ...new Set(
        rows
          .map((row) => normalizeAssignedUnitName(row.assignedUnit))
          .filter(Boolean),
      ),
    ];

    const requestedAssignedUnitNameByNormalized = new Map(
      requestedAssignedUnitNames.map((name) => [normalizeAssignedUnitNameForCompare(name), name]),
    );

    const existingAssignedUnits =
      requestedAssignedUnitNames.length > 0
        ? await tx.militaryAssignedUnit.findMany({
            where: {
              unitId: scopeUnitId,
              nameNormalized: {
                in: [...requestedAssignedUnitNameByNormalized.keys()],
              },
            },
            select: {
              id: true,
              name: true,
              nameNormalized: true,
              deletedAt: true,
            },
          })
        : [];

    const missingAssignedUnitNames = requestedAssignedUnitNames.filter((name) => {
      const normalized = normalizeAssignedUnitNameForCompare(name);
      const existed = existingAssignedUnits.find((item) => item.nameNormalized === normalized);
      return !existed;
    });

    if (missingAssignedUnitNames.length > 0) {
      await tx.militaryAssignedUnit.createMany({
        data: missingAssignedUnitNames.map((name) => ({
          unitId: scopeUnitId,
          name,
          nameNormalized: normalizeAssignedUnitNameForCompare(name),
        })),
        skipDuplicates: true,
      });
    }

    const softDeletedAssignedUnits = existingAssignedUnits.filter((item) => item.deletedAt);
    for (const item of softDeletedAssignedUnits) {
      await tx.militaryAssignedUnit.update({
        where: { id: item.id },
        data: {
          name: requestedAssignedUnitNameByNormalized.get(item.nameNormalized) || item.name,
          deletedAt: null,
        },
      });
    }

    const assignedUnitCatalogRows =
      requestedAssignedUnitNames.length > 0
        ? await tx.militaryAssignedUnit.findMany({
            where: {
              unitId: scopeUnitId,
              nameNormalized: {
                in: [...requestedAssignedUnitNameByNormalized.keys()],
              },
              deletedAt: null,
            },
            select: {
              id: true,
              name: true,
              nameNormalized: true,
            },
          })
        : [];

    const assignedUnitCatalogByNormalized = new Map(
      assignedUnitCatalogRows.map((item) => [item.nameNormalized, item]),
    );

    const uniqueGenders = [...new Set(rowsForNewMilitary.map((row) => row.gender))];

    const genderCatalogRows = [];
    for (const genderValue of uniqueGenders) {
      const genderCatalog = await resolveMilitaryGenderCatalogRecord({
        tx,
        value: genderValue,
        required: true,
        fieldName: "gender",
      });
      if (genderCatalog) genderCatalogRows.push(genderCatalog);
    }

    const genderCatalogByCode = new Map(
      genderCatalogRows.map((item) => [String(item.code || "").toUpperCase(), item]),
    );

    const batch = await tx.importBatch.create({
      data: {
        fileName,
        totalRows: rows.length,
        validRows:
          rowsForNewMilitary.length +
          rowsForExistingMilitaryAssignment.length +
          rowsForExistingMilitaryTypeOnly.length,
        invalidRows: conflictRows.length,
        status: "CONFIRMED",
        mode: conflictRows.length > 0 ? "SKIP_DUPLICATE" : "STRICT",
        createdById: actor.id,
        confirmedAt: new Date(),
      },
    });

    if (rowsForNewMilitary.length > 0) {
      await tx.military.createMany({
        data: rowsForNewMilitary.map((row) => {
          const genderCatalog = genderCatalogByCode.get(
            String(row.gender || "").toUpperCase(),
          );
          const rankCode = normalizeMilitaryRankCode(row.rank, {
            required: true,
            fieldName: `rows[${row.rowNumber}].rank`,
          });
          if (!genderCatalog) {
            throw new AppError({
              message: `Cannot resolve gender catalog for militaryCode: ${row.militaryCode}`,
              statusCode: HTTP_CODES.INTERNAL_SERVER_ERROR,
              errorCode: "MILITARY_PROFILE_CATALOG_MAPPING_FAILED",
            });
          }

          const normalizedAssignedUnit = normalizeAssignedUnitNameForCompare(row.assignedUnit);
          const assignedUnitCatalog = assignedUnitCatalogByNormalized.get(normalizedAssignedUnit);
          if (!assignedUnitCatalog) {
            throw new AppError({
              message: `Cannot resolve assignedUnit catalog for militaryCode: ${row.militaryCode}`,
              statusCode: HTTP_CODES.INTERNAL_SERVER_ERROR,
              errorCode: "MILITARY_ASSIGNED_UNIT_CATALOG_MAPPING_FAILED",
            });
          }

          return {
            fullname: row.fullname,
            rank: rankCode,
            rankGroup: resolveMilitaryRankGroupFromCode(rankCode),
            position: row.position,
            gender: row.gender,
            genderId: genderCatalog.id,
            militaryCode: row.militaryCode,
            ...(hasNormalizedColumn
              ? {
                  searchNormalized: buildMilitarySearchNormalized({
                    fullname: row.fullname,
                    militaryCode: row.militaryCode,
                    rank: `${rankCode} ${getMilitaryRankLabel(rankCode)}`,
                    position: row.position,
                    gender: row.gender,
                    type: row.types.join(" "),
                    assignedUnit: assignedUnitCatalog.name,
                    unitName: unit.name,
                  }),
                }
              : {}),
            initialCommissioningYear: row.initialCommissioningYear,
            assignedUnitId: assignedUnitCatalog.id,
            assignedUnit: assignedUnitCatalog.name,
            unitId: scopeUnitId,
            importBatchId: batch.id,
          };
        }),
      });
    }

    const createdMilitaries =
      rowsForNewMilitary.length > 0
        ? await tx.military.findMany({
            where: {
              militaryCode: {
                in: rowsForNewMilitary.map((row) => row.militaryCode),
              },
              deletedAt: null,
            },
            select: {
              id: true,
              militaryCode: true,
            },
          })
        : [];

    const militaryIdByCode = new Map(
      createdMilitaries.map((military) => [military.militaryCode, military.id]),
    );

    const assignmentRows = [];
    const militaryTypeAssignmentRows = [];

    for (const row of rowsForNewMilitary) {
      const militaryId = militaryIdByCode.get(row.militaryCode);
      if (!militaryId) {
        throw new AppError({
          message: `Cannot map imported militaryCode to military record: ${row.militaryCode}`,
          statusCode: HTTP_CODES.INTERNAL_SERVER_ERROR,
          errorCode: "MILITARY_IMPORT_MAPPING_FAILED",
        });
      }

      for (const typeCode of row.types) {
        const typeCatalog = typeCatalogByCode.get(typeCode);
        if (!typeCatalog) continue;
        assignmentRows.push({
          militaryId,
          militaryCode: row.militaryCode,
          typeId: typeCatalog.id,
          unitId: scopeUnitId,
          transferInYear: row.unitTransferInYear,
          transferOutYear: row.unitTransferOutYear,
        });
        militaryTypeAssignmentRows.push({
          militaryId,
          typeId: typeCatalog.id,
        });
      }
    }

    for (const item of rowsForExistingMilitaryAssignment) {
      for (const typeCode of item.row.types) {
        const typeCatalog = typeCatalogByCode.get(typeCode);
        if (!typeCatalog) continue;
        assignmentRows.push({
          militaryId: item.military.id,
          militaryCode: item.row.militaryCode,
          typeId: typeCatalog.id,
          unitId: scopeUnitId,
          transferInYear: item.row.unitTransferInYear,
          transferOutYear: item.row.unitTransferOutYear,
        });
        militaryTypeAssignmentRows.push({
          militaryId: item.military.id,
          typeId: typeCatalog.id,
        });
      }
    }

    for (const item of rowsForExistingMilitaryTypeOnly) {
      for (const typeCode of item.row.types) {
        const typeCatalog = typeCatalogByCode.get(typeCode);
        if (!typeCatalog) continue;
        militaryTypeAssignmentRows.push({
          militaryId: item.military.id,
          typeId: typeCatalog.id,
        });
      }
    }

    if (assignmentRows.length > 0) {
      await tx.militaryUnit.createMany({
        data: assignmentRows.map((row) => ({
          militaryId: row.militaryId,
          typeId: row.typeId,
          unitId: row.unitId,
          transferInYear: row.transferInYear,
          transferOutYear: row.transferOutYear,
        })),
      });

      const militaryIdsNeedUpdate = [
        ...new Set(
          assignmentRows
            .filter((item) => item.transferOutYear === null)
            .map((item) => item.militaryId),
        ),
      ];

      if (militaryIdsNeedUpdate.length > 0) {
        for (const row of assignmentRows.filter((item) => item.transferOutYear === null)) {
          const importedRow = rowsForExistingMilitaryAssignment.find(
            (item) => item.military.id === row.militaryId && item.row.militaryCode === row.militaryCode,
          )?.row;
          const normalizedAssignedUnit = normalizeAssignedUnitNameForCompare(importedRow?.assignedUnit);
          const assignedUnitCatalog = assignedUnitCatalogByNormalized.get(normalizedAssignedUnit);
          if (!assignedUnitCatalog) continue;

          await tx.military.update({
            where: {
              id: row.militaryId,
            },
            data: {
              unitId: scopeUnitId,
              assignedUnitId: assignedUnitCatalog.id,
              assignedUnit: assignedUnitCatalog.name,
            },
          });
        }
      }
    }

    if (militaryTypeAssignmentRows.length > 0) {
      await tx.militaryTypeAssignment.createMany({
        data: militaryTypeAssignmentRows,
        skipDuplicates: true,
      });
    }

    if (conflictRows.length > 0) {
      await tx.importError.createMany({
        data: conflictRows.map((item) => ({
          batchId: batch.id,
          rowNumber: item.rowNumber,
          field: "militaryCode",
          message: `${item.reason}${item.existingUnitName ? ` (${item.existingUnitName})` : ""}`,
        })),
      });
    }

    return {
      batchId: batch.id,
      importedRows:
        rowsForNewMilitary.length +
        rowsForExistingMilitaryAssignment.length +
        rowsForExistingMilitaryTypeOnly.length,
      skippedRows: conflictRows.length,
      importedNewRows: rowsForNewMilitary.length,
      importedTransferRows: rowsForExistingMilitaryAssignment.length,
      importedTypeOnlyRows: rowsForExistingMilitaryTypeOnly.length,
    };
  });

  return {
    ...result,
    unitId: scopeUnitId,
    conflicts: conflictRows.slice(0, 50),
  };
}
