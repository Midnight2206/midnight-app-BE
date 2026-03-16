import { prisma } from "#configs/prisma.config.js";
import {
  normalizeForCompare,
  normalizeName,
  throwBadRequest,
  throwConflict,
  throwNotFound,
} from "#services/inventory/common.js";

export const DEFAULT_UNIT_OF_MEASURES = ["Cái", "Bộ", "Suất", "Đôi", "Chiếc"];

function mapUnit(unit) {
  return {
    id: unit.id,
    name: unit.name,
    createdAt: unit.createdAt,
    updatedAt: unit.updatedAt,
    deletedAt: unit.deletedAt,
  };
}

export async function ensureDefaultUnitOfMeasures() {
  const names = DEFAULT_UNIT_OF_MEASURES.map((name) => ({
    name,
    nameNormalized: normalizeForCompare(name),
  }));

  await prisma.unitOfMeasure.createMany({
    data: names,
    skipDuplicates: true,
  });
}

export async function listUnitOfMeasures({ status = "active" } = {}) {
  await ensureDefaultUnitOfMeasures();

  const where = {};
  if (status === "active") where.deletedAt = null;
  if (status === "deleted") where.deletedAt = { not: null };

  const units = await prisma.unitOfMeasure.findMany({
    where,
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });

  return {
    unitOfMeasures: units.map(mapUnit),
  };
}

export async function createUnitOfMeasure({ body }) {
  await ensureDefaultUnitOfMeasures();

  const name = normalizeName(body?.name);
  if (!name) {
    throwBadRequest("Tên đơn vị tính là bắt buộc", "UNIT_OF_MEASURE_NAME_REQUIRED");
  }

  const nameNormalized = normalizeForCompare(name);
  const existed = await prisma.unitOfMeasure.findFirst({
    where: { nameNormalized },
  });

  if (existed && !existed.deletedAt) {
    throwConflict("Đơn vị tính đã tồn tại", "UNIT_OF_MEASURE_DUPLICATE");
  }

  if (existed?.deletedAt) {
    const restored = await prisma.unitOfMeasure.update({
      where: { id: existed.id },
      data: {
        name,
        deletedAt: null,
      },
    });
    return { unitOfMeasure: mapUnit(restored) };
  }

  const unit = await prisma.unitOfMeasure.create({
    data: {
      name,
      nameNormalized,
    },
  });

  return { unitOfMeasure: mapUnit(unit) };
}

export async function deleteUnitOfMeasure({ unitOfMeasureId }) {
  const id = Number.parseInt(unitOfMeasureId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throwBadRequest("unitOfMeasureId không hợp lệ", "INVALID_UNIT_OF_MEASURE_ID");
  }

  const unit = await prisma.unitOfMeasure.findFirst({
    where: { id },
  });

  if (!unit) {
    throwNotFound("Đơn vị tính không tồn tại", "UNIT_OF_MEASURE_NOT_FOUND");
  }

  if (unit.deletedAt) return { id: unit.id };

  const inUse = await prisma.supplyItem.findFirst({
    where: {
      unitOfMeasureId: id,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (inUse) {
    throwConflict(
      "Đơn vị tính đang được dùng bởi mặt hàng quân trang, không thể xoá",
      "UNIT_OF_MEASURE_IN_USE",
    );
  }

  await prisma.unitOfMeasure.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return { id };
}
