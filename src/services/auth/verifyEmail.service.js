import jwt from "jsonwebtoken";
import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES } from "#src/constants.js";
import { signMailToken, verifyMailToken } from "#utils/jwt.js";
import { AppError } from "#utils/AppError.js";
import { enqueueVerifyEmail } from "#services/emailVerification.queue.js";
import { getRedisConnection } from "#src/queues/redis.connection.js";
import { ensureSuperAdmin } from "#utils/roleGuards.js";
import {
  getFrontendOrigin,
  VERIFY_EMAIL_COOLDOWN_MS,
} from "#services/auth/common.js";

const verifyEmailSentCache = new Map();
const VERIFY_EMAIL_COOLDOWN_PREFIX = "verify_email_cooldown";

async function acquireVerifyCooldown(userId) {
  const now = Date.now();
  const fallbackLastSentAt = verifyEmailSentCache.get(userId) || 0;
  const fallbackRemainMs = VERIFY_EMAIL_COOLDOWN_MS - (now - fallbackLastSentAt);

  try {
    const redis = getRedisConnection();
    const key = `${VERIFY_EMAIL_COOLDOWN_PREFIX}:${userId}`;
    const result = await redis.set(
      key,
      String(now),
      "PX",
      VERIFY_EMAIL_COOLDOWN_MS,
      "NX",
    );

    if (result === "OK") {
      verifyEmailSentCache.set(userId, now);
      return { allowed: true, retryAfterMs: VERIFY_EMAIL_COOLDOWN_MS };
    }

    const remainMs = Number(await redis.pttl(key));
    return {
      allowed: false,
      retryAfterMs:
        Number.isFinite(remainMs) && remainMs > 0
          ? remainMs
          : VERIFY_EMAIL_COOLDOWN_MS,
    };
  } catch {
    if (fallbackRemainMs > 0) {
      return {
        allowed: false,
        retryAfterMs: fallbackRemainMs,
      };
    }
    verifyEmailSentCache.set(userId, now);
    return { allowed: true, retryAfterMs: VERIFY_EMAIL_COOLDOWN_MS };
  }
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

function resolveFrontendVerifyUrl({ token, requestOrigin }) {
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
  const verifyPathRaw = String(process.env.VERIFY_EMAIL_FE_PATH || "/verify-email").trim();
  const verifyPath = verifyPathRaw.startsWith("/") ? verifyPathRaw : `/${verifyPathRaw}`;

  return `${baseOrigin}${verifyPath}?token=${encodeURIComponent(token)}`;
}

export async function requestVerifyEmail({ userId, requestOrigin }) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      isActive: true,
      deletedAt: null,
    },
    select: {
      id: true,
      email: true,
      username: true,
      verifiedAt: true,
    },
  });

  if (!user) {
    throw new AppError({
      message: "User not found",
      statusCode: HTTP_CODES.NOT_FOUND,
    });
  }

  if (user.verifiedAt) {
    return {
      queued: false,
      alreadyVerified: true,
    };
  }

  const cooldown = await acquireVerifyCooldown(user.id);
  if (!cooldown.allowed) {
    return {
      queued: false,
      alreadyVerified: false,
      retryAfterMs: cooldown.retryAfterMs,
    };
  }

  const token = signMailToken({
    userId: user.id,
    email: user.email,
  });

  const verificationUrl = resolveFrontendVerifyUrl({
    token,
    requestOrigin,
  });

  const { jobId } = await enqueueVerifyEmail({
    to: user.email,
    username: user.username,
    verificationUrl,
  });

  return {
    queued: true,
    alreadyVerified: false,
    jobId,
    retryAfterMs: cooldown.retryAfterMs,
  };
}

export async function confirmVerifyEmail({ token }) {
  let payload;

  try {
    payload = verifyMailToken(token);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError({
        message: "Verify email token expired",
        statusCode: HTTP_CODES.UNAUTHORIZED,
        errorCode: "VERIFY_EMAIL_TOKEN_EXPIRED",
      });
    }

    if (error instanceof jwt.JsonWebTokenError) {
      throw new AppError({
        message: "Invalid verify email token",
        statusCode: HTTP_CODES.UNAUTHORIZED,
        errorCode: "INVALID_VERIFY_EMAIL_TOKEN",
      });
    }

    throw error;
  }

  const user = await prisma.user.findFirst({
    where: {
      id: payload.sub,
      deletedAt: null,
    },
    select: {
      id: true,
      email: true,
      verifiedAt: true,
    },
  });

  if (!user) {
    throw new AppError({
      message: "User not found",
      statusCode: HTTP_CODES.NOT_FOUND,
    });
  }

  if (user.email !== payload.email) {
    throw new AppError({
      message: "Verify email token does not match account",
      statusCode: HTTP_CODES.UNAUTHORIZED,
      errorCode: "VERIFY_EMAIL_TOKEN_MISMATCH",
    });
  }

  if (user.verifiedAt) {
    return {
      verified: true,
      alreadyVerified: true,
    };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { verifiedAt: new Date() },
  });

  return {
    verified: true,
    alreadyVerified: false,
  };
}

export async function testVerifyEmailDelivery({ actor, toEmail, requestOrigin }) {
  ensureSuperAdmin(actor, "Only SUPER_ADMIN can send verify-email test");

  if (!actor?.id) {
    throw new AppError({
      message: "Unauthenticated",
      statusCode: HTTP_CODES.UNAUTHORIZED,
    });
  }

  const sender = await prisma.user.findFirst({
    where: {
      id: actor.id,
      deletedAt: null,
    },
    select: {
      id: true,
      email: true,
      username: true,
    },
  });

  if (!sender) {
    throw new AppError({
      message: "User not found",
      statusCode: HTTP_CODES.NOT_FOUND,
    });
  }

  const targetEmail = (toEmail || sender.email || "").trim();
  if (!targetEmail) {
    throw new AppError({
      message: "Target email is required",
      statusCode: HTTP_CODES.BAD_REQUEST,
    });
  }

  const token = signMailToken({
    userId: sender.id,
    email: sender.email,
  });

  const verificationUrl = resolveFrontendVerifyUrl({
    token,
    requestOrigin,
  });

  const queueResult = await enqueueVerifyEmail({
    to: targetEmail,
    username: sender.username,
    verificationUrl,
  });

  return {
    sent: true,
    to: targetEmail,
    queued: true,
    ...queueResult,
  };
}
