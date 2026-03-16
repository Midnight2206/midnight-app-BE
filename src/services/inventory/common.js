import { AppError } from "#utils/AppError.js";
import { HTTP_CODES } from "#src/constants.js";
import { ensureAnyRole, hasAnyRole } from "#utils/roleGuards.js";

export const DEFAULT_WAREHOUSES = [
  "Quân trang thường dùng",
  "Quân trang dùng chung",
  "Quân trang dự trữ",
];

export const DEFAULT_ALLOCATION_SUBJECTS = [
  "Danh sách phi công",
  "Danh sách SQ-QNCN",
  "Danh sách cán bộ, nhân viên dù",
  "Danh sách HSQ-CS",
];

export function normalizeName(value) {
  return String(value || "").normalize("NFC").trim();
}

export function normalizeForCompare(value) {
  return normalizeName(value).toLowerCase();
}

export function parsePositiveInt(value, fallback) {
  const num = Number.parseInt(value, 10);
  return Number.isInteger(num) && num > 0 ? num : fallback;
}

export function getActorUnitId(actor) {
  const unitId = Number.parseInt(actor?.unitId, 10);
  if (!Number.isInteger(unitId) || unitId <= 0) {
    throwBadRequest("Không xác định được đơn vị người dùng", "INVALID_ACTOR_UNIT");
  }
  return unitId;
}

export function parseUnitIdOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const unitId = Number.parseInt(value, 10);
  if (!Number.isInteger(unitId) || unitId <= 0) {
    throwBadRequest("unitId không hợp lệ", "INVALID_UNIT_ID");
  }
  return unitId;
}

export function resolveInventoryUnitScope({
  actor,
  requestedUnitId,
  requireUnitForSuperAdmin = false,
} = {}) {
  ensureAnyRole(actor, ["SUPER_ADMIN", "ADMIN"]);
  const isSuperAdmin = hasAnyRole(actor, ["SUPER_ADMIN"]);
  const unitId = parseUnitIdOrNull(requestedUnitId);

  if (isSuperAdmin) {
    if (requireUnitForSuperAdmin && !unitId) {
      throwBadRequest("unitId là bắt buộc với SUPER_ADMIN", "UNIT_ID_REQUIRED");
    }
    if (unitId) return unitId;
    return getActorUnitId(actor);
  }

  const actorUnitId = getActorUnitId(actor);
  if (unitId && unitId !== actorUnitId) {
    throwForbidden("Bạn chỉ được thao tác trong đơn vị của mình", "UNIT_SCOPE_FORBIDDEN");
  }
  return actorUnitId;
}

export function throwBadRequest(message, errorCode) {
  throw new AppError({
    statusCode: HTTP_CODES.BAD_REQUEST,
    message,
    errorCode,
  });
}

export function throwNotFound(message, errorCode) {
  throw new AppError({
    statusCode: HTTP_CODES.NOT_FOUND,
    message,
    errorCode,
  });
}

export function throwConflict(message, errorCode, metadata) {
  throw new AppError({
    statusCode: HTTP_CODES.CONFLICT,
    message,
    errorCode,
    metadata,
  });
}

export function throwForbidden(message, errorCode) {
  throw new AppError({
    statusCode: HTTP_CODES.FORBIDDEN,
    message,
    errorCode,
  });
}
