import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";

export function getActorRoles(actor) {
  return Array.isArray(actor?.roles) ? actor.roles : [];
}

export function hasAnyRole(actor, roles) {
  const actorRoles = getActorRoles(actor);
  return roles.some((role) => actorRoles.includes(role));
}

export function ensureAnyRole(
  actor,
  roles,
  {
    message = "Forbidden",
    statusCode = HTTP_CODES.FORBIDDEN,
    errorCode = "FORBIDDEN",
  } = {},
) {
  if (!hasAnyRole(actor, roles)) {
    throw new AppError({
      message,
      statusCode,
      errorCode,
    });
  }
}

export function ensureSuperAdmin(
  actor,
  message = "Only SUPER_ADMIN can perform this action",
) {
  ensureAnyRole(actor, ["SUPER_ADMIN"], { message });
}
export function hasPermission(actor, permissions) {
  const actorPermissions = Array.isArray(actor?.permissions)
    ? actor.permissions
    : [];

  return permissions.some((p) => actorPermissions.includes(p));
}

export function ensurePermission(
  actor,
  permissions,
  {
    message = "Forbidden",
    statusCode = HTTP_CODES.FORBIDDEN,
    errorCode = "FORBIDDEN",
  } = {},
) {
  if (!hasPermission(actor, permissions)) {
    throw new AppError({
      message,
      statusCode,
      errorCode,
    });
  }
}
