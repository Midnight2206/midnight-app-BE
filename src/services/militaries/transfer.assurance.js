import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import {
  assertSizeRegistrationAccess,
  normalizeMilitaryGender,
  parseInteger,
} from "#services/militaries/common.js";
import { buildMilitarySearchNormalized } from "#utils/searchNormalizer.js";
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
import {
  ensureNoOverlapTransfer,
  findUnitOrThrow,
} from "#services/militaries/transfer.shared.js";
import {
  analyzeAssignmentHistory,
  listAssignmentHistory,
} from "#services/militaries/unit-history.js";
import { hasMilitaryTransferLogTable } from "#services/militaries/transfer-log.shared.js";
import { resolveAssignedUnitNameOrThrow } from "#services/militaries/assigned-unit.js";

function parseOptionalInteger(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return parseInteger(value, fieldName);
}

function getMilitaryTypeRows(military) {
  return (military?.typeAssignments || [])
    .map((entry) => entry?.type)
    .filter((type) => Number.isInteger(Number(type?.id)) && Number(type.id) > 0);
}

function getMilitaryTypeIds(military) {
  return getMilitaryTypeRows(military).map((type) => Number(type.id));
}

function inferTransferTypeId({
  military,
  parsedTypeId = null,
  assignmentHistory = [],
  typeCatalogRows = [],
}) {
  const militaryTypeIds = [...new Set(getMilitaryTypeIds(military))];
  const explicitTypeIds = [
    ...(Number.isInteger(parsedTypeId) ? [Number(parsedTypeId)] : []),
    ...typeCatalogRows.map((item) => Number(item.id)),
  ].filter((value) => Number.isInteger(value) && value > 0);
  const uniqueExplicitTypeIds = [...new Set(explicitTypeIds)];

  if (uniqueExplicitTypeIds.length > 1) {
    throw new AppError({
      message: "Mỗi lần điều chuyển chỉ được thao tác với một loại quân nhân",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "TRANSFER_MULTI_TYPE_NOT_SUPPORTED",
    });
  }

  if (uniqueExplicitTypeIds.length === 1) {
    const resolvedTypeId = uniqueExplicitTypeIds[0];
    if (militaryTypeIds.length > 0 && !militaryTypeIds.includes(resolvedTypeId)) {
      throw new AppError({
        message: "Loại quân nhân được chọn không thuộc hồ sơ quân nhân này",
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "TRANSFER_TYPE_NOT_ASSIGNED",
      });
    }
    return resolvedTypeId;
  }

  const historyTypeIds = [
    ...new Set(
      (assignmentHistory || [])
        .map((assignment) => Number(assignment?.typeId || 0))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  ];

  if (historyTypeIds.length === 1) {
    return historyTypeIds[0];
  }

  if (militaryTypeIds.length === 1) {
    return militaryTypeIds[0];
  }

  throw new AppError({
    message: "Quân nhân có nhiều loại quân nhân, vui lòng chọn rõ type cần điều chuyển",
    statusCode: HTTP_CODES.BAD_REQUEST,
    errorCode: "TRANSFER_TYPE_REQUIRED",
  });
}

export async function cutMilitaryAssurance({ actor, militaryId, transferOutYear, typeId }) {
  const actorUnitId = assertSizeRegistrationAccess(actor);
  const parsedYear = parseInteger(transferOutYear, "transferOutYear");
  const parsedTypeId = parseOptionalInteger(typeId, "typeId");

  const [military, assignmentHistory] = await Promise.all([
    prisma.military.findFirst({
      where: {
        id: militaryId,
        deletedAt: null,
      },
      select: {
        id: true,
        fullname: true,
        militaryCode: true,
        typeAssignments: {
          where: {
            type: {
              deletedAt: null,
            },
          },
          orderBy: {
            typeId: "asc",
          },
          select: {
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
    }),
    listAssignmentHistory({
      db: prisma,
      militaryId,
      includeUnit: true,
      scopeUnitId: actorUnitId,
    }),
  ]);
  const resolvedTypeId = inferTransferTypeId({
    military,
    parsedTypeId,
    assignmentHistory,
  });
  const assignmentAnalysis = analyzeAssignmentHistory({
    assignments: assignmentHistory,
    year: parsedYear,
    typeId: resolvedTypeId,
    scopeUnitId: actorUnitId,
    strictEnd: true,
  });
  const activeAssignment = assignmentAnalysis.includeAssignment;

  if (!military) {
    throw new AppError({
      message: "Không tìm thấy hồ sơ quân nhân đang được bảo đảm",
      statusCode: HTTP_CODES.NOT_FOUND,
      errorCode: "MILITARY_NOT_FOUND",
    });
  }

  if (!activeAssignment) {
    throw new AppError({
      message: "Không tìm thấy đơn vị bảo đảm hiện tại của quân nhân",
      statusCode: HTTP_CODES.NOT_FOUND,
      errorCode: "MILITARY_ASSIGNMENT_NOT_FOUND",
    });
  }

  if (activeAssignment.unitId !== actorUnitId) {
    throw new AppError({
      message: "Bạn chỉ được cắt bảo đảm quân trang cho quân nhân thuộc đơn vị của mình",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "CUT_ASSURANCE_SCOPE_FORBIDDEN",
    });
  }

  if (activeAssignment.transferOutYear !== null && activeAssignment.transferOutYear !== undefined) {
    throw new AppError({
      message: "Quân nhân đã có năm chuyển đi, không thể cắt bảo đảm thêm lần nữa",
      statusCode: HTTP_CODES.CONFLICT,
      errorCode: "MILITARY_ALREADY_CUT",
    });
  }

  if (parsedYear < Number(activeAssignment.transferInYear)) {
    throw new AppError({
      message: "Năm cắt bảo đảm không thể nhỏ hơn năm chuyển đến hiện tại",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "INVALID_TRANSFER_OUT_YEAR",
    });
  }

  const updated = activeAssignment
    ? await prisma.militaryUnit.update({
        where: {
          id: activeAssignment.id,
        },
        data: {
          transferOutYear: parsedYear,
        },
        select: {
          id: true,
          militaryId: true,
          typeId: true,
          unitId: true,
          transferInYear: true,
          transferOutYear: true,
        },
      })
    : null;

  return {
    action: "CUT_ASSURANCE",
    military: {
      id: military.id,
      fullname: military.fullname,
      militaryCode: military.militaryCode,
    },
    type:
      getMilitaryTypeRows(military).find((type) => Number(type.id) === Number(resolvedTypeId)) ||
      null,
    unit: activeAssignment?.unit || null,
    assignment: updated,
  };
}

export async function receiveMilitaryAssurance({ actor, militaryCode, transferInYear, typeId }) {
  const actorUnitId = assertSizeRegistrationAccess(actor);
  const parsedYear = parseInteger(transferInYear, "transferInYear");
  const parsedTypeId = parseOptionalInteger(typeId, "typeId");
  const normalizedCode = String(militaryCode || "").trim();

  if (!normalizedCode) {
    throw new AppError({
      message: "militaryCode is required",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "MILITARY_CODE_REQUIRED",
    });
  }

  const military = await prisma.military.findFirst({
    where: {
      militaryCode: normalizedCode,
      deletedAt: null,
    },
    select: {
      id: true,
      fullname: true,
      militaryCode: true,
      unitId: true,
      typeAssignments: {
        where: {
          type: {
            deletedAt: null,
          },
        },
        orderBy: {
          typeId: "asc",
        },
        select: {
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
      message: "Không tìm thấy quân nhân theo militaryCode",
      statusCode: HTTP_CODES.NOT_FOUND,
      errorCode: "MILITARY_NOT_FOUND",
    });
  }
  const assignmentHistory = await listAssignmentHistory({
    db: prisma,
    militaryId: military.id,
  });
  const resolvedTypeId = inferTransferTypeId({
    military,
    parsedTypeId,
    assignmentHistory,
  });
  const activeAssignment = analyzeAssignmentHistory({
    assignments: assignmentHistory,
    year: parsedYear,
    typeId: resolvedTypeId,
    strictEnd: true,
  }).includeAssignment;

  if (activeAssignment && activeAssignment.unitId === actorUnitId) {
    throw new AppError({
      message: "Quân nhân đang thuộc bảo đảm quân trang của đơn vị bạn",
      statusCode: HTTP_CODES.CONFLICT,
      errorCode: "ALREADY_IN_TARGET_UNIT",
    });
  }

  if (activeAssignment && activeAssignment.unitId !== actorUnitId) {
    throw new AppError({
      message: "Quân nhân chưa được cắt bảo đảm ở đơn vị hiện tại",
      statusCode: HTTP_CODES.CONFLICT,
      errorCode: "ACTIVE_ASSIGNMENT_NOT_CUT",
    });
  }

  if (!activeAssignment && military.unitId && military.unitId !== actorUnitId) {
    throw new AppError({
      message:
        "Không tìm thấy snapshot đơn vị hiện tại của quân nhân. Vui lòng chạy rebuild snapshot trước khi nhận bảo đảm.",
      statusCode: HTTP_CODES.CONFLICT,
      errorCode: "MILITARY_SNAPSHOT_NOT_FOUND",
    });
  }

  const targetUnit = await prisma.unit.findFirst({
    where: {
      id: actorUnitId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!targetUnit) {
    throw new AppError({
      message: "Đơn vị của tài khoản admin không tồn tại",
      statusCode: HTTP_CODES.NOT_FOUND,
      errorCode: "UNIT_NOT_FOUND",
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    await ensureNoOverlapTransfer({
      tx,
      militaryId: military.id,
      typeId: resolvedTypeId,
      transferInYear: parsedYear,
      transferOutYear: null,
    });

    const createdAssignment = await tx.militaryUnit.create({
      data: {
        militaryId: military.id,
        typeId: resolvedTypeId,
        unitId: actorUnitId,
        transferInYear: parsedYear,
      },
      select: {
        id: true,
        militaryId: true,
        typeId: true,
        unitId: true,
        transferInYear: true,
        transferOutYear: true,
      },
    });

    await tx.military.update({
      where: {
        id: military.id,
      },
      data: {
        unitId: actorUnitId,
      },
    });

    return createdAssignment;
  });

  return {
    action: "RECEIVE_ASSURANCE",
    military: {
      id: military.id,
      fullname: military.fullname,
      militaryCode: military.militaryCode,
    },
    type:
      getMilitaryTypeRows(military).find((type) => Number(type.id) === Number(resolvedTypeId)) ||
      null,
    unit: targetUnit,
    assignment: result,
  };
}

export async function transferMilitaryAssurance({ actor, payload }) {
  const actorUnitId = assertSizeRegistrationAccess(actor);
  const canWriteTransferLog = await hasMilitaryTransferLogTable();

  const militaryCode = String(payload?.militaryCode || "").trim();
  const parsedTypeId = parseOptionalInteger(payload?.typeId, "typeId");
  const transferYear = parseInteger(payload?.transferYear, "transferYear");
  const fromUnitId = payload?.fromUnitId === null ? null : parseInteger(payload?.fromUnitId, "fromUnitId");
  const toUnitId = payload?.toUnitId === null ? null : parseInteger(payload?.toUnitId, "toUnitId");
  const fromExternalUnitName = String(payload?.fromExternalUnitName || "").trim();
  const toExternalUnitName = String(payload?.toExternalUnitName || "").trim();
  const assignedUnitId =
    payload?.assignedUnitId === null ? null : parseInteger(payload?.assignedUnitId, "assignedUnitId");
  const fullname = String(payload?.fullname || "").trim();
  const rank = normalizeMilitaryRankCode(payload?.rank, {
    required: false,
    fieldName: "rank",
  });
  const position = String(payload?.position || "").trim();
  const gender = normalizeMilitaryGender(payload?.gender, {
    required: false,
    fieldName: "gender",
  });
  const typeCodesInput = normalizeMilitaryTypeCodesInput(payload?.types ?? payload?.type, {
    required: false,
    fieldName: "types",
  });
  const assignedUnitInput = String(payload?.assignedUnit || "").trim();
  const initialCommissioningYearRaw = payload?.initialCommissioningYear;
  const initialCommissioningYear =
    initialCommissioningYearRaw === null || initialCommissioningYearRaw === undefined || initialCommissioningYearRaw === ""
      ? null
      : parseInteger(initialCommissioningYearRaw, "initialCommissioningYear");

  if (!militaryCode) {
    throw new AppError({
      message: "militaryCode is required",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "MILITARY_CODE_REQUIRED",
    });
  }

  if (!fromUnitId && !toUnitId) {
    throw new AppError({
      message: "Không thể điều chuyển từ hư vô sang hư vô",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "INVALID_TRANSFER_DIRECTION",
    });
  }

  if (fromUnitId && toUnitId && fromUnitId === toUnitId) {
    throw new AppError({
      message: "Đơn vị đi và đơn vị đến không được trùng nhau",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "TRANSFER_UNIT_DUPLICATED",
    });
  }

  if (fromUnitId !== actorUnitId && toUnitId !== actorUnitId) {
    throw new AppError({
      message: "Bạn chỉ được thao tác điều chuyển liên quan đến đơn vị của mình",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "TRANSFER_SCOPE_FORBIDDEN",
    });
  }

  const typeCatalogRows =
    typeCodesInput.length > 0
      ? await resolveMilitaryTypeCatalogRecords({
          value: typeCodesInput,
          required: false,
          fieldName: "types",
        })
      : [];

  const result = await prisma.$transaction(async (tx) => {
    const fromUnit = fromUnitId
      ? await findUnitOrThrow({ tx, unitId: fromUnitId, fieldName: "fromUnitId" })
      : null;
    const toUnit = toUnitId
      ? await findUnitOrThrow({ tx, unitId: toUnitId, fieldName: "toUnitId" })
      : null;
    const assignedUnitName =
      toUnitId && assignedUnitId
        ? await resolveAssignedUnitNameOrThrow({
            tx,
            assignedUnitId,
            unitId: toUnitId,
          })
        : assignedUnitInput;

    let military = await tx.military.findFirst({
      where: {
        militaryCode,
        deletedAt: null,
      },
      select: {
        id: true,
        fullname: true,
        rank: true,
        position: true,
        gender: true,
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
        assignedUnit: true,
        militaryCode: true,
        unitId: true,
      },
    });

    if (!military) {
      if (!toUnitId) {
        throw new AppError({
          message: "Quân nhân chưa có trong hệ thống, không thể cắt bảo đảm",
          statusCode: HTTP_CODES.BAD_REQUEST,
          errorCode: "MILITARY_NOT_FOUND_FOR_CUT",
        });
      }

      if (
        !fullname ||
        !rank ||
        !position ||
        !initialCommissioningYear ||
        !gender ||
        typeCatalogRows.length === 0
      ) {
        throw new AppError({
          message:
            "Quân nhân từ hư vô vào hệ thống cần đầy đủ fullname, rank, position, gender, types, initialCommissioningYear",
          statusCode: HTTP_CODES.BAD_REQUEST,
          errorCode: "MILITARY_INFO_REQUIRED",
        });
      }

      const [genderCatalog] = await Promise.all([
        resolveMilitaryGenderCatalogRecord({
          tx,
          value: gender,
          required: true,
          fieldName: "gender",
        }),
      ]);

      const created = await tx.military.create({
        data: (() => {
          const baseSearch = {
            fullname,
            militaryCode,
            rank: `${rank} ${getMilitaryRankLabel(rank)}`,
            position,
            gender,
            type: typeCatalogRows.map((item) => item.code).join(" "),
            assignedUnit: assignedUnitName || toUnit?.name || "",
            unitName: toUnit?.name || "",
          };
          return {
            fullname,
            rank,
            rankGroup: resolveMilitaryRankGroupFromCode(rank),
            position,
            gender,
            genderId: genderCatalog.id,
            militaryCode,
            searchNormalized: buildMilitarySearchNormalized(baseSearch),
            initialCommissioningYear,
            assignedUnitId: assignedUnitId || null,
            assignedUnit: assignedUnitName || toUnit?.name || null,
            unitId: toUnitId,
          };
        })(),
        select: {
          id: true,
          fullname: true,
          militaryCode: true,
          gender: true,
          unitId: true,
        },
      });

      if (typeCatalogRows.length > 0) {
        await tx.militaryTypeAssignment.createMany({
          data: typeCatalogRows.map((item) => ({
            militaryId: created.id,
            typeId: item.id,
          })),
          skipDuplicates: true,
        });
      }

      if (typeCatalogRows.length > 0) {
        await tx.militaryUnit.createMany({
          data: typeCatalogRows.map((item) => ({
            militaryId: created.id,
            typeId: item.id,
            unitId: toUnitId,
            transferInYear: transferYear,
            transferOutYear: null,
          })),
          skipDuplicates: true,
        });
      }

      if (canWriteTransferLog) {
        await tx.militaryTransferLog.create({
          data: {
            militaryId: created.id,
            fromUnitId: null,
            fromExternalUnitName: fromExternalUnitName || "Ngoài hệ thống",
            toUnitId,
            toExternalUnitName: null,
            transferYear,
            note: String(payload?.note || "").trim() || null,
            createdByUserId: actor.id,
          },
        });
      }

      return {
        action: "RECEIVE_FROM_VOID",
        military: created,
        types: typeCatalogRows.map((item) => ({
          id: item.id,
          code: item.code,
          name: item.name || null,
        })),
        fromUnit,
        toUnit,
      };
    }

    const assignmentHistory = await listAssignmentHistory({
      db: tx,
      militaryId: military.id,
    });
    const resolvedTypeId = inferTransferTypeId({
      military,
      parsedTypeId,
      assignmentHistory,
      typeCatalogRows,
    });
    const resolvedType =
      getMilitaryTypeRows(military).find((type) => Number(type.id) === Number(resolvedTypeId)) ||
      typeCatalogRows.find((type) => Number(type.id) === Number(resolvedTypeId)) ||
      null;
    const assignmentAnalysis = analyzeAssignmentHistory({
      assignments: assignmentHistory,
      year: transferYear,
      typeId: resolvedTypeId,
      strictEnd: true,
    });
    const activeAssignment = assignmentAnalysis.includeAssignment;

    if (fromUnitId && (!activeAssignment || activeAssignment.unitId !== fromUnitId)) {
      throw new AppError({
        message: "Quân nhân hiện không thuộc đơn vị đi đã chọn",
        statusCode: HTTP_CODES.CONFLICT,
        errorCode: "ACTIVE_ASSIGNMENT_MISMATCH",
      });
    }

    if (!fromUnitId && activeAssignment) {
      throw new AppError({
        message: "Loại quân nhân này đang có đơn vị bảo đảm, không thể nhận từ hư vô",
        statusCode: HTTP_CODES.CONFLICT,
        errorCode: "ACTIVE_ASSIGNMENT_EXISTS",
      });
    }

    if (activeAssignment && transferYear < Number(activeAssignment.transferInYear)) {
      throw new AppError({
        message: "Năm điều chuyển không thể nhỏ hơn năm vào đơn vị hiện tại",
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "INVALID_TRANSFER_YEAR",
      });
    }

    if (fromUnitId && activeAssignment) {
      await tx.militaryUnit.update({
        where: {
          id: activeAssignment.id,
        },
        data: {
          transferOutYear: transferYear,
        },
      });
    }

    if (toUnitId) {
      await ensureNoOverlapTransfer({
        tx,
        militaryId: military.id,
        typeId: resolvedTypeId,
        transferInYear: transferYear,
        transferOutYear: null,
      });

      await tx.militaryUnit.create({
        data: {
          militaryId: military.id,
          typeId: resolvedTypeId,
          unitId: toUnitId,
          transferInYear: transferYear,
          transferOutYear: null,
        },
      });

      const effectiveTypeText =
        typeCatalogRows.length > 0
          ? typeCatalogRows.map((item) => item.code).join(" ")
          : (military.typeAssignments || [])
              .map((item) => item.type?.code)
              .filter(Boolean)
              .join(" ");

      await tx.military.update({
        where: {
          id: military.id,
        },
        data: {
          unitId: toUnitId,
          assignedUnitId: assignedUnitId || null,
          ...(assignedUnitName
            ? {
                assignedUnit: assignedUnitName,
              }
            : {}),
          searchNormalized: buildMilitarySearchNormalized({
            fullname: military.fullname,
            militaryCode: military.militaryCode,
            rank: `${military.rank} ${getMilitaryRankLabel(military.rank)}`,
            position: military.position,
            gender: military.gender,
            type: effectiveTypeText,
            assignedUnit: assignedUnitName || military.assignedUnit || toUnit?.name || "",
            unitName: toUnit?.name || "",
          }),
        },
      });

      if (typeCatalogRows.length > 0) {
        await tx.militaryTypeAssignment.createMany({
          data: typeCatalogRows.map((item) => ({
            militaryId: military.id,
            typeId: item.id,
          })),
          skipDuplicates: true,
        });
      }
    }

    if (canWriteTransferLog) {
      await tx.militaryTransferLog.create({
        data: {
          militaryId: military.id,
          fromUnitId,
          fromExternalUnitName: fromUnitId ? null : fromExternalUnitName || "Ngoài hệ thống",
          toUnitId,
          toExternalUnitName: toUnitId ? null : toExternalUnitName || "Ngoài hệ thống",
          transferYear,
          note: String(payload?.note || "").trim() || null,
          createdByUserId: actor.id,
        },
      });
    }

      return {
        action:
          fromUnitId && toUnitId
            ? "TRANSFER_UNIT"
            : fromUnitId && !toUnitId
              ? "CUT_TO_VOID"
              : "RECEIVE_FROM_VOID",
        military,
        type: resolvedType
          ? {
              id: resolvedType.id,
              code: resolvedType.code,
              name: resolvedType.name || null,
            }
          : null,
        fromUnit,
        toUnit,
      };
  });

  return result;
}
