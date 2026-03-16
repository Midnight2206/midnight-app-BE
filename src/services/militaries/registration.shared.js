import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import { parseInteger } from "#services/militaries/common.js";
import { analyzeAssignmentHistory, listAssignmentHistory } from "#services/militaries/unit-history.js";

export function getDefaultYearOptions() {
  const years = [];
  const currentYear = new Date().getFullYear();
  for (let year = currentYear + 2; year >= currentYear - 1; year -= 1) {
    years.push(year);
  }
  return years;
}

export function parseRegistrationYear(rawYear) {
  const parsed = parseInteger(rawYear, "year");
  return parsed || new Date().getFullYear();
}

export async function upsertPeriodForYear({ year, unitId, actorId }) {
  const existed = await prisma.sizeRegistrationPeriod.findFirst({
    where: {
      year,
      unitId,
    },
    select: { id: true },
  });

  if (existed) {
    return existed;
  }

  return prisma.sizeRegistrationPeriod.create({
    data: {
      year,
      unitId,
      status: "LOCKED",
      createdById: actorId || null,
      updatedById: actorId || null,
    },
    select: { id: true },
  });
}

export async function getRegistrationCategories() {
  const categories = await prisma.category.findMany({
    where: {
      deletedAt: null,
      isOneSize: false,
    },
    include: {
      sizes: {
        where: {
          deletedAt: null,
          size: {
            deletedAt: null,
          },
        },
        include: {
          size: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          sizeId: "asc",
        },
      },
    },
    orderBy: {
      id: "asc",
    },
  });

  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    isOneSize: category.isOneSize,
    sizes: category.sizes.map((item) => item.size),
  }));
}

export async function getRegistrationEligibility({
  militaryId,
  year,
  unitId,
  db = prisma,
}) {
  if (!militaryId || !year || !unitId) {
    return {
      isEligible: false,
      reason: "MISSING_CONTEXT",
      message: "Không đủ thông tin để kiểm tra quyền đăng ký.",
    };
  }

  const assignmentHistory = await listAssignmentHistory({
    db,
    militaryId,
    scopeUnitId: unitId,
  });
  const assignmentAnalysis = analyzeAssignmentHistory({
    assignments: assignmentHistory,
    year,
    scopeUnitId: unitId,
    strictEnd: true,
  });

  const pendingTransfer = await db.militaryTransferRequest.findFirst({
    where: {
      militaryId,
      fromUnitId: unitId,
      status: "PENDING",
      transferYear: {
        lte: year,
      },
    },
    select: {
      id: true,
      transferYear: true,
    },
  });

  if (pendingTransfer) {
    return {
      isEligible: false,
      reason: "PENDING_TRANSFER",
      message: "Quân nhân đang chờ chuyển đơn vị, không thể đăng ký cỡ số.",
    };
  }

  if (!assignmentAnalysis.currentAssignment) {
    return {
      isEligible: false,
      reason: "TRANSFERRED_OUT",
      message: "Quân nhân đã chuyển khỏi đơn vị trong năm này, không thể đăng ký cỡ số.",
    };
  }

  return {
    isEligible: true,
    reason: null,
    message: null,
  };
}

export async function assertEligibleForRegistration({
  militaryId,
  year,
  unitId,
  db = prisma,
}) {
  const eligibility = await getRegistrationEligibility({
    militaryId,
    year,
    unitId,
    db,
  });

  if (!eligibility.isEligible) {
    throw new AppError({
      message: eligibility.message || "Không thể đăng ký cỡ số cho quân nhân này.",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "REGISTRATION_NOT_ELIGIBLE",
      metadata: {
        reason: eligibility.reason,
      },
    });
  }

  return eligibility;
}
