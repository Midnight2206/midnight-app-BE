import { prisma } from "#configs/prisma.config.js";
import {
  normalizeForCompare,
  normalizeName,
  throwBadRequest,
  throwConflict,
  throwNotFound,
} from "#services/inventory/common.js";

const DEFAULT_NONE_VALUE = "none";

function mapVersion(version) {
  return {
    id: version.id,
    name: version.name,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
    deletedAt: version.deletedAt,
  };
}

function mapColor(color) {
  return {
    id: color.id,
    name: color.name,
    createdAt: color.createdAt,
    updatedAt: color.updatedAt,
    deletedAt: color.deletedAt,
  };
}

export async function ensureDefaultVersionsAndColors() {
  await prisma.supplyVersion.createMany({
    data: [{ name: DEFAULT_NONE_VALUE, nameNormalized: DEFAULT_NONE_VALUE }],
    skipDuplicates: true,
  });
  await prisma.supplyColor.createMany({
    data: [{ name: DEFAULT_NONE_VALUE, nameNormalized: DEFAULT_NONE_VALUE }],
    skipDuplicates: true,
  });
}

async function getDefaultVersionId() {
  await ensureDefaultVersionsAndColors();
  const version = await prisma.supplyVersion.findFirst({
    where: { nameNormalized: DEFAULT_NONE_VALUE },
    select: { id: true },
  });
  if (!version) {
    throwNotFound("Không tìm thấy version mặc định", "DEFAULT_VERSION_NOT_FOUND");
  }
  return version.id;
}

async function getDefaultColorId() {
  await ensureDefaultVersionsAndColors();
  const color = await prisma.supplyColor.findFirst({
    where: { nameNormalized: DEFAULT_NONE_VALUE },
    select: { id: true },
  });
  if (!color) {
    throwNotFound("Không tìm thấy color mặc định", "DEFAULT_COLOR_NOT_FOUND");
  }
  return color.id;
}

export async function resolveVersionId(rawVersionId) {
  const hasRawValue =
    rawVersionId !== undefined &&
    rawVersionId !== null &&
    String(rawVersionId).trim() !== "";

  if (!hasRawValue) return getDefaultVersionId();

  const parsed = Number.parseInt(rawVersionId, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throwBadRequest("versionId không hợp lệ", "INVALID_VERSION_ID");
  }

  const existed = await prisma.supplyVersion.findFirst({
    where: { id: parsed, deletedAt: null },
    select: { id: true },
  });
  if (!existed) {
    throwNotFound("Version không tồn tại hoặc đã bị xoá", "VERSION_NOT_FOUND");
  }

  return existed.id;
}

export async function resolveColorId(rawColorId) {
  const hasRawValue =
    rawColorId !== undefined &&
    rawColorId !== null &&
    String(rawColorId).trim() !== "";

  if (!hasRawValue) return getDefaultColorId();

  const parsed = Number.parseInt(rawColorId, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throwBadRequest("colorId không hợp lệ", "INVALID_COLOR_ID");
  }

  const existed = await prisma.supplyColor.findFirst({
    where: { id: parsed, deletedAt: null },
    select: { id: true },
  });
  if (!existed) {
    throwNotFound("Color không tồn tại hoặc đã bị xoá", "COLOR_NOT_FOUND");
  }

  return existed.id;
}

export async function listVersions({ status = "active" } = {}) {
  await ensureDefaultVersionsAndColors();

  const where = {};
  if (status === "active") where.deletedAt = null;
  if (status === "deleted") where.deletedAt = { not: null };

  const versions = await prisma.supplyVersion.findMany({
    where,
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });

  return {
    versions: versions.map(mapVersion),
  };
}

