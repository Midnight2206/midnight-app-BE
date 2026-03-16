import { prisma } from "#configs/prisma.config.js";
import { AppError } from "#utils/AppError.js";
import { HTTP_CODES } from "#src/constants.js";

class CategoryService {
  _normalizeName(name) {
    return name.normalize("NFC").trim();
  }

  _normalizeForCompare(name) {
    // chỉ phục vụ so sánh: NFC + lowercase
    return this._normalizeName(name).toLowerCase();
  }

  async _findByNormalizedName({ db, nameNormalized }) {
    return db.category.findFirst({
      where: {
        nameNormalized,
      },
    });
  }

  async _ensureNameUnique({ db, name, excludeId = null }) {
    const nameNormalized = this._normalizeForCompare(name);

    const existed = await db.category.findFirst({
      where: { nameNormalized },
      include: {
        sizes: {
          include: { size: true },
        },
      },
    });

    if (!existed) return;

    if (existed.deletedAt) {
      throw new AppError({
        statusCode: HTTP_CODES.CONFLICT,
        message: `Danh mục "${name}" đã tồn tại (đã bị xoá)`,
        errorCode: "CATEGORY_NAME_DELETED",
        metadata: {
          deletedCategory: {
            id: existed.id,
            name: existed.name,
            deletedAt: existed.deletedAt,
            sizes: existed.sizes.map((cs) => cs.size),
          },
        },
      });
    }

    if (excludeId && existed.id === excludeId) return;

    throw new AppError({
      message: "Danh mục đã tồn tại",
      statusCode: HTTP_CODES.CONFLICT,
      errorCode: "CATEGORY_NAME_DUPLICATE",
    });
  }

  async _assertUnitOfMeasureAvailable({ db, unitOfMeasureId }) {
    if (unitOfMeasureId === undefined || unitOfMeasureId === null) return null;
    const existed = await db.unitOfMeasure.findFirst({
      where: { id: unitOfMeasureId, deletedAt: null },
      select: { id: true },
    });
    if (!existed) {
      throw new AppError({
        statusCode: HTTP_CODES.NOT_FOUND,
        message: "Đơn vị tính không tồn tại hoặc đã bị xoá",
        errorCode: "UNIT_OF_MEASURE_NOT_FOUND",
      });
    }
    return existed.id;
  }

  async _assertVersionAvailable({ db, versionId }) {
    if (versionId === undefined || versionId === null) return null;
    const existed = await db.supplyVersion.findFirst({
      where: { id: versionId, deletedAt: null },
      select: { id: true },
    });
    if (!existed) {
      throw new AppError({
        statusCode: HTTP_CODES.NOT_FOUND,
        message: "Version không tồn tại hoặc đã bị xoá",
        errorCode: "VERSION_NOT_FOUND",
      });
    }
    return existed.id;
  }

  async _assertColorAvailable({ db, colorId }) {
    if (colorId === undefined || colorId === null) return null;
    const existed = await db.supplyColor.findFirst({
      where: { id: colorId, deletedAt: null },
      select: { id: true },
    });
    if (!existed) {
      throw new AppError({
        statusCode: HTTP_CODES.NOT_FOUND,
        message: "Color không tồn tại hoặc đã bị xoá",
        errorCode: "COLOR_NOT_FOUND",
      });
    }
    return existed.id;
  }

  async _ensureCodeUnique({ db, code, excludeId = null }) {
    const normalized = String(code || "").trim();
    if (!normalized) return null;
    const existed = await db.category.findFirst({
      where: { code: normalized },
      select: { id: true },
    });
    if (!existed) return normalized;
    if (excludeId && existed.id === excludeId) return normalized;
    throw new AppError({
      statusCode: HTTP_CODES.CONFLICT,
      message: "Mã category đã tồn tại",
      errorCode: "CATEGORY_CODE_DUPLICATE",
    });
  }

  create = async ({
    db = prisma,
    name,
    isOneSize = false,
    code,
    unitOfMeasureId,
    versionId,
    colorId,
    totalQuantity = 0,
    isActive = true,
  }) => {
    await this._ensureNameUnique({ db, name });

    const normalizedName = this._normalizeName(name);
    const nameNormalized = this._normalizeForCompare(name);
    const uniqueCode = await this._ensureCodeUnique({ db, code });
    const [resolvedUnitOfMeasureId, resolvedVersionId, resolvedColorId] =
      await Promise.all([
        this._assertUnitOfMeasureAvailable({ db, unitOfMeasureId }),
        this._assertVersionAvailable({ db, versionId }),
        this._assertColorAvailable({ db, colorId }),
      ]);

    return db.category.create({
      data: {
        name: normalizedName,
        isOneSize,
        nameNormalized,
        code: uniqueCode || null,
        unitOfMeasureId: resolvedUnitOfMeasureId,
        versionId: resolvedVersionId,
        colorId: resolvedColorId,
        totalQuantity: Number.isInteger(Number(totalQuantity))
          ? Math.max(0, Number(totalQuantity))
          : 0,
        isActive: Boolean(isActive),
      },
    });
  };

