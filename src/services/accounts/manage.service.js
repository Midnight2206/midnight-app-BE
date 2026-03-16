import bcrypt from "bcrypt";
import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES, SALT_ROUNDS } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import {
  assertSuperAdmin,
  ensureNotSuperAdmin,
  ensureTargetUser,
} from "#services/accounts/common.js";

async function findManageTargetUser(userId) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      deletedAt: null,
    },
    include: {
      roles: {
        include: {
          role: {
            select: { name: true },
          },
        },
      },
    },
  });

  ensureTargetUser(user);
  return user;
}

export async function createAdminAccount({ actor, body }) {
  assertSuperAdmin(actor);

  const email = body.email.trim();
  const username = body.username.trim();
  const password = body.password;
  const unitId = Number(body.unitId);

  if (unitId === 1) {
    throw new AppError({
      message: "Unit 1 is reserved for SUPER_ADMIN",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "INVALID_ADMIN_UNIT",
    });
  }

  const [existedUser, unit] = await Promise.all([
    prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
        deletedAt: null,
      },
    }),
    prisma.unit.findFirst({
      where: {
        id: unitId,
        deletedAt: null,
      },
    }),
  ]);

  if (existedUser) {
    throw new AppError({
      message: "Email or username already exists",
      statusCode: HTTP_CODES.CONFLICT,
      errorCode: "ACCOUNT_EXISTS",
    });
  }

  if (!unit) {
    throw new AppError({
      message: "Unit not found",
      statusCode: HTTP_CODES.NOT_FOUND,
      errorCode: "UNIT_NOT_FOUND",
    });
  }

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  const account = await prisma.$transaction(async (tx) => {
    const adminRole = await tx.role.upsert({
      where: { name: "ADMIN" },
      update: {
        deletedAt: null,
      },
      create: {
        name: "ADMIN",
        description: "System administrator",
      },
    });

    const user = await tx.user.create({
      data: {
        email,
        username,
        password: hashedPassword,
        unitId,
        isActive: true,
        verifiedAt: new Date(),
      },
    });

    await tx.userRole.create({
      data: {
        userId: user.id,
        roleId: adminRole.id,
      },
    });

    await tx.accountAuditLog.create({
      data: {
        actorUserId: actor.id,
        targetUserId: user.id,
        action: "CREATE_ADMIN",
        metadata: {
          unitId,
        },
      },
    });

    return user;
  });

  return {
    id: account.id,
    email: account.email,
    username: account.username,
    isActive: account.isActive,
    unitId: account.unitId,
    roles: ["ADMIN"],
  };
}

export async function updateAccountStatus({ actor, userId, isActive }) {
  assertSuperAdmin(actor);

  const user = await findManageTargetUser(userId);
  ensureNotSuperAdmin(
    user,
    "Cannot change SUPER_ADMIN status",
    "SUPER_ADMIN_PROTECTED",
  );

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.user.update({
      where: { id: userId },
      data: { isActive },
      select: {
        id: true,
        isActive: true,
        updatedAt: true,
      },
    });

    await tx.accountAuditLog.create({
      data: {
        actorUserId: actor.id,
        targetUserId: userId,
        action: isActive ? "ACTIVATE_ACCOUNT" : "DEACTIVATE_ACCOUNT",
      },
    });

    return saved;
  });

  return updated;
}

export async function resetPassword({ actor, userId, newPassword }) {
  assertSuperAdmin(actor);

  const user = await findManageTargetUser(userId);
  ensureNotSuperAdmin(
    user,
    "Cannot reset SUPER_ADMIN password from dashboard",
    "SUPER_ADMIN_PROTECTED",
  );

  const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
  const updatedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    await tx.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    await tx.accountAuditLog.create({
      data: {
        actorUserId: actor.id,
        targetUserId: userId,
        action: "RESET_PASSWORD",
        metadata: {
          revokedSessions: true,
        },
      },
    });
  });

  return {
    id: userId,
    resetAt: updatedAt,
  };
}
