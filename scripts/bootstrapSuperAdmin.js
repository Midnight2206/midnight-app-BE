import "dotenv/config";
import bcrypt from "bcrypt";
import { prisma } from "#configs/prisma.config.js";
import { SALT_ROUNDS } from "#src/constants.js";

const REQUIRED_ENV = [
  "SUPER_ADMIN_EMAIL",
  "SUPER_ADMIN_USERNAME",
  "SUPER_ADMIN_PASSWORD",
];

function getRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function main() {
  for (const envName of REQUIRED_ENV) {
    getRequiredEnv(envName);
  }

  const email = getRequiredEnv("SUPER_ADMIN_EMAIL");
  const username = getRequiredEnv("SUPER_ADMIN_USERNAME");
  const password = getRequiredEnv("SUPER_ADMIN_PASSWORD");
  const roleName = (process.env.SUPER_ADMIN_ROLE || "SUPER_ADMIN").trim();

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  const result = await prisma.$transaction(async (tx) => {
    await tx.unit.upsert({
      where: { id: 1 },
      update: {
        name: "superUnit",
        nameNormalized: "superunit",
        deletedAt: null,
      },
      create: {
        id: 1,
        name: "superUnit",
        nameNormalized: "superunit",
      },
    });

    const role = await tx.role.upsert({
      where: { name: roleName },
      update: {
        deletedAt: null,
      },
      create: {
        name: roleName,
        description: "System super administrator",
      },
    });

    const existedUser = await tx.user.findFirst({
      where: {
        OR: [{ email }, { username }],
      },
    });

    if (
      existedUser &&
      (existedUser.email !== email || existedUser.username !== username)
    ) {
      throw new Error(
        `Conflict user found (id=${existedUser.id}) with same email or username but different identity.`,
      );
    }

    const user = existedUser
      ? await tx.user.update({
          where: { id: existedUser.id },
          data: {
            email,
            username,
            password: hashedPassword,
            unitId: 1,
            isActive: true,
            deletedAt: null,
            verifiedAt: existedUser.verifiedAt ?? new Date(),
          },
        })
      : await tx.user.create({
          data: {
            email,
            username,
            password: hashedPassword,
            unitId: 1,
            isActive: true,
            verifiedAt: new Date(),
          },
        });

    await tx.userRole.deleteMany({
      where: {
        userId: user.id,
      },
    });

    await tx.userRole.create({
      data: {
        userId: user.id,
        roleId: role.id,
      },
    });

    const permissions = await tx.permission.findMany({
      select: { id: true },
    });

    if (permissions.length > 0) {
      await tx.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId: role.id,
          permissionId: permission.id,
        })),
        skipDuplicates: true,
      });
    }

    return {
      userId: user.id,
      roleId: role.id,
      permissionsAssigned: permissions.length,
      existedUser: Boolean(existedUser),
    };
  }, {
    maxWait: 20000,
    timeout: 60000,
  });

  console.log("Bootstrap super admin success:");
  console.log(result);
}

main()
  .catch((error) => {
    console.error("Bootstrap super admin failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