export async function createVersion({ body }) {
  await ensureDefaultVersionsAndColors();

  const name = normalizeName(body?.name);
  if (!name) {
    throwBadRequest("Tên version là bắt buộc", "VERSION_NAME_REQUIRED");
  }

  const nameNormalized = normalizeForCompare(name);
  const existed = await prisma.supplyVersion.findFirst({
    where: { nameNormalized },
  });

  if (existed && !existed.deletedAt) {
    throwConflict("Version đã tồn tại", "VERSION_DUPLICATE");
  }

  if (existed?.deletedAt) {
    const restored = await prisma.supplyVersion.update({
      where: { id: existed.id },
      data: {
        name,
        deletedAt: null,
      },
    });
    return { version: mapVersion(restored) };
  }

  const version = await prisma.supplyVersion.create({
    data: {
      name,
      nameNormalized,
    },
  });

  return { version: mapVersion(version) };
}

export async function deleteVersion({ versionId }) {
  await ensureDefaultVersionsAndColors();

  const id = Number.parseInt(versionId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throwBadRequest("versionId không hợp lệ", "INVALID_VERSION_ID");
  }

  const version = await prisma.supplyVersion.findFirst({ where: { id } });
  if (!version) {
    throwNotFound("Version không tồn tại", "VERSION_NOT_FOUND");
  }

  if (version.nameNormalized === DEFAULT_NONE_VALUE) {
    throwConflict("Không thể xoá version mặc định none", "DEFAULT_VERSION_PROTECTED");
  }

  if (version.deletedAt) return { id };

  const inUse = await prisma.supplyItem.findFirst({
    where: { versionId: id, deletedAt: null },
    select: { id: true },
  });
  const inUseByCategoryVariant = await prisma.categoryVariant.findFirst({
    where: { versionId: id },
    select: { categoryId: true },
  });

  if (inUse || inUseByCategoryVariant) {
    throwConflict(
      "Version đang được dùng bởi mặt hàng hoặc tổ hợp mặt hàng-version-color",
      "VERSION_IN_USE",
    );
  }

  await prisma.supplyVersion.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return { id };
}

export async function listColors({ status = "active" } = {}) {
  await ensureDefaultVersionsAndColors();

  const where = {};
  if (status === "active") where.deletedAt = null;
  if (status === "deleted") where.deletedAt = { not: null };

  const colors = await prisma.supplyColor.findMany({
    where,
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });

  return {
    colors: colors.map(mapColor),
  };
}

export async function createColor({ body }) {
  await ensureDefaultVersionsAndColors();

  const name = normalizeName(body?.name);
  if (!name) {
    throwBadRequest("Tên color là bắt buộc", "COLOR_NAME_REQUIRED");
  }

  const nameNormalized = normalizeForCompare(name);
  const existed = await prisma.supplyColor.findFirst({
    where: { nameNormalized },
  });

  if (existed && !existed.deletedAt) {
    throwConflict("Color đã tồn tại", "COLOR_DUPLICATE");
  }

  if (existed?.deletedAt) {
    const restored = await prisma.supplyColor.update({
      where: { id: existed.id },
      data: {
        name,
        deletedAt: null,
      },
    });
    return { color: mapColor(restored) };
  }

  const color = await prisma.supplyColor.create({
    data: {
      name,
      nameNormalized,
    },
  });

  return { color: mapColor(color) };
}

export async function deleteColor({ colorId }) {
  await ensureDefaultVersionsAndColors();

  const id = Number.parseInt(colorId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throwBadRequest("colorId không hợp lệ", "INVALID_COLOR_ID");
  }

  const color = await prisma.supplyColor.findFirst({ where: { id } });
  if (!color) {
    throwNotFound("Color không tồn tại", "COLOR_NOT_FOUND");
  }

  if (color.nameNormalized === DEFAULT_NONE_VALUE) {
    throwConflict("Không thể xoá color mặc định none", "DEFAULT_COLOR_PROTECTED");
  }

  if (color.deletedAt) return { id };

  const inUse = await prisma.supplyItem.findFirst({
    where: { colorId: id, deletedAt: null },
    select: { id: true },
  });
  const inUseByCategoryVariant = await prisma.categoryVariant.findFirst({
    where: { colorId: id },
    select: { categoryId: true },
  });

  if (inUse || inUseByCategoryVariant) {
    throwConflict(
      "Color đang được dùng bởi mặt hàng hoặc tổ hợp mặt hàng-version-color",
      "COLOR_IN_USE",
    );
  }

  await prisma.supplyColor.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return { id };
}
