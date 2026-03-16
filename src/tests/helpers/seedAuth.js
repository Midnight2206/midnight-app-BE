import { prisma } from "#configs/prisma.config.js";

export async function seedAuthPrerequisites({
  roleName = "USER",
  unitId = 1001,
  unitName = "testUnit",
  genderCode = "TEST_GENDER",
  militaryCode = `TEST_${Date.now()}`,
} = {}) {
  await prisma.unit.upsert({
    where: { id: unitId },
    update: {
      name: unitName,
      nameNormalized: unitName.toLowerCase(),
      deletedAt: null,
    },
    create: {
      id: unitId,
      name: unitName,
      nameNormalized: unitName.toLowerCase(),
    },
  });

  const genderCatalog = await prisma.militaryGenderCatalog.upsert({
    where: { codeNormalized: genderCode.toLowerCase() },
    update: {
      code: genderCode,
      name: genderCode,
      deletedAt: null,
    },
    create: {
      code: genderCode,
      codeNormalized: genderCode.toLowerCase(),
      name: genderCode,
    },
  });

  await prisma.role.upsert({
    where: { name: roleName },
    update: { deletedAt: null },
    create: { name: roleName, description: "Test role" },
  });

  const military = await prisma.military.create({
    data: {
      fullname: "Test Military",
      rank: "THIEU_UY",
      rankGroup: "CAP_UY",
      position: "Test Position",
      gender: "MALE",
      genderId: genderCatalog.id,
      militaryCode,
      searchNormalized: "test military",
      initialCommissioningYear: 2020,
      assignedUnit: "Test Assigned Unit",
      unitId,
    },
  });

  return { unitId, genderCatalogId: genderCatalog.id, militaryCode, militaryId: military.id };
}

export async function cleanupAuthTestData({ email, username, militaryId } = {}) {
  if (email || username) {
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          email ? { email } : undefined,
          username ? { username } : undefined,
        ].filter(Boolean),
      },
      select: { id: true },
    });

    if (user) {
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
      await prisma.userRole.deleteMany({ where: { userId: user.id } });
      await prisma.profile.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }

  if (militaryId) {
    await prisma.military.delete({ where: { id: militaryId } }).catch(() => {});
  }
}

