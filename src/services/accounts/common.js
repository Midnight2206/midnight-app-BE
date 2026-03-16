import { ensureSuperAdmin } from "#utils/roleGuards.js";
import { AppError } from "#utils/AppError.js";
import { HTTP_CODES } from "#src/constants.js";

export function assertSuperAdmin(actor) {
  ensureSuperAdmin(actor, "Only SUPER_ADMIN can manage accounts");
}

export function parsePositiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function getUserRoleNames(user) {
  return Array.isArray(user?.roles)
    ? user.roles.map((item) => item?.role?.name).filter(Boolean)
    : [];
}

export function ensureTargetUser(user) {
  if (user) return;
  throw new AppError({
    message: "User not found",
    statusCode: HTTP_CODES.NOT_FOUND,
    errorCode: "USER_NOT_FOUND",
  });
}

export function ensureNotSuperAdmin(user, message, errorCode) {
  const roles = getUserRoleNames(user);
  if (!roles.includes("SUPER_ADMIN")) return;

  throw new AppError({
    message,
    statusCode: HTTP_CODES.BAD_REQUEST,
    errorCode,
  });
}
