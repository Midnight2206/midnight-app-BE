import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import { parseInteger } from "#services/militaries/common.js";
import {
  assertAdmin,
  hasRole,
  resolveActorUnitId,
} from "#services/sizeRegistrationWorkflow/common.js";

export async function listPeriods({ actor }) {
  assertAdmin(actor);
  const isSuperAdmin = hasRole(actor, "SUPER_ADMIN");
  const actorUnitId = parseInteger(actor?.unitId, "actor.unitId");
  if (!isSuperAdmin && !actorUnitId) {
    throw new AppError({
      message: "Tài khoản chưa được gán đơn vị",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "UNIT_NOT_ASSIGNED",
    });
  }

  const periods = await prisma.sizeRegistrationPeriod.findMany({
    where: actorUnitId
      ? {
          unitId: actorUnitId,
        }
      : isSuperAdmin
        ? {}
        : undefined,
    orderBy: {
      year: "desc",
    },
    select: {
      id: true,
      year: true,
      unitId: true,
      status: true,
      openedAt: true,
      closedAt: true,
      note: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return { periods };
}

export async function upsertPeriodStatus({ actor, year, status, note }) {
  assertAdmin(actor);
  const actorUnitId = resolveActorUnitId(actor);

  const existed = await prisma.sizeRegistrationPeriod.findFirst({
    where: {
      year,
      unitId: actorUnitId,
    },
    select: { id: true, status: true },
  });

  const now = new Date();
  const period = existed
    ? await prisma.sizeRegistrationPeriod.update({
        where: {
          id: existed.id,
        },
        data: {
          status,
          note: note || null,
          updatedById: actor.id,
          openedAt: status === "OPEN" ? now : undefined,
          closedAt: status === "LOCKED" ? now : undefined,
        },
      })
    : await prisma.sizeRegistrationPeriod.create({
        data: {
          year,
          unitId: actorUnitId,
          status,
          note: note || null,
          createdById: actor.id,
          updatedById: actor.id,
          openedAt: status === "OPEN" ? now : null,
          closedAt: status === "LOCKED" ? now : null,
        },
      });

  return {
    id: period.id,
    year: period.year,
    unitId: period.unitId,
    status: period.status,
    openedAt: period.openedAt,
    closedAt: period.closedAt,
    note: period.note,
  };
}
