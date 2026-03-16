import bcrypt from "bcrypt";
import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES, SALT_ROUNDS } from "#src/constants.js";
import { signAccessToken } from "#utils/jwt.js";
import { createRefreshToken, hashToken } from "#utils/createRefreshToken.js";
import { AppError } from "#utils/AppError.js";
import { getRefreshTokenExpireMs, mapBasicUser } from "#services/auth/common.js";

export async function login({ identifier, password, userAgent, ip }) {
  const normalizedIdentifier = String(identifier || "").trim();
  const loginIdentifier = normalizedIdentifier.includes("@")
    ? normalizedIdentifier.toLowerCase()
    : normalizedIdentifier;

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: loginIdentifier }, { username: loginIdentifier }],
      deletedAt: null,
      isActive: true,
    },
    include: {
      roles: {
        where: {
          role: {
            deletedAt: null,
          },
        },
        include: {
          role: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  if (!user) {
    throw new AppError({ message: "Invalid credentials", statusCode: HTTP_CODES.UNAUTHORIZED });
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    throw new AppError({ message: "Invalid credentials", statusCode: HTTP_CODES.UNAUTHORIZED });
  }

  const accessToken = signAccessToken(user.id);
  const refreshToken = createRefreshToken();
  const tokenHash = hashToken(refreshToken);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + getRefreshTokenExpireMs()),
      userAgent,
      ip,
    },
  });

  return {
    user: mapBasicUser(user),
    accessToken,
    refreshToken,
  };
}

export async function register({
  email,
  password,
  username,
  roleName = "USER",
  militaryCode,
  userAgent,
  ip,
}) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedUsername = String(username || "").trim();
  const normalizedMilitaryCode = String(militaryCode || "").trim();
  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  return prisma.$transaction(async (tx) => {
    const role = await tx.role.findFirst({
      where: {
        name: roleName,
        deletedAt: null,
      },
    });

    if (!role) {
      throw new AppError({
        message: "Role not found",
        statusCode: HTTP_CODES.NOT_FOUND,
      });
    }

    const military = await tx.military.findFirst({
      where: {
        militaryCode: normalizedMilitaryCode,
        deletedAt: null,
      },
    });

    if (!military) {
      throw new AppError({
        message: "Military not found",
        statusCode: HTTP_CODES.NOT_FOUND,
      });
    }

    if (military.claimedByUserId) {
      throw new AppError({
        message: "Military already claimed",
        statusCode: HTTP_CODES.BAD_REQUEST,
      });
    }

    const user = await tx.user.create({
      data: {
        email: normalizedEmail,
        username: normalizedUsername,
        password: hashedPassword,
        unitId: military.unitId,
      },
    });

    await tx.userRole.create({
      data: {
        userId: user.id,
        roleId: role.id,
      },
    });

    await tx.military.update({
      where: { id: military.id },
      data: {
        claimedByUserId: user.id,
        claimedAt: new Date(),
      },
    });

    const accessToken = signAccessToken(user.id);
    const refreshToken = createRefreshToken();
    const tokenHash = hashToken(refreshToken);

    await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + getRefreshTokenExpireMs()),
        userAgent,
        ip,
      },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        unitId: user.unitId,
        verifiedAt: user.verifiedAt,
        roles: [role.name],
      },
      accessToken,
      refreshToken,
    };
  });
}

export async function refreshToken({ refreshToken, userAgent, ip }) {
  if (!refreshToken) {
    throw new AppError({
      message: "Refresh token required",
      statusCode: HTTP_CODES.UNAUTHORIZED,
      errorCode: "REFRESH_TOKEN_REQUIRED",
    });
  }

  const tokenHash = hashToken(refreshToken);

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          isActive: true,
          deletedAt: true,
        },
      },
    },
  });

  if (!storedToken) {
    throw new AppError({
      message: "Invalid refresh token",
      statusCode: HTTP_CODES.UNAUTHORIZED,
      errorCode: "INVALID_REFRESH_TOKEN",
    });
  }

  if (storedToken.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: {
        userId: storedToken.userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    throw new AppError({
      message: "Refresh token reuse detected",
      statusCode: HTTP_CODES.UNAUTHORIZED,
      errorCode: "REFRESH_TOKEN_REUSE",
    });
  }

  if (storedToken.expiresAt < new Date()) {
    throw new AppError({
      message: "Refresh token expired",
      statusCode: HTTP_CODES.UNAUTHORIZED,
      errorCode: "REFRESH_TOKEN_EXPIRED",
    });
  }

  if (!storedToken.user || !storedToken.user.isActive || storedToken.user.deletedAt) {
    await prisma.refreshToken.updateMany({
      where: {
        userId: storedToken.userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    throw new AppError({
      message: "User is inactive",
      statusCode: HTTP_CODES.UNAUTHORIZED,
      errorCode: "USER_INACTIVE",
    });
  }

  const userId = storedToken.userId;
  const revokedAt = new Date();
  const revokeResult = await prisma.refreshToken.updateMany({
    where: {
      id: storedToken.id,
      revokedAt: null,
    },
    data: { revokedAt },
  });

  if (revokeResult.count === 0) {
    await prisma.refreshToken.updateMany({
      where: {
        userId: storedToken.userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
    throw new AppError({
      message: "Refresh token reuse detected",
      statusCode: HTTP_CODES.UNAUTHORIZED,
      errorCode: "REFRESH_TOKEN_REUSE",
    });
  }

  const newAccessToken = signAccessToken(userId);
  const newRefreshToken = createRefreshToken();
  const newTokenHash = hashToken(newRefreshToken);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: newTokenHash,
      expiresAt: new Date(Date.now() + getRefreshTokenExpireMs()),
      userAgent,
      ip,
    },
  });

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
}

export async function logout(refreshToken) {
  if (!refreshToken) return null;

  const tokenHash = hashToken(refreshToken);
  const token = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!token) return null;

  await prisma.refreshToken.update({
    where: { id: token.id },
    data: { revokedAt: new Date() },
  });

  return token;
}
