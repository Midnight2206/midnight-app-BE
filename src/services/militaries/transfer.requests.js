import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import { assertSizeRegistrationAccess, parseInteger } from "#services/militaries/common.js";
import { buildMilitarySearchNormalized } from "#utils/searchNormalizer.js";
import {
  ensureNoOverlapTransfer,
  findUnitOrThrow,
} from "#services/militaries/transfer.shared.js";
import {
  analyzeAssignmentHistory,
  findClosedAssignmentByYear,
  listAssignmentHistory,
} from "#services/militaries/unit-history.js";
import { getMilitaryRankLabel } from "#services/militaries/profile-reference.js";
import { resolveAssignedUnitNameOrThrow } from "#services/militaries/assigned-unit.js";

function inferLegacyTransferInYear({ military, transferYear }) {
  const candidateYears = [
    Number(military?.initialCommissioningYear || 0),
    new Date(military?.createdAt || 0).getFullYear(),
    Number(transferYear || 0),
  ].filter((year) => Number.isInteger(year) && year > 0);

  return candidateYears.length > 0 ? Math.min(...candidateYears) : Number(transferYear || new Date().getFullYear());
}

export async function createCutTransferRequest({
  actor,
  militaryId,
  typeId,
  toUnitId,
  transferYear,
  note,
}) {
  const actorUnitId = assertSizeRegistrationAccess(actor);
  const parsedTypeId = parseInteger(typeId, "typeId");
  const parsedToUnitId = parseInteger(toUnitId, "toUnitId");
  const parsedTransferYear = parseInteger(transferYear, "transferYear");
  const normalizedNote = String(note || "").trim() || null;

  if (parsedToUnitId === actorUnitId) {
    throw new AppError({
      message: "Đơn vị nhận bảo đảm phải khác đơn vị hiện tại",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "TRANSFER_TARGET_SAME_UNIT",
    });
  }

  return prisma.$transaction(async (tx) => {
    const targetUnit = await findUnitOrThrow({
      tx,
      unitId: parsedToUnitId,
      fieldName: "toUnitId",
    });

    const [assignmentHistory, military] = await Promise.all([
      listAssignmentHistory({
        db: tx,
        militaryId,
        typeId: parsedTypeId,
        includeUnit: true,
        scopeUnitId: actorUnitId,
      }),
      tx.military.findFirst({
        where: {
          id: militaryId,
          deletedAt: null,
        },
      select: {
        id: true,
        fullname: true,
        militaryCode: true,
        unitId: true,
        initialCommissioningYear: true,
        createdAt: true,
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
              },
            },
          },
        },
      },
    }),
  ]);
    const assignmentAnalysis = analyzeAssignmentHistory({
      assignments: assignmentHistory,
      year: parsedTransferYear,
      typeId: parsedTypeId,
      scopeUnitId: actorUnitId,
      strictEnd: true,
    });
    let activeAssignment = assignmentAnalysis.includeAssignment;

    if (!military) {
      throw new AppError({
        message: "Không tìm thấy quân nhân đang được bảo đảm",
        statusCode: HTTP_CODES.NOT_FOUND,
        errorCode: "MILITARY_NOT_FOUND",
      });
    }

    if (!activeAssignment) {
      const hasSelectedType = (military.typeAssignments || []).some(
        (item) => Number(item?.type?.id || 0) === Number(parsedTypeId),
      );
      const hasAnyTypedHistory = await tx.militaryUnit.findFirst({
        where: {
          militaryId,
          typeId: parsedTypeId,
        },
        select: {
          id: true,
        },
      });

      if (
        !hasAnyTypedHistory &&
        hasSelectedType &&
        Number(military.unitId || 0) === Number(actorUnitId)
      ) {
        activeAssignment = await tx.militaryUnit.create({
          data: {
            militaryId,
            typeId: parsedTypeId,
            unitId: actorUnitId,
            transferInYear: inferLegacyTransferInYear({
              military,
              transferYear: parsedTransferYear,
            }),
          },
          include: {
            unit: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });
      }
    }

    if (!activeAssignment) {
      throw new AppError({
        message: "Không tìm thấy quân nhân đang được bảo đảm",
        statusCode: HTTP_CODES.NOT_FOUND,
        errorCode: "MILITARY_NOT_FOUND",
      });
    }

    if (activeAssignment.unitId !== actorUnitId) {
      throw new AppError({
        message: "Bạn chỉ được cắt bảo đảm quân nhân của đơn vị mình",
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

    if (parsedTransferYear < Number(activeAssignment.transferInYear)) {
      throw new AppError({
        message: "Năm điều chuyển không thể nhỏ hơn năm vào đơn vị hiện tại",
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "INVALID_TRANSFER_YEAR",
      });
    }

    const existedPending = await tx.militaryTransferRequest.findFirst({
      where: {
        militaryId,
        typeId: parsedTypeId,
        status: "PENDING",
      },
      select: {
        id: true,
      },
    });

    if (existedPending) {
      throw new AppError({
        message: "Quân nhân đã có yêu cầu điều chuyển đang chờ xử lý",
        statusCode: HTTP_CODES.CONFLICT,
        errorCode: "TRANSFER_REQUEST_PENDING_EXISTS",
      });
    }

    await tx.militaryUnit.update({
      where: {
        id: activeAssignment.id,
      },
      data: {
        transferOutYear: parsedTransferYear,
      },
    });

    const request = await tx.militaryTransferRequest.create({
      data: {
        militaryId,
        typeId: parsedTypeId,
        fromUnitId: actorUnitId,
        toUnitId: parsedToUnitId,
        transferYear: parsedTransferYear,
        note: normalizedNote,
        requestedByUserId: actor.id,
      },
      select: {
        id: true,
        militaryId: true,
        typeId: true,
        fromUnitId: true,
        toUnitId: true,
        transferYear: true,
        status: true,
      },
    });

    return {
      request,
      military,
      fromUnit: activeAssignment.unit,
      toUnit: targetUnit,
    };
  });
}

export async function listIncomingTransferRequests({ actor }) {
  const actorUnitId = assertSizeRegistrationAccess(actor);

  const requests = await prisma.militaryTransferRequest.findMany({
    where: {
      toUnitId: actorUnitId,
      status: "PENDING",
    },
    orderBy: {
      requestedAt: "desc",
    },
    select: {
      id: true,
      typeId: true,
      transferYear: true,
      note: true,
      requestedAt: true,
      military: {
        select: {
          id: true,
          fullname: true,
          militaryCode: true,
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
                  code: true,
                },
              },
            },
            orderBy: {
              typeId: "asc",
            },
          },
        },
      },
      type: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
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
    },
  });

  const mappedRequests = requests.map((request) => {
    const types = (request.military?.typeAssignments || [])
      .map((item) => item.type?.code)
      .filter(Boolean);

    return {
      ...request,
      military: request.military
        ? {
            ...request.military,
            types,
            type: types[0] || "",
            typeDisplay: types.join(", "),
          }
        : null,
    };
  });

  return {
    requests: mappedRequests,
    total: mappedRequests.length,
  };
}

