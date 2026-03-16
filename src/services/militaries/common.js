import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import { ensureAnyRole, ensureSuperAdmin, hasAnyRole } from "#utils/roleGuards.js";

export function parseInteger(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError({
      message: `${fieldName} must be a positive integer`,
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "INVALID_INTEGER",
    });
  }
  return parsed;
}

export function parseBooleanLike(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

export async function loadXlsxLibrary() {
  try {
    const module = await import("xlsx");
    return module.default || module;
  } catch {
    throw new AppError({
      message: "XLSX parser is not installed. Run: npm install xlsx",
      statusCode: HTTP_CODES.INTERNAL_SERVER_ERROR,
      errorCode: "XLSX_PARSER_MISSING",
    });
  }
}

function parseMultipartContentDisposition(value) {
  const nameMatch = value.match(/name="([^"]+)"/i);
  const filenameMatch = value.match(/filename="([^"]*)"/i);

  return {
    fieldName: nameMatch?.[1] || null,
    filename: filenameMatch?.[1] || null,
  };
}

async function readRequestBuffer(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

export async function parseMultipartFormData(req) {
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);

  if (!boundaryMatch) {
    throw new AppError({
      message: "Invalid multipart form-data boundary",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "MULTIPART_INVALID_BOUNDARY",
    });
  }

  const boundary = `--${boundaryMatch[1]}`;
  const buffer = await readRequestBuffer(req);
  const bodyText = buffer.toString("latin1");
  const parts = bodyText
    .split(boundary)
    .slice(1, -1)
    .map((part) => part.trim())
    .filter(Boolean);

  const fields = {};
  const files = {};

  for (const part of parts) {
    const separatorIndex = part.indexOf("\r\n\r\n");
    if (separatorIndex < 0) continue;

    const headerText = part.slice(0, separatorIndex);
    let dataText = part.slice(separatorIndex + 4);

    if (dataText.endsWith("\r\n")) {
      dataText = dataText.slice(0, -2);
    }

    const headers = headerText
      .split("\r\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const dispositionHeader = headers.find((line) =>
      line.toLowerCase().startsWith("content-disposition:"),
    );

    if (!dispositionHeader) continue;

    const { fieldName, filename } = parseMultipartContentDisposition(
      dispositionHeader,
    );

    if (!fieldName) continue;

    if (filename) {
      files[fieldName] = {
        filename,
        content: Buffer.from(dataText, "latin1"),
      };
      continue;
    }

    fields[fieldName] = dataText;
  }

  return { fields, files };
}

export function assertAdminAccess(actor) {
  ensureAnyRole(actor, ["SUPER_ADMIN", "ADMIN"]);
  const isSuperAdmin = hasAnyRole(actor, ["SUPER_ADMIN"]);
  const isAdmin = isSuperAdmin || hasAnyRole(actor, ["ADMIN"]);

  return { isAdmin, isSuperAdmin };
}

export function assertSuperAdminAccess(actor) {
  ensureSuperAdmin(actor, "Only SUPER_ADMIN can manage units");
}

export function assertImportAccess(actor) {
  const roles = actor?.roles || [];
  const isSuperAdmin = roles.includes("SUPER_ADMIN");
  const isAdmin = roles.includes("ADMIN");

  if (!isAdmin && !isSuperAdmin) {
    throw new AppError({
      message: "Only ADMIN or SUPER_ADMIN can import military data",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "IMPORT_FORBIDDEN",
    });
  }
}

export function assertSizeRegistrationAccess(actor) {
  const roles = actor?.roles || [];
  const isSuperAdmin = roles.includes("SUPER_ADMIN");
  const isAdmin = roles.includes("ADMIN");

  if (!isAdmin && !isSuperAdmin) {
    throw new AppError({
      message: "Only ADMIN or SUPER_ADMIN can register military sizes",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "SIZE_REGISTRATION_FORBIDDEN",
    });
  }

  const actorUnitId = parseInteger(actor.unitId, "actor.unitId");
  if (!actorUnitId) {
    throw new AppError({
      message: "Admin account has no unit assignment",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "UNIT_NOT_ASSIGNED",
    });
  }

  return actorUnitId;
}

export function resolveScopeUnitId(actor, rawUnitId) {
  const { isSuperAdmin } = assertAdminAccess(actor);
  const requestedUnitId = parseInteger(rawUnitId, "unitId");

  if (isSuperAdmin) {
    return requestedUnitId;
  }

  const actorUnitId = parseInteger(actor.unitId, "actor.unitId");
  if (!actorUnitId) {
    throw new AppError({
      message: "Admin account has no unit assignment",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "UNIT_NOT_ASSIGNED",
    });
  }

  if (requestedUnitId && requestedUnitId !== actorUnitId) {
    throw new AppError({
      message: "Admin can only access own unit data",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "UNIT_SCOPE_FORBIDDEN",
    });
  }

  return actorUnitId;
}

export function parseSortDirection(sortDir) {
  const value = String(sortDir || "asc").trim().toLowerCase();
  return value === "desc" ? "desc" : "asc";
}

export function parseSortBy(sortBy) {
  const value = String(sortBy || "fullname").trim();
  const allowList = new Set([
    "fullname",
    "militaryCode",
    "rank",
    "position",
    "gender",
    "type",
    "initialCommissioningYear",
    "unitTransferInYear",
    "unitTransferOutYear",
    "assignedUnit",
    "claimStatus",
    "createdAt",
  ]);

  if (!allowList.has(value)) {
    return "fullname";
  }

  return value;
}

export function parsePage(page) {
  if (page === undefined || page === null || page === "") return 1;
  const parsed = Number(page);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError({
      message: "page must be a positive integer",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "INVALID_PAGE",
    });
  }
  return parsed;
}

export function parseLimit(limit) {
  if (limit === undefined || limit === null || limit === "") return 20;
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 100) {
    throw new AppError({
      message: "limit must be a positive integer and <= 100",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "INVALID_LIMIT",
    });
  }
  return parsed;
}

export function normalizeMilitaryGender(value, { required = false, fieldName = "gender" } = {}) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) {
    if (required) {
      throw new AppError({
        message: `${fieldName} is required`,
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "GENDER_REQUIRED",
      });
    }
    return null;
  }

  if (!["MALE", "FEMALE"].includes(normalized)) {
    throw new AppError({
      message: `${fieldName} is invalid (allowed: MALE, FEMALE)`,
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "INVALID_GENDER",
    });
  }

  return normalized;
}

export function normalizeMilitaryType(value, { required = false, fieldName = "type" } = {}) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");

  if (!normalized) {
    if (required) {
      throw new AppError({
        message: `${fieldName} is required`,
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "TYPE_REQUIRED",
      });
    }
    return null;
  }

  if (normalized.length > 50 || !/^[A-Z0-9-]+$/.test(normalized)) {
    throw new AppError({
      message: `${fieldName} is invalid (only A-Z, 0-9, -; max 50 chars)`,
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "INVALID_TYPE",
    });
  }

  return normalized;
}

export function formatMilitaryType(value) {
  return normalizeMilitaryType(value, { required: false }) || "";
}
