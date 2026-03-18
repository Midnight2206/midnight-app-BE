import bcrypt from "bcrypt";
import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES, SALT_ROUNDS } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import { createRefreshToken, hashToken } from "#utils/createRefreshToken.js";
import { getFrontendOrigin } from "#services/auth/common.js";
import { formatDateTimeInAppTimeZone } from "#services/date-time.service.js";
import { enqueuePasswordChangeEmail } from "#services/passwordChangeEmail.queue.js";

const PASSWORD_CHANGE_EXPIRES_MS = 2 * 60 * 60 * 1000;

function parseOptionalTrimmed(value) {
  const nextValue = String(value || "").trim();
  return nextValue || null;
}

function parseOptionalInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const nextValue = Number(value);
  if (!Number.isInteger(nextValue) || nextValue < 0) return null;
  return nextValue;
}

function parseOptionalBirthday(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeOrigin(rawUrl = "") {
  const normalized = String(rawUrl || "").trim();
  if (!normalized) return "";
  try {
    return new URL(normalized).origin;
  } catch {
    return "";
  }
}

function resolvePasswordChangeUrl({ token, requestOrigin }) {
  const fromRequest = normalizeOrigin(requestOrigin);
  const fallbackOrigin = normalizeOrigin(getFrontendOrigin());
  const allowOrigins = String(process.env.ALLOW_ORIGIN || "")
    .split(",")
    .map((item) => normalizeOrigin(item))
    .filter(Boolean);
  const canUseRequestOrigin =
    Boolean(fromRequest) &&
    (allowOrigins.length === 0 || allowOrigins.includes(fromRequest));
  const baseOrigin =
    (canUseRequestOrigin ? fromRequest : "") ||
    fallbackOrigin ||
    "http://localhost:5173";
  const verifyPathRaw = String(
    process.env.VERIFY_PASSWORD_CHANGE_FE_PATH || "/verify-password-change",
  ).trim();
  const verifyPath = verifyPathRaw.startsWith("/") ? verifyPathRaw : `/${verifyPathRaw}`;

  return `${baseOrigin}${verifyPath}?token=${encodeURIComponent(token)}`;
}

function buildPasswordChangeEmail({ username, verificationUrl, expiresAt }) {
  const safeUsername = username || "đồng chí";
  const expiresLabel = formatDateTimeInAppTimeZone(expiresAt);
  const subject = "Xac minh thay doi mat khau";
  const text = [
    `Xin chào ${safeUsername},`,
    "",
    "Chúng tôi vừa nhận được yêu cầu đổi mật khẩu cho tài khoản của bạn.",
    `Vui lòng xác minh bằng liên kết sau trước ${expiresLabel}:`,
    verificationUrl,
    "",
    "Sau khi đổi mật khẩu thành công, tất cả thiết bị khác sẽ bị đăng xuất.",
    "Nếu bạn không yêu cầu thao tác này, vui lòng bỏ qua email.",
  ].join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937">
      <p>Xin chào <strong>${safeUsername}</strong>,</p>
      <p>Chúng tôi vừa nhận được yêu cầu đổi mật khẩu cho tài khoản của bạn.</p>
      <p>Vui lòng xác minh thao tác này trước <strong>${expiresLabel}</strong>.</p>
      <p>
        <a href="${verificationUrl}" style="display:inline-block;padding:10px 14px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;">
          Xác minh đổi mật khẩu
        </a>
      </p>
      <p style="font-size:12px;color:#6b7280">
        Sau khi đổi mật khẩu thành công, tất cả thiết bị khác sẽ bị đăng xuất. Nếu bạn không yêu cầu thao tác này, vui lòng bỏ qua email.
      </p>
    </div>
  `;

  return { subject, text, html };
}

async function getUserWithSecurity(userId) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      deletedAt: null,
      isActive: true,
    },
    include: {
      unit: {
        select: {
          id: true,
          name: true,
        },
      },
      profile: true,
      roles: {
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
    throw new AppError({
      message: "User not found",
      statusCode: HTTP_CODES.NOT_FOUND,
    });
  }

  return user;
}

async function findPendingPasswordChange(userId) {
  await prisma.passwordChangeRequest.updateMany({
    where: {
      userId,
      consumedAt: null,
      revokedAt: null,
      expiresAt: {
        lte: new Date(),
      },
    },
    data: {
      revokedAt: new Date(),
    },
  });

  return prisma.passwordChangeRequest.findFirst({
    where: {
      userId,
      consumedAt: null,
      revokedAt: null,
      expiresAt: {
        gt: new Date(),
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

function mapPasswordChangeRequest(request) {
  if (!request) {
    return {
      isPending: false,
      requestedAt: null,
      expiresAt: null,
    };
  }

  return {
    isPending: true,
    requestedAt: request.createdAt,
    expiresAt: request.expiresAt,
  };
}

export async function cancelPasswordChangeRequest(userId) {
  await getUserWithSecurity(userId);

  const result = await prisma.passwordChangeRequest.updateMany({
    where: {
      userId,
      consumedAt: null,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  return {
    cancelled: result.count > 0,
  };
}

export async function getMyProfile(userId) {
  const user = await getUserWithSecurity(userId);
  const pendingPasswordChange = await findPendingPasswordChange(userId);

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    unitId: user.unitId,
    unit: user.unit,
    verifiedAt: user.verifiedAt,
    roles: user.roles.map((item) => item.role.name),
    profile: user.profile,
    passwordChangeRequest: mapPasswordChangeRequest(pendingPasswordChange),
  };
}

export async function updateMyProfile(userId, payload) {
  await getUserWithSecurity(userId);

  const profile = await prisma.profile.upsert({
    where: { userId },
    create: {
      userId,
      fullName: parseOptionalTrimmed(payload.fullName),
      avatar: parseOptionalTrimmed(payload.avatar),
      phone: parseOptionalTrimmed(payload.phone),
      birthday: parseOptionalBirthday(payload.birthday),
      initialCommissioningYear: parseOptionalInt(payload.initialCommissioningYear),
      assignedUnit: parseOptionalTrimmed(payload.assignedUnit),
    },
    update: {
      fullName: parseOptionalTrimmed(payload.fullName),
      avatar: parseOptionalTrimmed(payload.avatar),
      phone: parseOptionalTrimmed(payload.phone),
      birthday: parseOptionalBirthday(payload.birthday),
      initialCommissioningYear: parseOptionalInt(payload.initialCommissioningYear),
      assignedUnit: parseOptionalTrimmed(payload.assignedUnit),
    },
  });

  const user = await getUserWithSecurity(userId);

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    unitId: user.unitId,
    unit: user.unit,
    verifiedAt: user.verifiedAt,
    roles: user.roles.map((item) => item.role.name),
    profile,
  };
}

export async function getMySessions({ userId, currentRefreshTokenHash }) {
  await getUserWithSecurity(userId);

  const sessions = await prisma.refreshToken.findMany({
    where: {
      userId,
      revokedAt: null,
      expiresAt: {
        gt: new Date(),
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return sessions.map((session) => ({
    id: session.id,
    ip: session.ip || "",
    userAgent: session.userAgent || "",
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    isCurrent: Boolean(
      currentRefreshTokenHash && session.tokenHash === currentRefreshTokenHash,
    ),
  }));
}

export async function requestPasswordChange({
  userId,
  currentPassword,
  newPassword,
  requestOrigin,
  currentRefreshTokenHash,
}) {
  const user = await getUserWithSecurity(userId);

  if (!user.verifiedAt) {
    throw new AppError({
      message: "Email must be verified before changing password",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "EMAIL_NOT_VERIFIED",
    });
  }

  const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
  if (!isPasswordValid) {
    throw new AppError({
      message: "Current password is incorrect",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "CURRENT_PASSWORD_INVALID",
    });
  }

  const isSamePassword = await bcrypt.compare(newPassword, user.password);
  if (isSamePassword) {
    throw new AppError({
      message: "New password must be different from current password",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "PASSWORD_UNCHANGED",
    });
  }

  const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  const token = createRefreshToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + PASSWORD_CHANGE_EXPIRES_MS);

  await prisma.$transaction(async (tx) => {
    await tx.passwordChangeRequest.updateMany({
      where: {
        userId,
        consumedAt: null,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    await tx.passwordChangeRequest.create({
      data: {
        userId,
        tokenHash,
        newPasswordHash,
        requestedByTokenHash: currentRefreshTokenHash || null,
        expiresAt,
      },
    });
  });

  const verificationUrl = resolvePasswordChangeUrl({
    token,
    requestOrigin,
  });
  const emailContent = buildPasswordChangeEmail({
    username: user.profile?.fullName || user.username,
    verificationUrl,
    expiresAt,
  });

  const enqueueResult = await enqueuePasswordChangeEmail({
    to: user.email,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  });

  return {
    ...mapPasswordChangeRequest({
      createdAt: new Date(),
      expiresAt,
    }),
    ...enqueueResult,
  };
}

export async function getPasswordChangeStatus(userId) {
  await getUserWithSecurity(userId);
  const pendingRequest = await findPendingPasswordChange(userId);
  return mapPasswordChangeRequest(pendingRequest);
}

export async function confirmPasswordChange({ token, currentRefreshTokenHash }) {
  const tokenHash = hashToken(String(token || "").trim());
  const request = await prisma.passwordChangeRequest.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!request || request.revokedAt || request.consumedAt) {
    throw new AppError({
      message: "Invalid password change token",
      statusCode: HTTP_CODES.UNAUTHORIZED,
      errorCode: "INVALID_PASSWORD_CHANGE_TOKEN",
    });
  }

  if (request.expiresAt <= new Date()) {
    await prisma.passwordChangeRequest.update({
      where: { id: request.id },
      data: {
        revokedAt: new Date(),
      },
    });

    throw new AppError({
      message: "Password change token expired",
      statusCode: HTTP_CODES.UNAUTHORIZED,
      errorCode: "PASSWORD_CHANGE_TOKEN_EXPIRED",
    });
  }

  const keepTokenHash =
    currentRefreshTokenHash || request.requestedByTokenHash || null;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: request.userId },
      data: {
        password: request.newPasswordHash,
      },
    });

    await tx.passwordChangeRequest.updateMany({
      where: {
        userId: request.userId,
        consumedAt: null,
        revokedAt: null,
      },
      data: {
        consumedAt: new Date(),
      },
    });

    await tx.refreshToken.updateMany({
      where: {
        userId: request.userId,
        revokedAt: null,
        ...(keepTokenHash
          ? {
              NOT: {
                tokenHash: keepTokenHash,
              },
            }
          : {}),
      },
      data: {
        revokedAt: new Date(),
      },
    });
  });

  return {
    changed: true,
    revokedOtherSessions: true,
  };
}