export async function acceptTransferRequest({ actor, requestId, assignedUnitId }) {
  const actorUnitId = assertSizeRegistrationAccess(actor);
  const parsedAssignedUnitId = parseInteger(assignedUnitId, "assignedUnitId");

  return prisma.$transaction(async (tx) => {
    const request = await tx.militaryTransferRequest.findFirst({
      where: {
        id: requestId,
        status: "PENDING",
      },
      select: {
        id: true,
        militaryId: true,
        typeId: true,
        fromUnitId: true,
        toUnitId: true,
        transferYear: true,
        military: {
          select: {
            id: true,
            fullname: true,
            militaryCode: true,
            rank: true,
            position: true,
            gender: true,
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
              orderBy: {
                typeId: "asc",
              },
            },
          },
        },
      },
    });

    if (!request) {
      throw new AppError({
        message: "Không tìm thấy yêu cầu điều chuyển đang chờ",
        statusCode: HTTP_CODES.NOT_FOUND,
        errorCode: "TRANSFER_REQUEST_NOT_FOUND",
      });
    }

    if (request.toUnitId !== actorUnitId) {
      throw new AppError({
        message: "Bạn chỉ được nhận yêu cầu điều chuyển về đơn vị của mình",
        statusCode: HTTP_CODES.FORBIDDEN,
        errorCode: "TRANSFER_RECEIVE_SCOPE_FORBIDDEN",
      });
    }

    const assignedUnitName = await resolveAssignedUnitNameOrThrow({
      tx,
      assignedUnitId: parsedAssignedUnitId,
      unitId: request.toUnitId,
    });

    const assignmentHistory = await listAssignmentHistory({
      db: tx,
      militaryId: request.militaryId,
      typeId: request.typeId,
    });
    const assignmentAnalysis = analyzeAssignmentHistory({
      assignments: assignmentHistory,
      year: request.transferYear,
      typeId: request.typeId,
      strictEnd: true,
    });
    const activeAssignment = assignmentAnalysis.includeAssignment;

    if (activeAssignment && activeAssignment.unitId === request.fromUnitId) {
      await tx.militaryUnit.update({
        where: {
          id: activeAssignment.id,
        },
        data: {
          transferOutYear: request.transferYear,
        },
      });
    } else if (activeAssignment) {
      throw new AppError({
        message: "Quân nhân đang có đơn vị bảo đảm active, chưa thể nhận",
        statusCode: HTTP_CODES.CONFLICT,
        errorCode: "ACTIVE_ASSIGNMENT_EXISTS",
      });
    }

    await ensureNoOverlapTransfer({
      tx,
      militaryId: request.militaryId,
      typeId: request.typeId,
      transferInYear: request.transferYear,
      transferOutYear: null,
    });

    await tx.militaryUnit.create({
      data: {
        militaryId: request.militaryId,
        typeId: request.typeId,
        unitId: request.toUnitId,
        transferInYear: request.transferYear,
      },
    });

    await tx.military.update({
      where: {
        id: request.militaryId,
      },
      data: {
        unitId: request.toUnitId,
        assignedUnitId: parsedAssignedUnitId,
        assignedUnit: assignedUnitName,
        searchNormalized: buildMilitarySearchNormalized({
          fullname: request.military.fullname,
          militaryCode: request.military.militaryCode,
          rank: `${request.military.rank} ${getMilitaryRankLabel(request.military.rank)}`,
          position: request.military.position,
          gender: request.military.gender,
          type: (request.military.typeAssignments || [])
            .map((item) => item.type?.code)
            .filter(Boolean)
            .join(" "),
          assignedUnit: assignedUnitName,
        }),
      },
    });

    const updatedRequest = await tx.militaryTransferRequest.update({
      where: {
        id: request.id,
      },
      data: {
        status: "ACCEPTED",
        reviewedByUserId: actor.id,
        reviewedAt: new Date(),
      },
      select: {
        id: true,
        status: true,
      },
    });

    return {
      request: updatedRequest,
      military: request.military,
    };
  });
}

