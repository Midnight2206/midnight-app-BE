import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import {
  assertAdminAccess,
  assertSizeRegistrationAccess,
  parseInteger,
} from "#services/militaries/common.js";
import {
  assertEligibleForRegistration,
  getDefaultYearOptions,
  getRegistrationCategories,
  parseRegistrationYear,
  upsertPeriodForYear,
} from "#services/militaries/registration.shared.js";

export async function reset({ actor, unitId }) {
  const { isSuperAdmin } = assertAdminAccess(actor);
  if (!isSuperAdmin) {
    throw new AppError({
      message: "Only SUPER_ADMIN can reset military data",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "RESET_FORBIDDEN",
    });
  }

  const parsedUnitId = parseInteger(unitId, "unitId");
  const where = {
    deletedAt: null,
    ...(parsedUnitId ? { unitId: parsedUnitId } : {}),
  };

  const militaries = await prisma.military.findMany({
    where,
    select: { id: true },
  });

  if (militaries.length === 0) {
    return {
      deletedCount: 0,
      unitId: parsedUnitId,
    };
  }

  const militaryIds = militaries.map((item) => item.id);

  await prisma.$transaction(async (tx) => {
    await tx.military.deleteMany({
      where: {
        id: {
          in: militaryIds,
        },
      },
    });
  });

  return {
    deletedCount: militaryIds.length,
    unitId: parsedUnitId,
  };
}

export async function getRegistrationOptions({ actor }) {
  assertSizeRegistrationAccess(actor);
  const categories = await getRegistrationCategories();
  return { categories };
}

export async function listRegistrationYears({ actor }) {
  const actorUnitId = parseInteger(actor?.unitId, "actor.unitId");

  const [periodYears, dataYears] = await prisma.$transaction([
    prisma.sizeRegistrationPeriod.findMany({
      where: actorUnitId
        ? {
            unitId: actorUnitId,
          }
        : undefined,
      select: {
        year: true,
        status: true,
      },
      orderBy: {
        year: "desc",
      },
    }),
    prisma.militaryCategorySizeYearly.findMany({
      where: {
        ...(actorUnitId
          ? {
              military: {
                unitId: actorUnitId,
              },
            }
          : {}),
        deletedAt: null,
      },
      select: {
        year: true,
      },
      distinct: ["year"],
      orderBy: {
        year: "desc",
      },
    }),
  ]);

  let catalogYears = [];
  try {
    const rows = await prisma.registrationYearOption.findMany({
      where: {
        isActive: true,
      },
      select: {
        year: true,
      },
      orderBy: {
        year: "desc",
      },
    });
    catalogYears = rows.map((item) => item.year);
  } catch {
    catalogYears = [];
  }

  if (catalogYears.length === 0) {
    catalogYears = getDefaultYearOptions();
  }

  const periodMap = new Map(periodYears.map((item) => [item.year, item]));
  const dataYearSet = new Set(dataYears.map((item) => item.year));
  const years = [...new Set(catalogYears)]
    .sort((a, b) => b - a)
    .map((year) => ({
      year,
      status: periodMap.get(year)?.status || null,
      hasData: dataYearSet.has(year),
    }));

  const renderYears = years
    .filter((item) => item.hasData)
    .map((item) => item.year);

  const importYears = years.map((item) => item.year);

  return {
    years,
    renderYears,
    importYears,
  };
}

