import bcrypt from "bcrypt";
import { prisma } from "#configs/prisma.config.js";
import { SALT_ROUNDS } from "#src/constants.js";

export async function seedSuperAdmin({
  email = `admin_${Date.now()}@example.com`,
  username = `admin_${Date.now()}`,
  password = "AdminPassw0rd!",
  unitId = 1,
} = {}) {
  await prisma.unit.upsert({
    where: { id: unitId },
    update: {
      name: "superUnit",
      nameNormalized: "superunit",
      deletedAt: null,
    },
    create: {
      id: unitId,
      name: "superUnit",
      nameNormalized: "superunit",
    },
  });

  const role = await prisma.role.upsert({
    where: { name: "SUPER_ADMIN" },
    update: { deletedAt: null },
    create: { name: "SUPER_ADMIN", description: "Test super admin role" },
  });

  const hashed = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email,
      username,
      password: hashed,
      unitId,
      isActive: true,
      verifiedAt: new Date(),
    },
  });

  await prisma.userRole.create({
    data: {
      userId: user.id,
      roleId: role.id,
    },
  });

  return { email, username, password, userId: user.id };
}

export async function cleanupSuperAdmin({ userId } = {}) {
  if (!userId) return;
  await prisma.refreshToken.deleteMany({ where: { userId } });
  await prisma.userRole.deleteMany({ where: { userId } });
  await prisma.profile.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
}

