import { prisma } from "#configs/prisma.config.js";
import { ensureDefaultWarehouses } from "#services/inventory/warehouse.service.js";
import { buildAutoItemCode } from "#services/inventory/item-code.service.js";
import {
  resolveColorId,
  resolveVersionId,
} from "#services/inventory/item-variant.service.js";
import {
  getActorUnitId,
  normalizeName,
  normalizeForCompare,
  parsePositiveInt,
  throwBadRequest,
  throwConflict,
  throwNotFound,
} from "#services/inventory/common.js";

async function assertCategoryAvailable({ categoryId }) {
  const category = await prisma.category.findFirst({
    where: {
      id: categoryId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      sizes: {
        where: {
          size: { deletedAt: null },
        },
        include: {
          size: {
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  if (!category) {
    throwNotFound("Danh mục không tồn tại hoặc đã bị xoá", "CATEGORY_NOT_FOUND");
  }

  return category;
}

async function assertUnitOfMeasureAvailable({ unitOfMeasureId }) {
  const unit = await prisma.unitOfMeasure.findFirst({
    where: {
      id: unitOfMeasureId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!unit) {
    throwNotFound(
      "Đơn vị tính không tồn tại hoặc đã bị xoá",
      "UNIT_OF_MEASURE_NOT_FOUND",
    );
  }

  return unit;
}

async function resolveUnitOfMeasureId(rawUnitOfMeasureId) {
  const hasRawValue =
    rawUnitOfMeasureId !== undefined &&
    rawUnitOfMeasureId !== null &&
    String(rawUnitOfMeasureId).trim() !== "";
  const parsed = hasRawValue ? Number.parseInt(rawUnitOfMeasureId, 10) : null;

  if (Number.isInteger(parsed) && parsed > 0) {
    const unit = await assertUnitOfMeasureAvailable({ unitOfMeasureId: parsed });
    return unit.id;
  }

  if (hasRawValue) {
    throwBadRequest(
      "unitOfMeasureId không hợp lệ",
      "INVALID_UNIT_OF_MEASURE_ID",
    );
  }

  const fallback = await prisma.unitOfMeasure.findFirst({
    where: { deletedAt: null },
    orderBy: [{ id: "asc" }],
    select: { id: true },
  });

  if (!fallback) {
    throwNotFound(
      "Không có đơn vị tính khả dụng để tạo mặt hàng",
      "UNIT_OF_MEASURE_NOT_FOUND",
    );
  }

  return fallback.id;
}

async function assertItemNameUnique({ nameNormalized, excludeId = null }) {
  const existed = await prisma.supplyItem.findFirst({
    where: {
      nameNormalized,
    },
    include: {
      category: {
        select: { id: true, name: true },
      },
    },
  });

  if (!existed) return;
  if (excludeId && existed.id === excludeId) return;

  throwConflict(
    existed.deletedAt
      ? "Mặt hàng đã tồn tại nhưng đang ở trạng thái đã xóa"
      : "Mặt hàng đã tồn tại",
    "SUPPLY_ITEM_NAME_DUPLICATE",
    {
      existed: {
        id: existed.id,
        name: existed.name,
        category: existed.category,
        deletedAt: existed.deletedAt,
      },
    },
  );
}

function mapItem(item) {
  const stockByWarehouse = item.stocks.map((stock) => ({
    warehouseId: stock.warehouseId,
    warehouseName: stock.warehouse.name,
    quantity: stock.quantity,
  }));

  const totalQuantity = stockByWarehouse.reduce(
    (sum, current) => sum + current.quantity,
    0,
  );

  return {
    id: item.id,
    name: item.name,
    code: item.code,
    isActive: item.isActive,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    deletedAt: item.deletedAt,
    category: {
      id: item.category.id,
      name: item.category.name,
      sizes: item.category.sizes.map((cs) => cs.size),
    },
    unitOfMeasure: item.unitOfMeasure
      ? {
          id: item.unitOfMeasure.id,
          name: item.unitOfMeasure.name,
        }
      : null,
    version: item.version
      ? {
          id: item.version.id,
          name: item.version.name,
        }
      : null,
    color: item.color
      ? {
          id: item.color.id,
          name: item.color.name,
        }
      : null,
    stockByWarehouse,
    totalQuantity,
  };
}

export async function listItems({
  actor,
  search,
  categoryId,
  status = "active",
  page,
  limit,
}) {
  const unitId = getActorUnitId(actor);
  await ensureDefaultWarehouses({ unitId });

  const currentPage = parsePositiveInt(page, 1);
  const pageSize = Math.min(parsePositiveInt(limit, 20), 100);

  const where = {};
  if (status === "active") where.deletedAt = null;
  if (status === "deleted") where.deletedAt = { not: null };

  if (search) {
    where.nameNormalized = { contains: normalizeForCompare(search) };
  }

  if (categoryId !== undefined) {
    const parsedCategoryId = Number.parseInt(categoryId, 10);
    if (!Number.isInteger(parsedCategoryId) || parsedCategoryId <= 0) {
      throwBadRequest("categoryId không hợp lệ", "INVALID_CATEGORY_ID");
    }
    where.categoryId = parsedCategoryId;
  }

  const [total, items] = await Promise.all([
    prisma.supplyItem.count({ where }),
    prisma.supplyItem.findMany({
      where,
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      include: {
        category: {
          select: {
            id: true,
            name: true,
            sizes: {
              where: {
                size: { deletedAt: null },
              },
              include: {
                size: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
        unitOfMeasure: {
          select: {
            id: true,
            name: true,
          },
        },
        version: {
          select: {
            id: true,
            name: true,
          },
        },
        color: {
          select: {
            id: true,
            name: true,
          },
        },
        stocks: {
          where: {
            warehouse: {
              unitId,
              deletedAt: null,
            },
          },
          include: {
            warehouse: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    items: items.map(mapItem),
    pagination: {
      page: currentPage,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 1,
    },
  };
}

export async function createItem({ actor, body }) {
  const unitId = getActorUnitId(actor);
  await ensureDefaultWarehouses({ unitId });

  const name = normalizeName(body?.name);
  const categoryId = Number.parseInt(body?.categoryId, 10);

  if (!name) {
    throwBadRequest("Tên mặt hàng là bắt buộc", "ITEM_NAME_REQUIRED");
  }

  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    throwBadRequest("categoryId không hợp lệ", "INVALID_CATEGORY_ID");
  }

  const nameNormalized = normalizeForCompare(name);

  const [category, unitOfMeasureId, versionId, colorId] = await Promise.all([
    assertCategoryAvailable({ categoryId }),
    resolveUnitOfMeasureId(body?.unitOfMeasureId),
    resolveVersionId(body?.versionId),
    resolveColorId(body?.colorId),
  ]);
  await assertItemNameUnique({ nameNormalized });

  const item = await prisma.supplyItem.create({
    data: {
      name,
      nameNormalized,
      code: null,
      categoryId,
      unitOfMeasureId,
      versionId,
      colorId,
      isActive: body?.isActive !== false,
    },
    include: {
      category: {
        select: {
          id: true,
          name: true,
          sizes: {
            where: {
              size: { deletedAt: null },
            },
            include: {
              size: {
                select: { id: true, name: true },
              },
            },
          },
        },
      },
      unitOfMeasure: {
        select: {
          id: true,
          name: true,
        },
      },
      version: {
        select: {
          id: true,
          name: true,
        },
      },
      color: {
        select: {
          id: true,
          name: true,
        },
      },
      stocks: {
        where: {
          warehouse: {
            unitId,
            deletedAt: null,
          },
        },
        include: {
          warehouse: {
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  const generatedCode = buildAutoItemCode(item.id);
  const itemWithCode = await prisma.supplyItem.update({
    where: { id: item.id },
    data: { code: generatedCode },
    include: {
      category: {
        select: {
          id: true,
          name: true,
          sizes: {
            where: {
              size: { deletedAt: null },
            },
            include: {
              size: {
                select: { id: true, name: true },
              },
            },
          },
        },
      },
      unitOfMeasure: {
        select: {
          id: true,
          name: true,
        },
      },
      version: {
        select: {
          id: true,
          name: true,
        },
      },
      color: {
        select: {
          id: true,
          name: true,
        },
      },
      stocks: {
        where: {
          warehouse: {
            unitId,
            deletedAt: null,
          },
        },
        include: {
          warehouse: {
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  return {
    item: {
      ...mapItem(itemWithCode),
      category: {
        id: category.id,
        name: category.name,
        sizes: category.sizes.map((cs) => cs.size),
      },
    },
  };
}

export async function updateItem({ actor, itemId, body }) {
  const unitId = getActorUnitId(actor);
  await ensureDefaultWarehouses({ unitId });

  const id = Number.parseInt(itemId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throwBadRequest("itemId không hợp lệ", "INVALID_ITEM_ID");
  }

  const current = await prisma.supplyItem.findFirst({
    where: { id },
  });

  if (!current) {
    throwNotFound("Mặt hàng không tồn tại", "ITEM_NOT_FOUND");
  }

  const patch = {};

  if (body?.name !== undefined) {
    const name = normalizeName(body?.name);
    if (!name) {
      throwBadRequest("Tên mặt hàng không được để trống", "ITEM_NAME_REQUIRED");
    }
    patch.name = name;
    patch.nameNormalized = normalizeForCompare(name);
    await assertItemNameUnique({ nameNormalized: patch.nameNormalized, excludeId: id });
  }

  if (body?.categoryId !== undefined) {
    const categoryId = Number.parseInt(body.categoryId, 10);
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      throwBadRequest("categoryId không hợp lệ", "INVALID_CATEGORY_ID");
    }
    await assertCategoryAvailable({ categoryId });
    patch.categoryId = categoryId;
  }

  if (body?.unitOfMeasureId !== undefined) {
    const unitOfMeasureId = Number.parseInt(body.unitOfMeasureId, 10);
    if (!Number.isInteger(unitOfMeasureId) || unitOfMeasureId <= 0) {
      throwBadRequest(
        "unitOfMeasureId không hợp lệ",
        "INVALID_UNIT_OF_MEASURE_ID",
      );
    }
    await assertUnitOfMeasureAvailable({ unitOfMeasureId });
    patch.unitOfMeasureId = unitOfMeasureId;
  }

  if (body?.versionId !== undefined) {
    patch.versionId = await resolveVersionId(body.versionId);
  }

  if (body?.colorId !== undefined) {
    patch.colorId = await resolveColorId(body.colorId);
  }

  if (body?.isActive !== undefined) {
    patch.isActive = Boolean(body.isActive);
  }

  const item = await prisma.supplyItem.update({
    where: { id },
    data: patch,
    include: {
      category: {
        select: {
          id: true,
          name: true,
          sizes: {
            where: {
              size: { deletedAt: null },
            },
            include: {
              size: {
                select: { id: true, name: true },
              },
            },
          },
        },
      },
      unitOfMeasure: {
        select: {
          id: true,
          name: true,
        },
      },
      version: {
        select: {
          id: true,
          name: true,
        },
      },
      color: {
        select: {
          id: true,
          name: true,
        },
      },
      stocks: {
        where: {
          warehouse: {
            unitId,
            deletedAt: null,
          },
        },
        include: {
          warehouse: {
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  return { item: mapItem(item) };
}

export async function deleteItem({ itemId }) {
  const id = Number.parseInt(itemId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throwBadRequest("itemId không hợp lệ", "INVALID_ITEM_ID");
  }

  const existed = await prisma.supplyItem.findFirst({ where: { id } });
  if (!existed) {
    throwNotFound("Mặt hàng không tồn tại", "ITEM_NOT_FOUND");
  }

  await prisma.supplyItem.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      isActive: false,
    },
  });

  return { id };
}

export async function restoreItem({ itemId }) {
  const id = Number.parseInt(itemId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throwBadRequest("itemId không hợp lệ", "INVALID_ITEM_ID");
  }

  const existed = await prisma.supplyItem.findFirst({ where: { id } });
  if (!existed) {
    throwNotFound("Mặt hàng không tồn tại", "ITEM_NOT_FOUND");
  }

  await prisma.supplyItem.update({
    where: { id },
    data: {
      deletedAt: null,
      isActive: true,
    },
  });

  return { id };
}
