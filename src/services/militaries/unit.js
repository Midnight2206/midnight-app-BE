import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import {
  assertAdminAccess,
  assertSuperAdminAccess,
  parseInteger,
} from "#services/militaries/common.js";

export function normalizeUnitName(name) {
  return String(name || "").normalize("NFC").trim();
}

export function normalizeUnitNameForCompare(name) {
  return normalizeUnitName(name).toLowerCase();
}

export async function listUnits({ actor, scope }) {
  const { isSuperAdmin } = assertAdminAccess(actor);
  const normalizedScope = String(scope || "").trim().toLowerCase();

  if (isSuperAdmin || normalizedScope === "all") {
    const units = await prisma.unit.findMany({
      where: {
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        id: "asc",
      },
    });

    return { units };
  }

  const actorUnitId = parseInteger(actor.unitId, "actor.unitId");
  const unit = await prisma.unit.findFirst({
    where: {
      id: actorUnitId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
    },
  });

  return {
    units: unit ? [unit] : [],
  };
}

export async function createUnit({ actor, body }) {
  assertSuperAdminAccess(actor);

  const normalizedName = normalizeUnitName(body?.name);
  if (!normalizedName) {
    throw new AppError({
      message: "Unit name is required",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "UNIT_NAME_REQUIRED",
    });
  }

  const nameNormalized = normalizeUnitNameForCompare(normalizedName);

  const existed = await prisma.unit.findFirst({
    where: {
      nameNormalized,
    },
  });

  if (existed && !existed.deletedAt) {
    throw new AppError({
      message: "Unit already exists",
      statusCode: HTTP_CODES.CONFLICT,
      errorCode: "UNIT_EXISTS",
    });
  }

  const unit = existed
    ? await prisma.unit.update({
        where: {
          id: existed.id,
        },
        data: {
          name: normalizedName,
          nameNormalized,
          deletedAt: null,
        },
      })
    : await prisma.unit.create({
        data: {
          name: normalizedName,
          nameNormalized,
        },
      });

  return {
    id: unit.id,
    name: unit.name,
  };
}
