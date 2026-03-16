import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import {
  assertAdminAccess,
  assertSuperAdminAccess,
  parseInteger,
} from "#services/militaries/common.js";

const TYPE_CODE_REGEX = /^[A-Z0-9-]+$/;

export function normalizeMilitaryTypeCode(
  value,
  { required = false, fieldName = "type" } = {},
) {
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

  if (normalized.length > 50 || !TYPE_CODE_REGEX.test(normalized)) {
    throw new AppError({
      message: `${fieldName} is invalid (only A-Z, 0-9, -; max 50 chars)`,
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "INVALID_TYPE",
    });
  }

  return normalized;
}

export function normalizeMilitaryTypeCodesInput(
  value,
  { required = false, fieldName = "types" } = {},
) {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : value === undefined || value === null || value === ""
        ? []
        : [value];

  const dedup = new Set();
  for (let index = 0; index < rawItems.length; index += 1) {
    const normalized = normalizeMilitaryTypeCode(rawItems[index], {
      required: false,
      fieldName: `${fieldName}[${index}]`,
    });
    if (!normalized) continue;
    dedup.add(normalized);
  }

  const codes = [...dedup];
  if (required && codes.length === 0) {
    throw new AppError({
      message: `${fieldName} is required`,
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "TYPE_REQUIRED",
    });
  }

  return codes;
}

export async function resolveMilitaryTypeCatalogRecords({
  tx = prisma,
  value,
  required = false,
  fieldName = "types",
}) {
  const normalizedCodes = normalizeMilitaryTypeCodesInput(value, {
    required,
    fieldName,
  });
  if (normalizedCodes.length === 0) return [];

  const rows = await tx.militaryTypeCatalog.findMany({
    where: {
      deletedAt: null,
      codeNormalized: {
        in: normalizedCodes,
      },
    },
    select: {
      id: true,
      code: true,
      codeNormalized: true,
      name: true,
    },
  });

  const byCode = new Map(rows.map((item) => [item.codeNormalized, item]));
  const missingCodes = normalizedCodes.filter((code) => !byCode.has(code));
  if (missingCodes.length > 0) {
    throw new AppError({
      message: `Unknown military type(s): ${missingCodes.join(", ")}`,
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "UNKNOWN_MILITARY_TYPE",
    });
  }

  return normalizedCodes.map((code) => byCode.get(code));
}

export async function listMilitaryTypes({ actor }) {
  assertAdminAccess(actor);

  const types = await prisma.militaryTypeCatalog.findMany({
    where: {
      deletedAt: null,
    },
    orderBy: [{ code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return {
    types,
    total: types.length,
  };
}

export async function createMilitaryType({ actor, body }) {
  assertSuperAdminAccess(actor);

  const code = normalizeMilitaryTypeCode(body?.code, {
    required: true,
    fieldName: "code",
  });
  const name = String(body?.name || "").trim() || null;

  const existed = await prisma.militaryTypeCatalog.findFirst({
    where: {
      codeNormalized: code,
    },
    select: {
      id: true,
      deletedAt: true,
    },
  });

  if (existed && !existed.deletedAt) {
    throw new AppError({
      message: "Military type already exists",
      statusCode: HTTP_CODES.CONFLICT,
      errorCode: "MILITARY_TYPE_EXISTS",
    });
  }

  const type = existed
    ? await prisma.militaryTypeCatalog.update({
        where: {
          id: existed.id,
        },
        data: {
          code,
          codeNormalized: code,
          name,
          deletedAt: null,
        },
        select: {
          id: true,
          code: true,
          name: true,
          createdAt: true,
          updatedAt: true,
        },
      })
    : await prisma.militaryTypeCatalog.create({
        data: {
          code,
          codeNormalized: code,
          name,
        },
        select: {
          id: true,
          code: true,
          name: true,
          createdAt: true,
          updatedAt: true,
        },
      });

  return {
    type,
  };
}

export async function deleteMilitaryType({ actor, typeId }) {
  assertSuperAdminAccess(actor);
  const parsedTypeId = parseInteger(typeId, "typeId");

  const existed = await prisma.militaryTypeCatalog.findFirst({
    where: {
      id: parsedTypeId,
      deletedAt: null,
    },
    select: {
      id: true,
      code: true,
    },
  });

  if (!existed) {
    throw new AppError({
      message: "Military type not found",
      statusCode: HTTP_CODES.NOT_FOUND,
      errorCode: "MILITARY_TYPE_NOT_FOUND",
    });
  }

  const usedCount = await prisma.militaryTypeAssignment.count({
    where: {
      typeId: parsedTypeId,
      military: {
        deletedAt: null,
      },
    },
  });

  if (usedCount > 0) {
    throw new AppError({
      message: "Military type is being used by military records",
      statusCode: HTTP_CODES.CONFLICT,
      errorCode: "MILITARY_TYPE_IN_USE",
    });
  }

  await prisma.militaryTypeCatalog.update({
    where: {
      id: parsedTypeId,
    },
    data: {
      deletedAt: new Date(),
    },
  });

  return {
    deletedTypeId: parsedTypeId,
    code: existed.code,
  };
}
