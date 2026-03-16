import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import { assertAdminAccess, parseInteger, resolveScopeUnitId } from "#services/militaries/common.js";

function normalizeAssignedUnitName(name) {
  return String(name || "").normalize("NFC").trim();
}

function normalizeAssignedUnitNameForCompare(name) {
  return normalizeAssignedUnitName(name).toLowerCase();
}

function mapAssignedUnit(item) {
  return {
    id: item.id,
    name: item.name,
    unitId: item.unitId,
    unit: item.unit
      ? {
          id: item.unit.id,
          name: item.unit.name,
        }
      : null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    deletedAt: item.deletedAt,
  };
}

export async function listAssignedUnits({ actor, unitId, status = "active" } = {}) {
  assertAdminAccess(actor);
  const scopedUnitId = resolveScopeUnitId(actor, unitId);
  if (!scopedUnitId) {
    return { unitId: null, assignedUnits: [] };
  }

  const where = { unitId: scopedUnitId };
  if (status === "deleted") {
    where.deletedAt = { not: null };
  } else {
    where.deletedAt = null;
  }

  const assignedUnits = await prisma.militaryAssignedUnit.findMany({
    where,
    include: {
      unit: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });

  return {
    unitId: scopedUnitId,
    assignedUnits: assignedUnits.map(mapAssignedUnit),
  };
}

export async function createAssignedUnit({ actor, body } = {}) {
  const scopedUnitId = resolveScopeUnitId(actor, body?.unitId);
  const name = normalizeAssignedUnitName(body?.name);

  if (!scopedUnitId) {
    throw new AppError({
      message: "unitId là bắt buộc",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "UNIT_ID_REQUIRED",
    });
  }

  if (!name) {
    throw new AppError({
      message: "Tên assignedUnit là bắt buộc",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "ASSIGNED_UNIT_NAME_REQUIRED",
    });
  }

  const nameNormalized = normalizeAssignedUnitNameForCompare(name);
  const existed = await prisma.militaryAssignedUnit.findFirst({
    where: {
      unitId: scopedUnitId,
      nameNormalized,
    },
    include: {
      unit: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (existed && !existed.deletedAt) {
    throw new AppError({
      message: "Assigned unit đã tồn tại trong đơn vị này",
      statusCode: HTTP_CODES.CONFLICT,
      errorCode: "ASSIGNED_UNIT_EXISTS",
    });
  }

  const assignedUnit = existed?.deletedAt
    ? await prisma.militaryAssignedUnit.update({
        where: { id: existed.id },
        data: {
          name,
          nameNormalized,
          deletedAt: null,
        },
        include: {
          unit: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })
    : await prisma.militaryAssignedUnit.create({
        data: {
          unitId: scopedUnitId,
          name,
          nameNormalized,
        },
        include: {
          unit: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

  return { assignedUnit: mapAssignedUnit(assignedUnit) };
}

export async function updateAssignedUnit({ actor, assignedUnitId, body } = {}) {
  const id = parseInteger(assignedUnitId, "assignedUnitId");
  const scopedUnitId = resolveScopeUnitId(actor, body?.unitId);
  const name = normalizeAssignedUnitName(body?.name);

  if (!id) {
    throw new AppError({
      message: "assignedUnitId không hợp lệ",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "INVALID_ASSIGNED_UNIT_ID",
    });
  }

  if (!scopedUnitId) {
    throw new AppError({
      message: "unitId là bắt buộc",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "UNIT_ID_REQUIRED",
    });
  }

  if (!name) {
    throw new AppError({
      message: "Tên assignedUnit là bắt buộc",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "ASSIGNED_UNIT_NAME_REQUIRED",
    });
  }

  const current = await prisma.militaryAssignedUnit.findFirst({
    where: { id },
  });

  if (!current || current.deletedAt) {
    throw new AppError({
      message: "Assigned unit không tồn tại",
      statusCode: HTTP_CODES.NOT_FOUND,
      errorCode: "ASSIGNED_UNIT_NOT_FOUND",
    });
  }

  if (current.unitId !== scopedUnitId) {
    throw new AppError({
      message: "Bạn không có quyền sửa assigned unit của đơn vị khác",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "ASSIGNED_UNIT_SCOPE_FORBIDDEN",
    });
  }

  const nameNormalized = normalizeAssignedUnitNameForCompare(name);
  const conflict = await prisma.militaryAssignedUnit.findFirst({
    where: {
      unitId: scopedUnitId,
      nameNormalized,
      NOT: {
        id,
      },
      deletedAt: null,
    },
  });

  if (conflict) {
    throw new AppError({
      message: "Assigned unit đã tồn tại trong đơn vị này",
      statusCode: HTTP_CODES.CONFLICT,
      errorCode: "ASSIGNED_UNIT_EXISTS",
    });
  }

  const assignedUnit = await prisma.militaryAssignedUnit.update({
    where: { id },
    data: {
      name,
      nameNormalized,
    },
    include: {
      unit: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return { assignedUnit: mapAssignedUnit(assignedUnit) };
}

export async function deleteAssignedUnit({ actor, assignedUnitId, unitId } = {}) {
  const id = parseInteger(assignedUnitId, "assignedUnitId");
  const scopedUnitId = resolveScopeUnitId(actor, unitId);

  if (!id) {
    throw new AppError({
      message: "assignedUnitId không hợp lệ",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "INVALID_ASSIGNED_UNIT_ID",
    });
  }

  if (!scopedUnitId) {
    throw new AppError({
      message: "unitId là bắt buộc",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "UNIT_ID_REQUIRED",
    });
  }

  const current = await prisma.militaryAssignedUnit.findFirst({
    where: { id },
  });

  if (!current) {
    throw new AppError({
      message: "Assigned unit không tồn tại",
      statusCode: HTTP_CODES.NOT_FOUND,
      errorCode: "ASSIGNED_UNIT_NOT_FOUND",
    });
  }

  if (current.unitId !== scopedUnitId) {
    throw new AppError({
      message: "Bạn không có quyền xóa assigned unit của đơn vị khác",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "ASSIGNED_UNIT_SCOPE_FORBIDDEN",
    });
  }

  if (current.deletedAt) {
    return { id };
  }

  await prisma.militaryAssignedUnit.update({
    where: { id },
    data: {
      deletedAt: new Date(),
    },
  });

  return { id };
}

export async function resolveAssignedUnitNameOrThrow({
  tx = prisma,
  assignedUnitId,
  unitId,
  fieldName = "assignedUnitId",
} = {}) {
  const parsedAssignedUnitId = parseInteger(assignedUnitId, fieldName);
  if (!parsedAssignedUnitId) return null;

  const parsedUnitId = parseInteger(unitId, "unitId");
  if (!parsedUnitId) {
    throw new AppError({
      message: "unitId là bắt buộc khi chọn assigned unit",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "ASSIGNED_UNIT_SCOPE_REQUIRED",
    });
  }

  const assignedUnit = await tx.militaryAssignedUnit.findFirst({
    where: {
      id: parsedAssignedUnitId,
      unitId: parsedUnitId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!assignedUnit) {
    throw new AppError({
      message: "Assigned unit không tồn tại hoặc không thuộc đơn vị được chọn",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "ASSIGNED_UNIT_NOT_IN_UNIT",
    });
  }

  return assignedUnit.name;
}
