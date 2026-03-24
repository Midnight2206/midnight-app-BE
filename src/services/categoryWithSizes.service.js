import { prisma } from "#configs/prisma.config.js";
import categoryService from "#services/category.service.js";
import categorySizeService from "#services/categorySize.service.js";
import { AppError } from "#utils/AppError.js";
import { HTTP_CODES } from "#src/constants.js";

class CategoryWithSizesService {
  _normalizeRelationIds(rawIds = []) {
    return [...new Set(rawIds.map((value) => Number.parseInt(value, 10)).filter((id) => Number.isInteger(id) && id > 0))];
  }

  _normalizeSizes(sizeNames = []) {
    const unique = [...new Set(sizeNames.map((s) => s.trim().toUpperCase()))];

    if (unique.length === 0) {
      return {
        sizes: ["ONESIZE"],
        isOneSize: true,
      };
    }

    if (unique.length === 1 && unique[0] === "ONESIZE") {
      return {
        sizes: ["ONESIZE"],
        isOneSize: true,
      };
    }
    const filtered = unique.filter((s) => s !== "ONESIZE");

    return {
      sizes: filtered,
      isOneSize: false,
    };
  }

  async _ensureCategoryNameUnique(tx, name, excludeId = null) {
    const category = await categoryService.findByName({ db: tx, name });
    if (category && category.id !== excludeId) {
      throw new AppError({
        statusCode: HTTP_CODES.CONFLICT,
        message: `Category name "${name}" already exists`,
        errorCode: "CATEGORY_NAME_DUPLICATE",
      });
    }
  }

  async _resolveSizeIds(tx, sizeNames) {
    if (!sizeNames.length) return [];

    const existingSizes = await tx.size.findMany({
      where: {
        name: { in: sizeNames },
        deletedAt: null,
      },
    });

    const existingMap = new Map(existingSizes.map((s) => [s.name, s.id]));

    const namesToCreate = sizeNames.filter((name) => !existingMap.has(name));

    if (namesToCreate.length) {
      await tx.size.createMany({
        data: namesToCreate.map((name) => ({ name })),
        skipDuplicates: true,
      });
    }

    const allSizes = await tx.size.findMany({
      where: {
        name: { in: sizeNames },
        deletedAt: null,
      },
    });

    return allSizes.map((s) => s.id);
  }

  async _syncCategorySizes(tx, categoryId, newSizeIds) {
    const currentSizes = await categorySizeService.findSizesByCategoryId({
      db: tx,
      categoryId,
    });

    const currentSizeIds = currentSizes.map((s) => s.id);

    const toAdd = newSizeIds.filter((id) => !currentSizeIds.includes(id));
    const toRemove = currentSizeIds.filter((id) => !newSizeIds.includes(id));

    if (toAdd.length) {
      await categorySizeService.insertManySizeWithCategoryId({
        db: tx,
        categoryId,
        sizeIds: toAdd,
      });
    }

    if (toRemove.length) {
      await categorySizeService.deleteByCategoryIdAndSizeIds({
        db: tx,
        categoryId,
        sizeIds: toRemove,
      });
    }
  }

  async _getDefaultVersionId(tx) {
    const row = await tx.supplyVersion.findFirst({
      where: { nameNormalized: "none", deletedAt: null },
      select: { id: true },
    });
    if (!row) {
      throw new AppError({
        statusCode: HTTP_CODES.NOT_FOUND,
        message: "Không tìm thấy version mặc định none",
        errorCode: "DEFAULT_VERSION_NOT_FOUND",
      });
    }
    return row.id;
  }

  async _getDefaultColorId(tx) {
    const row = await tx.supplyColor.findFirst({
      where: { nameNormalized: "none", deletedAt: null },
      select: { id: true },
    });
    if (!row) {
      throw new AppError({
        statusCode: HTTP_CODES.NOT_FOUND,
        message: "Không tìm thấy color mặc định none",
        errorCode: "DEFAULT_COLOR_NOT_FOUND",
      });
    }
    return row.id;
  }

