import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import { assertSizeRegistrationAccess, parseInteger } from "#services/militaries/common.js";
import {
  ensureNoOverlapTransfer,
  findUnitOrThrow,
} from "#services/militaries/transfer.shared.js";
import { getAssignmentByYear } from "#services/militaries/unit-history.js";

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
  const currentYear = new Date().getFullYear();

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

    const [activeAssignment, military] = await Promise.all([
      getAssignmentByYear({
        db: tx,
        militaryId,
        typeId: parsedTypeId,
        year: currentYear,
        strictEnd: true,
        includeUnit: true,
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
        },
      }),
    ]);

    if (!activeAssignment || !military) {
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

    await tx.militaryUnit.updateMany({
      where: {
        militaryId,
        typeId: parsedTypeId,
        unitId: activeAssignment.unitId,
        transferOutYear: null,
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

export async function acceptTransferRequest({ actor, requestId }) {
  const actorUnitId = assertSizeRegistrationAccess(actor);
  const currentYear = new Date().getFullYear();

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

    const activeAssignment = await getAssignmentByYear({
      db: tx,
      militaryId: request.militaryId,
      typeId: request.typeId,
      year: currentYear,
      strictEnd: true,
    });

    if (activeAssignment) {
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
  const currentYear = new Date().getFullYear();
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

    const sourceAssignment = await tx.militaryUnit.findFirst({
      where: {
        militaryId: request.militaryId,
        typeId: request.typeId,
        unitId: request.fromUnitId,
        transferOutYear: request.transferYear,
      },
      orderBy: {
        transferInYear: "desc",
      },
      select: {
        id: true,
      },
    });

    if (!sourceAssignment) {
      throw new AppError({
        message: "Không tìm thấy bản ghi cắt bảo đảm để hoàn tác",
        statusCode: HTTP_CODES.CONFLICT,
        errorCode: "CUT_ASSIGNMENT_NOT_FOUND",
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