export async function undoCutTransferRequest({ actor, requestId }) {
  const actorUnitId = assertSizeRegistrationAccess(actor);
  const closedStatusErrors = {
    ACCEPTED: {
      message: "Đơn vị mới đã nhận bảo đảm quân trang, không thể hoàn tác",
      errorCode: "TRANSFER_REQUEST_ALREADY_ACCEPTED",
    },
    REJECTED: {
      message: "Yêu cầu điều chuyển đã bị từ chối, không thể hoàn tác",
      errorCode: "TRANSFER_REQUEST_ALREADY_REJECTED",
    },
    CANCELLED: {
      message: "Yêu cầu điều chuyển đã được hoàn tác trước đó",
      errorCode: "TRANSFER_REQUEST_ALREADY_CANCELLED",
    },
  };

  return prisma.$transaction(async (tx) => {
    const request = await tx.militaryTransferRequest.findFirst({
      where: {
        id: requestId,
      },
      select: {
        id: true,
        militaryId: true,
        typeId: true,
        fromUnitId: true,
        transferYear: true,
        status: true,
      },
    });

    if (!request) {
      throw new AppError({
        message: "Không tìm thấy yêu cầu điều chuyển đang chờ để hoàn tác",
        statusCode: HTTP_CODES.NOT_FOUND,
        errorCode: "TRANSFER_REQUEST_NOT_FOUND",
      });
    }

    if (request.fromUnitId !== actorUnitId) {
      throw new AppError({
        message: "Bạn chỉ được hoàn tác yêu cầu do đơn vị mình tạo",
        statusCode: HTTP_CODES.FORBIDDEN,
        errorCode: "TRANSFER_UNDO_SCOPE_FORBIDDEN",
      });
    }

    const closedStatusError = closedStatusErrors[request.status];
    if (closedStatusError) {
      throw new AppError({
        message: closedStatusError.message,
        statusCode: HTTP_CODES.CONFLICT,
        errorCode: closedStatusError.errorCode,
      });
    }

    if (request.status !== "PENDING") {
      throw new AppError({
        message: "Yêu cầu điều chuyển không còn ở trạng thái chờ để hoàn tác",
        statusCode: HTTP_CODES.CONFLICT,
        errorCode: "TRANSFER_REQUEST_NOT_PENDING",
      });
    }

    const assignmentHistory = await listAssignmentHistory({
      db: tx,
      militaryId: request.militaryId,
      typeId: request.typeId,
      scopeUnitId: request.fromUnitId,
    });
    const sourceAssignment =
      findClosedAssignmentByYear({
        assignments: assignmentHistory,
        year: request.transferYear,
      }) ||
      analyzeAssignmentHistory({
        assignments: assignmentHistory,
        year: request.transferYear,
        typeId: request.typeId,
        scopeUnitId: request.fromUnitId,
        strictEnd: false,
      }).showAssignment ||
      null;

    if (!sourceAssignment) {
      throw new AppError({
        message: "Không tìm thấy bản ghi cắt bảo đảm để hoàn tác",
        statusCode: HTTP_CODES.CONFLICT,
        errorCode: "CUT_ASSIGNMENT_NOT_FOUND",
      });
    }

    if (
      sourceAssignment.transferOutYear !== null &&
      Number(sourceAssignment.transferOutYear) !== Number(request.transferYear)
    ) {
      throw new AppError({
        message: "Bản ghi nguồn không còn khớp với năm cắt của yêu cầu, không thể hoàn tác",
        statusCode: HTTP_CODES.CONFLICT,
        errorCode: "CUT_ASSIGNMENT_STATE_MISMATCH",
      });
    }

    await tx.militaryUnit.update({
      where: {
        id: sourceAssignment.id,
      },
      data: {
        transferOutYear: null,
      },
    });

    const cancelled = await tx.militaryTransferRequest.update({
      where: {
        id: request.id,
      },
      data: {
        status: "CANCELLED",
        cancelledByUserId: actor.id,
        cancelledAt: new Date(),
      },
      select: {
        id: true,
        status: true,
      },
    });

    return {
      request: cancelled,
    };
  });
}
