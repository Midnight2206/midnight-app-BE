import { prisma } from "#configs/prisma.config.js";

class CategorySizeService {
  create = async ({ db = prisma, categoryId, sizeId }) => {
    return db.categorySize.create({
      data: {
        categoryId,
        sizeId,
      },
    });
  };

  delete = async ({ db = prisma, categoryId, sizeId }) => {
    return db.categorySize.deleteMany({
      where: {
        categoryId,
        sizeId,
        deletedAt: null,
      },
    });
  };

  deleteByCategoryId = async ({ db = prisma, categoryId }) => {
    return db.categorySize.deleteMany({
      where: {
        categoryId,
      },
    });
  };
  softDeleteByCategoryId = async ({ db = prisma, categoryId }) => {
    return db.categorySize.updateMany({
      where: {
        categoryId,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  };
  restoreByCategoryId = async ({ db = prisma, categoryId }) => {
    return db.categorySize.updateMany({
      where: {
        categoryId,
        deletedAt: { not: null },
      },
      data: {
        deletedAt: null,
      },
    });
  };
  findSizesByCategoryId = async ({ db = prisma, categoryId }) => {
    const categorySizes = await db.categorySize.findMany({
      where: {
        categoryId,
        size: {
          deletedAt: null,
        },
      },
      include: {
        size: true,
      },
    });

    return categorySizes.map((cs) => cs.size);
  };

  insertManySizeWithCategoryId = async ({
    db = prisma,
    categoryId,
    sizeIds,
  }) => {
    if (!sizeIds.length) return;

    const data = sizeIds.map((sizeId) => ({
      categoryId,
      sizeId,
    }));

    return db.categorySize.createMany({
      data,
      skipDuplicates: true,
    });
  };
  deleteByCategoryIdAndSizeIds = async ({
    db = prisma,
    categoryId,
    sizeIds,
  }) => {
    if (!sizeIds.length) return;

    return db.categorySize.deleteMany({
      where: {
        categoryId,
        sizeId: {
          in: sizeIds,
        },
      },
    });
  };

  exists = async ({ db = prisma, categoryId, sizeId }) => {
    const count = await db.categorySize.count({
      where: {
        categoryId,
        sizeId,
      },
    });

    return count > 0;
  };
}

export default new CategorySizeService();
