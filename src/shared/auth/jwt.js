import jwt from "jsonwebtoken";
import { AppError } from "#utils/AppError.js";
import { HTTP_CODES } from "#src/constants.js";

const DEFAULT_ACCESS_EXPIRES_SEC = 900;
const DEFAULT_EMAIL_EXPIRES_SEC = 3600;
const MAX_ACCESS_EXPIRES_SEC = 86400;
const MAX_EMAIL_EXPIRES_SEC = 86400 * 7;

function parseExpiresSeconds(envValue, defaultSec, maxSec) {
  const n = Number(envValue);
  if (!Number.isFinite(n) || n <= 0) return defaultSec;
  const sec = n > 10000 ? Math.floor(n / 1000) : n;
  return Math.min(Math.max(sec, 60), maxSec);
}

/* ================= ACCESS TOKEN ================= */

export const signAccessToken = (userId) => {
  if (!process.env.JWT_ACCESS_SECRET) {
    throw new AppError({
      message: "JWT_ACCESS_SECRET not defined",
      statusCode: HTTP_CODES.INTERNAL_SERVER_ERROR,
      errorCode: "JWT_ACCESS_SECRET_NOT_DEFINED",
    });
  }

  const expiresIn = parseExpiresSeconds(
    process.env.JWT_ACCESS_EXPIRES,
    DEFAULT_ACCESS_EXPIRES_SEC,
    MAX_ACCESS_EXPIRES_SEC,
  );

  return jwt.sign(
    {
      sub: userId,
      type: "access",
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn },
  );
};

export const verifyAccessToken = (token) => {
  if (!process.env.JWT_ACCESS_SECRET) {
    throw new AppError({
      message: "JWT_ACCESS_SECRET not defined",
      statusCode: HTTP_CODES.INTERNAL_SERVER_ERROR,
      errorCode: "JWT_ACCESS_SECRET_NOT_DEFINED",
    });
  }

  const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

  if (payload.type !== "access") {
    throw new AppError({
      message: "Invalid access token",
      statusCode: HTTP_CODES.UNAUTHORIZED,
      errorCode: "INVALID_ACCESS_TOKEN",
    });
  }

  return payload;
};

/* ================= VERIFY EMAIL TOKEN ================= */

export const signMailToken = ({ userId, email }) => {
  if (!process.env.JWT_EMAIL_SECRET) {
    throw new AppError({
      message: "JWT_EMAIL_SECRET not defined",
      statusCode: HTTP_CODES.INTERNAL_SERVER_ERROR,
      errorCode: "JWT_EMAIL_SECRET_NOT_DEFINED",
    });
  }

  const expiresIn = parseExpiresSeconds(
    process.env.JWT_EMAIL_EXPIRES,
    DEFAULT_EMAIL_EXPIRES_SEC,
    MAX_EMAIL_EXPIRES_SEC,
  );

  return jwt.sign(
    {
      sub: userId,
      email,
      type: "verify_email",
    },
    process.env.JWT_EMAIL_SECRET,
    { expiresIn },
  );
};

export const verifyMailToken = (token) => {
  if (!process.env.JWT_EMAIL_SECRET) {
    throw new AppError({
      message: "JWT_EMAIL_SECRET not defined",
      statusCode: HTTP_CODES.INTERNAL_SERVER_ERROR,
      errorCode: "JWT_EMAIL_SECRET_NOT_DEFINED",
    });
  }

  const payload = jwt.verify(token, process.env.JWT_EMAIL_SECRET);

  if (payload.type !== "verify_email") {
    throw new AppError({
      message: "Invalid verify email token",
      statusCode: HTTP_CODES.UNAUTHORIZED,
      errorCode: "INVALID_VERIFY_EMAIL_TOKEN",
    });
  }

  return payload;
};
