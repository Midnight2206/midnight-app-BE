import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import { parseInteger } from "#services/militaries/common.js";
import {
  assertAdmin,
  getOrCreatePeriodByYear,
  hasRole,
} from "#services/sizeRegistrationWorkflow/common.js";

export async function listRequests({ actor, year, status, page, limit }) {
  assertAdmin(actor);

  const isSuperAdmin = hasRole(actor, "SUPER_ADMIN");
  const actorUnitId = parseInteger(actor.unitId, "actor.unitId");
  const parsedYear = parseInteger(year, "year");
  const normalizedStatus = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"].includes(
    String(status || "").toUpperCase(),
  )
    ? String(status).toUpperCase()
    : undefined;

  const currentPage = parseInteger(page, "page") || 1;
  const pageSize = parseInteger(limit, "limit") || 20;
  const skip = (currentPage - 1) * pageSize;

  const where = {
    ...(parsedYear ? { year: parsedYear } : {}),
    ...(normalizedStatus ? { status: normalizedStatus } : {}),
    ...(isSuperAdmin
      ? {}
      : {
          military: {
            unitId: actorUnitId,
          },
        }),
  };

  const [total, requests] = await prisma.$transaction([
    prisma.sizeRegistrationRequest.count({ where }),
    prisma.sizeRegistrationRequest.findMany({
      where,
      select: {
        id: true,
        year: true,
        status: true,
        submitNote: true,
        reviewNote: true,
        submittedAt: true,
        reviewedAt: true,
        submittedBy: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
        reviewedBy: {
          select: {
            id: true,
            username: true,
          },
        },
        military: {
          select: {
            id: true,
            fullname: true,
            militaryCode: true,
            unitId: true,
            unit: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        items: {
          select: {
            categoryId: true,
            sizeId: true,
            category: {
              select: {
                name: true,
              },
            },
            size: {
              select: {
                name: true,
              },
            },
          },
          orderBy: {
            categoryId: "asc",
          },
        },
      },
      orderBy: {
        submittedAt: "desc",
      },
      skip,
      take: pageSize,
    }),
  ]);

  return {
    requests,
    pagination: {
      page: currentPage,
      limit: pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

export async function reviewRequest({ actor, requestId, action, reviewNote }) {
  assertAdmin(actor);

  const isSuperAdmin = hasRole(actor, "SUPER_ADMIN");
  const actorUnitId = parseInteger(actor.unitId, "actor.unitId");

  const request = await prisma.sizeRegistrationRequest.findUnique({
    where: { id: requestId },
    include: {
      military: {
        select: {
          id: true,
          unitId: true,
        },
      },
      items: {
        select: {
          categoryId: true,
          sizeId: true,
        },
      },
    },
  });

  if (!request) {
    throw new AppError({
      message: "Registration request not found",
      statusCode: HTTP_CODES.NOT_FOUND,
      errorCode: "REGISTRATION_REQUEST_NOT_FOUND",
    });
  }

  if (!isSuperAdmin && request.military.unitId !== actorUnitId) {
    throw new AppError({
      message: "Bạn chỉ có thể duyệt yêu cầu trong đơn vị của mình",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "UNIT_SCOPE_FORBIDDEN",
    });
  }

  if (request.status !== "PENDING") {
    throw new AppError({
      message: "Yêu cầu này không còn ở trạng thái chờ duyệt",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "REQUEST_NOT_PENDING",
    });
  }

  const now = new Date();

  if (action === "REJECT") {
    const rejected = await prisma.sizeRegistrationRequest.update({
      where: { id: requestId },
      data: {
        status: "REJECTED",
        reviewNote: reviewNote || null,
        reviewedByUserId: actor.id,
        reviewedAt: now,
      },
      select: {
        id: true,
        status: true,
        reviewedAt: true,
      },
    });

    return rejected;
  }

  const period = await getOrCreatePeriodByYear({
    year: request.year,
    unitId: request.military.unitId,
    actorId: actor.id,
  });

  await prisma.$transaction(async (tx) => {
    await tx.sizeRegistrationRequest.update({
      where: { id: requestId },
      data: {
        status: "APPROVED",
        reviewNote: reviewNote || null,
        reviewedByUserId: actor.id,
        reviewedAt: now,
      },
    });

    await tx.militaryCategorySizeYearly.deleteMany({
      where: {
        year: request.year,
        militaryId: request.militaryId,
      },
    });

    if (request.items.length > 0) {
      await tx.militaryCategorySizeYearly.createMany({
        data: request.items.map((item) => ({
          periodId: period.id,
          year: request.year,
          militaryId: request.militaryId,
          categoryId: item.categoryId,
          sizeId: item.sizeId,
          source: "APPROVED_REQUEST",
          requestId,
        })),
        skipDuplicates: true,
      });
    }
  });

  return {
    id: requestId,
    status: "APPROVED",
    reviewedAt: now,
  };
}