  async _resolveVersionIds(tx, rawVersionIds) {
    const normalized = this._normalizeRelationIds(rawVersionIds);
    if (!normalized.length) {
      return [await this._getDefaultVersionId(tx)];
    }

    const rows = await tx.supplyVersion.findMany({
      where: {
        id: { in: normalized },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (rows.length !== normalized.length) {
      throw new AppError({
        statusCode: HTTP_CODES.NOT_FOUND,
        message: "Có version không tồn tại hoặc đã bị xoá",
        errorCode: "VERSION_NOT_FOUND",
      });
    }
    return normalized;
  }

  async _resolveColorIds(tx, rawColorIds) {
    const normalized = this._normalizeRelationIds(rawColorIds);
    if (!normalized.length) {
      return [await this._getDefaultColorId(tx)];
    }

    const rows = await tx.supplyColor.findMany({
      where: {
        id: { in: normalized },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (rows.length !== normalized.length) {
      throw new AppError({
        statusCode: HTTP_CODES.NOT_FOUND,
        message: "Có color không tồn tại hoặc đã bị xoá",
        errorCode: "COLOR_NOT_FOUND",
      });
    }
    return normalized;
  }

  _buildVariantTuples(versionIds = [], colorIds = []) {
    const tuples = [];
    for (const versionId of versionIds) {
      for (const colorId of colorIds) {
        tuples.push({ versionId, colorId });
      }
    }
    return tuples;
  }

  async _syncCategoryVariants(tx, categoryId, versionIds, colorIds) {
    const nextTuples = this._buildVariantTuples(versionIds, colorIds);
    const nextKeys = new Set(nextTuples.map((item) => `${item.versionId}:${item.colorId}`));

    const currentRows = await tx.categoryVariant.findMany({
      where: { categoryId },
      select: { versionId: true, colorId: true },
    });
    const currentKeys = new Set(currentRows.map((item) => `${item.versionId}:${item.colorId}`));

    const toAdd = nextTuples.filter((item) => !currentKeys.has(`${item.versionId}:${item.colorId}`));
    const toRemove = currentRows.filter(
      (item) => !nextKeys.has(`${item.versionId}:${item.colorId}`),
    );

    if (toRemove.length) {
      const blocked = await tx.categoryWarehouseStock.findFirst({
        where: {
          variant: {
            categoryId,
            OR: toRemove.map((item) => ({
              versionId: item.versionId,
              colorId: item.colorId,
            })),
          },
          quantity: { gt: 0 },
        },
        select: {
          warehouseId: true,
          variant: {
            select: {
              versionId: true,
              colorId: true,
            },
          },
          quantity: true,
        },
      });

      if (blocked) {
        throw new AppError({
          statusCode: HTTP_CODES.CONFLICT,
          message:
            "Không thể bỏ liên kết version/color vì vẫn còn tồn kho ở một hoặc nhiều kho",
          errorCode: "CATEGORY_VARIANT_HAS_STOCK",
          metadata: blocked,
        });
      }
    }

    if (toAdd.length) {
      await tx.categoryVariant.createMany({
        data: toAdd.map((item) => ({
          categoryId,
          versionId: item.versionId,
          colorId: item.colorId,
        })),
        skipDuplicates: true,
      });
    }

    if (toRemove.length) {
      await tx.categoryWarehouseStock.deleteMany({
        where: {
          variant: {
            categoryId,
            OR: toRemove.map((item) => ({
              versionId: item.versionId,
              colorId: item.colorId,
            })),
          },
        },
      });
      await tx.categoryVariant.deleteMany({
        where: {
          categoryId,
          OR: toRemove.map((item) => ({
            versionId: item.versionId,
            colorId: item.colorId,
          })),
        },
      });
    }
  }

  create = async ({
    db = prisma,
    name,
    sizeNames,
    code,
    unitOfMeasureId,
    versionId,
    colorId,
    versionIds,
    colorIds,
    totalQuantity,
    isActive,
  }) => {
    const { sizes, isOneSize } = this._normalizeSizes(sizeNames);

    return db.$transaction(async (tx) => {
      await this._ensureCategoryNameUnique(tx, name);
      const resolvedVersionIds = await this._resolveVersionIds(
        tx,
        Array.isArray(versionIds) ? versionIds : versionId !== undefined ? [versionId] : [],
      );
      const resolvedColorIds = await this._resolveColorIds(
        tx,
        Array.isArray(colorIds) ? colorIds : colorId !== undefined ? [colorId] : [],
      );

      const category = await categoryService.create({
        db: tx,
        name,
        isOneSize,
        code,
        unitOfMeasureId,
        versionId: resolvedVersionIds[0],
        colorId: resolvedColorIds[0],
        totalQuantity,
        isActive,
      });

      const sizeIds = await this._resolveSizeIds(tx, sizes);

      await categorySizeService.insertManySizeWithCategoryId({
        db: tx,
        categoryId: category.id,
        sizeIds,
      });
      await this._syncCategoryVariants(
        tx,
        category.id,
        resolvedVersionIds,
        resolvedColorIds,
      );

      return category;
    });
  };

  update = async ({
    db = prisma,
    id,
    name,
    sizeNames,
    code,
    unitOfMeasureId,
    versionId,
    colorId,
    versionIds,
    colorIds,
    totalQuantity,
    isActive,
  }) => {
    const categoryId = Number(id);
    if (Number.isNaN(categoryId)) {
      throw new AppError({
        message: "Invalid category id",
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "INVALID_CATEGORY_ID",
      });
    }

    return db.$transaction(async (tx) => {
      const category = await tx.category.findUnique({
        where: { id: categoryId },
        include: {
          variants: {
            select: {
              versionId: true,
              colorId: true,
            },
          },
          sizes: {
            where: {
              deletedAt: null,
              size: { deletedAt: null },
            },
            include: { size: true },
          },
        },
      });

      if (!category) {
        throw new AppError({
          message: "Category not found",
          statusCode: HTTP_CODES.NOT_FOUND,
          errorCode: "CATEGORY_NOT_FOUND",
        });
      }

      const hasSizesInput = Array.isArray(sizeNames);
      const normalizedSizes = hasSizesInput
        ? this._normalizeSizes(sizeNames)
        : {
            sizes: category.sizes.map((cs) => cs.size?.name).filter(Boolean),
            isOneSize: category.isOneSize,
          };

      if (name && name !== category.name) {
        await this._ensureCategoryNameUnique(tx, name, categoryId);
      }

      await categoryService.update({
        db: tx,
        categoryId,
        name: name ?? category.name,
        isOneSize: normalizedSizes.isOneSize,
        code: code ?? category.code ?? undefined,
        unitOfMeasureId,
        totalQuantity:
          totalQuantity === undefined ? category.totalQuantity : totalQuantity,
        isActive: isActive === undefined ? category.isActive : isActive,
      });

      const sizeIds = await this._resolveSizeIds(tx, normalizedSizes.sizes);
      const fallbackVersionIds = [
        ...new Set((category.variants || []).map((row) => row.versionId)),
      ];
      const fallbackColorIds = [
        ...new Set((category.variants || []).map((row) => row.colorId)),
      ];
      const resolvedVersionIds = await this._resolveVersionIds(
        tx,
        Array.isArray(versionIds)
          ? versionIds
          : versionId !== undefined
            ? [versionId]
            : fallbackVersionIds,
      );
      const resolvedColorIds = await this._resolveColorIds(
        tx,
        Array.isArray(colorIds)
          ? colorIds
          : colorId !== undefined
            ? [colorId]
            : fallbackColorIds,
      );

      await this._syncCategorySizes(tx, categoryId, sizeIds);
      await this._syncCategoryVariants(
        tx,
        categoryId,
        resolvedVersionIds,
        resolvedColorIds,
      );
      await tx.category.update({
        where: { id: categoryId },
        data: {
          versionId: resolvedVersionIds[0],
          colorId: resolvedColorIds[0],
        },
      });

      return true;
    });
  };

  deleteCategory = async ({ db = prisma, categoryId }) => {
    return db.$transaction(async (tx) => {
      await categorySizeService.softDeleteByCategoryId({
        db: tx,
        categoryId,
      });

      await categoryService.delete({
        db: tx,
        categoryId,
      });
      return true;
    });
  };
  restoreCategory = async ({ db = prisma, categoryId }) => {
    return db.$transaction(async (tx) => {
      await categoryService.restore({
        db: tx,
        categoryId,
      });

      await categorySizeService.restoreByCategoryId({
        db: tx,
        categoryId,
      });
      return true;
    });
  };
}

export default new CategoryWithSizesService();
