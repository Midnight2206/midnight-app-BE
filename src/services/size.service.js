import { prisma } from "#configs/prisma.config.js";
class SizeService {
  create = async ({ db = prisma, name }) => {
    return db.size.create({
      data: {
        name,
      },
    });
  };

  delete = async ({ db = prisma, sizeId }) => {
    return db.size.update({
      where: { id: sizeId },
      data: {
        deletedAt: new Date(),
      },
    });
  };

  update = async ({ db = prisma, sizeId, name }) => {
    return db.size.update({
      where: { id: sizeId },
      data: {
        name,
      },
    });
  };

  getAll = async ({ db = prisma }) => {
    return db.size.findMany({
      where: {
        deletedAt: null,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  };

  findById = async ({ db = prisma, sizeId }) => {
    return db.size.findFirst({
      where: {
        id: sizeId,
        deletedAt: null,
      },
    });
  };
  findManyByIds = async ({ db = prisma, sizeIds }) => {
    return db.size.findMany({
      where: {
        id: { in: sizeIds },
        deletedAt: null,
      },
    });
  };
  findByName = async ({ db = prisma, name }) => {
    return db.size.findFirst({
      where: {
        name,
        deletedAt: null,
      },
    });
  };
  exists = async ({ db = prisma, sizeId }) => {
    const count = await db.size.count({
      where: {
        id: sizeId,
        deletedAt: null,
      },
    });

    return count > 0;
  };

  existsByName = async ({ db = prisma, name, excludeId }) => {
    return db.size.findFirst({
      where: {
        name,
        deletedAt: null,
        ...(excludeId && { id: { not: excludeId } }),
      },
    });
  };
}

export default new SizeService();