  // =========================
  // UPDATE
  // =========================
  update = async ({
    db = prisma,
    categoryId,
    name,
    isOneSize,
    code,
    unitOfMeasureId,
    versionId,
    colorId,
    totalQuantity,
    isActive,
  }) => {
    const data = {};

    if (name !== undefined) {
      await this._ensureNameUnique({
        db,
        name,
        excludeId: categoryId,
      });
      data.name = this._normalizeName(name);
      data.nameNormalized = this._normalizeForCompare(name);
    }

    if (code !== undefined) {
      const uniqueCode = await this._ensureCodeUnique({
        db,
        code,
        excludeId: categoryId,
      });
      data.code = uniqueCode || null;
    }

    if (unitOfMeasureId !== undefined) {
      data.unitOfMeasureId = await this._assertUnitOfMeasureAvailable({
        db,
        unitOfMeasureId,
      });
    }

    if (versionId !== undefined) {
      data.versionId = await this._assertVersionAvailable({
        db,
        versionId,
      });
    }

    if (colorId !== undefined) {
      data.colorId = await this._assertColorAvailable({
        db,
        colorId,
      });
    }

    if (isOneSize !== undefined) {
      data.isOneSize = isOneSize;
    }

    return db.category.update({
      where: { id: categoryId },
      data: {
        ...data,
        ...(totalQuantity !== undefined
          ? { totalQuantity: Math.max(0, Number.parseInt(totalQuantity, 10) || 0) }
          : {}),
        ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
      },
    });
  };

  // =========================
  // SOFT DELETE
  // =========================
  delete = async ({ db = prisma, categoryId }) => {
    return db.category.update({
      where: { id: categoryId },
      data: { deletedAt: new Date() },
    });
  };
  restore = async ({ db = prisma, categoryId }) => {
    return db.category.update({
      where: { id: categoryId, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
  };
  // =========================
  // GET ALL
  // =========================
  // =========================
  // GET ALL (FILTER + SEARCH + SORT)
  // =========================
  getAll = async ({
    db = prisma,
    search,
    status = "active", // deleted | active | all
    sortBy = "createdAt", // createdAt | name
    order = "desc", // asc | desc
  } = {}) => {
    const where = {};

    // ===== FILTER DELETED =====
    if (status === "active") {
      where.deletedAt = null;
    }

    if (status === "deleted") {
      where.deletedAt = { not: null };
    }
    if (search) {
      where.nameNormalized = {
        contains: this._normalizeForCompare(search),
      };
    }

    const orderBy = {};
    const allowedSortFields = ["createdAt", "name"];

    if (allowedSortFields.includes(sortBy)) {
      orderBy[sortBy] = order === "asc" ? "asc" : "desc";
    } else {
      orderBy.createdAt = "desc";
    }

    // ===== QUERY =====
    const categories = await db.category.findMany({
      where,
      orderBy,
      include: {
        unitOfMeasure: true,
        version: true,
        color: true,
        variants: {
          where: {
            category: { deletedAt: null },
            version: { deletedAt: null },
            color: { deletedAt: null },
          },
          include: {
            version: true,
            color: true,
          },
        },
        sizes: {
          where: {
            size: {
              deletedAt: null,
            },
          },
          include: {
            size: true,
          },
        },
      },
    });

    // ===== TRANSFORM =====
    return categories.map((c) => {
      const versionsMap = new Map();
      const colorsMap = new Map();
      (c.variants || []).forEach((row) => {
        if (row.version) versionsMap.set(row.version.id, { id: row.version.id, name: row.version.name });
        if (row.color) colorsMap.set(row.color.id, { id: row.color.id, name: row.color.name });
      });

      return ({
      id: c.id,
      name: c.name,
      code: c.code,
      isActive: c.isActive,
      totalQuantity: c.totalQuantity,
      unitOfMeasure: c.unitOfMeasure
        ? { id: c.unitOfMeasure.id, name: c.unitOfMeasure.name }
        : null,
      version: c.version ? { id: c.version.id, name: c.version.name } : null,
      color: c.color ? { id: c.color.id, name: c.color.name } : null,
      versions: Array.from(versionsMap.values()),
      colors: Array.from(colorsMap.values()),
      createdAt: c.createdAt,
      deletedAt: c.deletedAt,
      sizes: c.sizes.filter((cs) => cs.size).map((cs) => cs.size),
      });
    });
  };

  findByName = async ({ db = prisma, name }) => {
    const nameNormalized = this._normalizeForCompare(name);

    return db.category.findFirst({
      where: {
        nameNormalized,
        deletedAt: null,
      },
    });
  };
}

export default new CategoryService();
