import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import { parseInteger } from "#services/militaries/common.js";

export function hasRole(actor, role) {
  return (actor?.roles || []).includes(role);
}

export function assertAdmin(actor) {
  if (!hasRole(actor, "ADMIN") && !hasRole(actor, "SUPER_ADMIN")) {
    throw new AppError({
      message: "Only ADMIN can manage registration periods",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "REGISTRATION_ADMIN_FORBIDDEN",
    });
  }
}

export function assertUser(actor) {
  if (!hasRole(actor, "USER")) {
    throw new AppError({
      message: "Only USER can submit registration request",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "REGISTRATION_USER_FORBIDDEN",
    });
  }
}

export function resolveActorUnitId(actor) {
  const unitId = parseInteger(actor?.unitId, "actor.unitId");
  if (!unitId) {
    throw new AppError({
      message: "Tài khoản chưa được gán đơn vị",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "UNIT_NOT_ASSIGNED",
    });
  }
  return unitId;
}

export async function getClaimedMilitaryOrThrow(actor) {
  const military = await prisma.military.findFirst({
    where: {
      claimedByUserId: actor.id,
      deletedAt: null,
    },
    select: {
      id: true,
      fullname: true,
      militaryCode: true,
      unitId: true,
    },
  });

  if (!military) {
    throw new AppError({
      message: "Bạn chưa claim hồ sơ quân nhân nên chưa thể đăng ký cỡ số",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "MILITARY_CLAIM_REQUIRED",
    });
  }

  return military;
}

export async function getOrCreatePeriodByYear({ year, unitId, actorId }) {
  const existed = await prisma.sizeRegistrationPeriod.findFirst({
    where: {
      year,
      unitId,
    },
  });

  if (existed) return existed;

  return prisma.sizeRegistrationPeriod.create({
    data: {
      year,
      unitId,
      status: "LOCKED",
      createdById: actorId,
      updatedById: actorId,
    },
  });
}

export async function validateRegistrationPairs(registrations) {
  const list = Array.isArray(registrations) ? registrations : [];

  const categoryIds = list.map((item) => Number(item.categoryId));
  const uniqueCategoryIds = new Set(categoryIds);
  if (uniqueCategoryIds.size !== categoryIds.length) {
    throw new AppError({
      message: "Mỗi danh mục chỉ được chọn một cỡ",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "DUPLICATE_CATEGORY_REGISTRATION",
    });
  }

  if (list.length === 0) return [];

  const categorySizePairs = list.map((item) => ({
    categoryId: Number(item.categoryId),
    sizeId: Number(item.sizeId),
  }));

  const categoryIdsFilter = [...new Set(categorySizePairs.map((p) => p.categoryId))];
  const sizeIdsFilter = [...new Set(categorySizePairs.map((p) => p.sizeId))];

  const categorySizes = await prisma.categorySize.findMany({
    where: {
      categoryId: {
        in: categoryIdsFilter,
      },
      sizeId: {
        in: sizeIdsFilter,
      },
      deletedAt: null,
      category: {
        deletedAt: null,
      },
      size: {
        deletedAt: null,
      },
    },
    select: {
      categoryId: true,
      sizeId: true,
    },
  });

  const pairSet = new Set(
    categorySizes.map((item) => `${item.categoryId}:${item.sizeId}`),
  );

  const invalidPairs = categorySizePairs.filter(
    (pair) => !pairSet.has(`${pair.categoryId}:${pair.sizeId}`),
  );

  if (invalidPairs.length > 0) {
    throw new AppError({
      message: "Có danh mục-cỡ không hợp lệ",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "INVALID_CATEGORY_SIZE_REGISTRATION",
      metadata: {
        invalidPairs,
      },
    });
  }

  return categorySizePairs;
}