export async function createRegistrationYear({ actor, body }) {
  assertAdminAccess(actor);
  const isSuperAdmin = (actor?.roles || []).includes("SUPER_ADMIN");
  if (!isSuperAdmin) {
    throw new AppError({
      message: "Only SUPER_ADMIN can add registration years",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "REGISTRATION_YEAR_FORBIDDEN",
    });
  }

  const year = parseInteger(body?.year, "year");
  if (!year || year < 2020 || year > 2100) {
    throw new AppError({
      message: "year must be between 2020 and 2100",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "INVALID_REGISTRATION_YEAR",
    });
  }

  const isActive = body?.isActive === undefined ? true : Boolean(body.isActive);

  const row = await prisma.registrationYearOption.upsert({
    where: { year },
    update: {
      isActive,
    },
    create: {
      year,
      isActive,
    },
    select: {
      year: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return row;
}

export async function getMilitaryRegistrations({ actor, militaryId, year }) {
  const actorUnitId = assertSizeRegistrationAccess(actor);
  const selectedYear = parseRegistrationYear(year);

  const military = await prisma.military.findFirst({
    where: {
      id: militaryId,
      deletedAt: null,
    },
    select: {
      id: true,
      fullname: true,
      militaryCode: true,
      unitId: true,
      assignedUnit: true,
    },
  });

  if (!military) {
    throw new AppError({
      message: "Military not found",
      statusCode: HTTP_CODES.NOT_FOUND,
      errorCode: "MILITARY_NOT_FOUND",
    });
  }

  if (military.unitId !== actorUnitId) {
    throw new AppError({
      message: "Admin can only manage own unit data",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "UNIT_SCOPE_FORBIDDEN",
    });
  }

  await assertEligibleForRegistration({
    militaryId,
    year: selectedYear,
    unitId: actorUnitId,
  });

  const registrations = await prisma.militaryCategorySizeYearly.findMany({
    where: {
      year: selectedYear,
      militaryId,
      deletedAt: null,
    },
    select: {
      id: true,
      categoryId: true,
      sizeId: true,
      category: {
        select: {
          id: true,
          name: true,
          isOneSize: true,
        },
      },
      categorySize: {
        select: {
          size: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
    orderBy: {
      categoryId: "asc",
    },
  });

  const visibleRegistrations = registrations.filter((item) => !item.category?.isOneSize);

  return {
    year: selectedYear,
    military,
    registrations: visibleRegistrations.map((item) => ({
      id: item.id,
      categoryId: item.categoryId,
      sizeId: item.sizeId,
      category: item.category,
      size: item.categorySize.size,
    })),
  };
}

export async function updateMilitaryRegistrations({
  actor,
  militaryId,
  year,
  registrations,
}) {
  const actorUnitId = assertSizeRegistrationAccess(actor);
  const selectedYear = parseRegistrationYear(year);
  const list = Array.isArray(registrations) ? registrations : [];

  const military = await prisma.military.findFirst({
    where: {
      id: militaryId,
      deletedAt: null,
    },
    select: {
      id: true,
      unitId: true,
    },
  });

  if (!military) {
    throw new AppError({
      message: "Military not found",
      statusCode: HTTP_CODES.NOT_FOUND,
      errorCode: "MILITARY_NOT_FOUND",
    });
  }

  if (military.unitId !== actorUnitId) {
    throw new AppError({
      message: "Admin can only manage own unit data",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "UNIT_SCOPE_FORBIDDEN",
    });
  }

  const categoryIds = list.map((item) => Number(item.categoryId));
  const uniqueCategoryIds = new Set(categoryIds);
  if (uniqueCategoryIds.size !== categoryIds.length) {
    throw new AppError({
      message: "Each category can only be registered once per military",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "DUPLICATE_CATEGORY_REGISTRATION",
    });
  }

  if (list.length > 0) {
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
        message: "One or more category-size registrations are invalid",
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "INVALID_CATEGORY_SIZE_REGISTRATION",
        metadata: {
          invalidPairs,
        },
      });
    }
  }

  const period = await upsertPeriodForYear({
    year: selectedYear,
    unitId: actorUnitId,
    actorId: actor?.id,
  });

  await prisma.$transaction(async (tx) => {
    await tx.militaryCategorySizeYearly.deleteMany({
      where: {
        year: selectedYear,
        militaryId,
      },
    });

    if (list.length > 0) {
      await tx.militaryCategorySizeYearly.createMany({
        data: list.map((item) => ({
          periodId: period.id,
          year: selectedYear,
          militaryId,
          categoryId: Number(item.categoryId),
          sizeId: Number(item.sizeId),
          source: "MANUAL_ADMIN",
        })),
        skipDuplicates: true,
      });
    }
  });

  return {
    year: selectedYear,
    militaryId,
    registeredCount: list.length,
  };
}
