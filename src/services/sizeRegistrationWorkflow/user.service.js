import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import { parseInteger } from "#services/militaries/common.js";
import { getRegistrationCategories } from "#services/militaries/registration.js";
import {
  assertEligibleForRegistration,
  getRegistrationEligibility,
} from "#services/militaries/registration.shared.js";
import {
  assertUser,
  getClaimedMilitaryOrThrow,
  getOrCreatePeriodByYear,
  validateRegistrationPairs,
} from "#services/sizeRegistrationWorkflow/common.js";

export async function getMyContext({ actor, year }) {
  assertUser(actor);

  const claimedMilitary = await getClaimedMilitaryOrThrow(actor);
  const parsedYear = parseInteger(year, "year") || new Date().getFullYear();

  const period = await prisma.sizeRegistrationPeriod.findFirst({
    where: {
      year: parsedYear,
      unitId: claimedMilitary.unitId,
    },
    select: {
      id: true,
      year: true,
      unitId: true,
      status: true,
      openedAt: true,
      closedAt: true,
      note: true,
    },
  });

  const categories = await getRegistrationCategories();

  const registrations = await prisma.militaryCategorySizeYearly.findMany({
    where: {
      year: parsedYear,
      militaryId: claimedMilitary.id,
      deletedAt: null,
    },
    select: {
      id: true,
      categoryId: true,
      sizeId: true,
    },
    orderBy: {
      categoryId: "asc",
    },
  });

  const latestPendingRequest = await prisma.sizeRegistrationRequest.findFirst({
    where: {
      year: parsedYear,
      militaryId: claimedMilitary.id,
      status: "PENDING",
    },
    select: {
      id: true,
      status: true,
      submitNote: true,
      submittedAt: true,
      items: {
        select: {
          categoryId: true,
          sizeId: true,
        },
      },
    },
    orderBy: {
      submittedAt: "desc",
    },
  });

  const registrationEligibility = await getRegistrationEligibility({
    militaryId: claimedMilitary.id,
    year: parsedYear,
    unitId: claimedMilitary.unitId,
  });

  return {
    period,
    military: claimedMilitary,
    categories,
    registrations,
    registrationEligibility,
    pendingRequest: latestPendingRequest
      ? {
          id: latestPendingRequest.id,
          status: latestPendingRequest.status,
          submitNote: latestPendingRequest.submitNote,
          submittedAt: latestPendingRequest.submittedAt,
          registrations: latestPendingRequest.items,
        }
      : null,
  };
}

export async function submitMyRequest({ actor, body }) {
  assertUser(actor);

  const year = Number(body.year);
  const claimedMilitary = await getClaimedMilitaryOrThrow(actor);
  const period = await getOrCreatePeriodByYear({
    year,
    unitId: claimedMilitary.unitId,
    actorId: actor.id,
  });

  if (period.status !== "OPEN") {
    throw new AppError({
      message: `Đợt đăng ký cỡ số năm ${year} của đơn vị bạn đang khóa`,
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "REGISTRATION_PERIOD_LOCKED",
    });
  }

  await assertEligibleForRegistration({
    militaryId: claimedMilitary.id,
    year,
    unitId: claimedMilitary.unitId,
  });

  const registrations = await validateRegistrationPairs(body.registrations || []);

  const existedPending = await prisma.sizeRegistrationRequest.findFirst({
    where: {
      year,
      militaryId: claimedMilitary.id,
      status: "PENDING",
    },
    select: { id: true },
  });

  if (existedPending) {
    throw new AppError({
      message: "Bạn đã có một yêu cầu đang chờ duyệt cho năm này",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "PENDING_REQUEST_EXISTS",
    });
  }

  const request = await prisma.sizeRegistrationRequest.create({
    data: {
      periodId: period.id,
      year,
      militaryId: claimedMilitary.id,
      submittedByUserId: actor.id,
      submitNote: body.note || null,
      items: {
        create: registrations.map((item) => ({
          categoryId: item.categoryId,
          sizeId: item.sizeId,
        })),
      },
    },
    select: {
      id: true,
      year: true,
      status: true,
      submittedAt: true,
    },
  });

  return request;
}
