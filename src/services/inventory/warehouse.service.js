import { prisma } from "#configs/prisma.config.js";
import {
  DEFAULT_WAREHOUSES,
  getActorUnitId,
  normalizeForCompare,
  normalizeName,
  throwBadRequest,
  throwConflict,
  throwNotFound,
} from "#services/inventory/common.js";

export async function ensureDefaultWarehouses({ unitId, db = prisma } = {}) {
  if (!unitId) {
    throwBadRequest("unitId là bắt buộc", "UNIT_ID_REQUIRED");
  }

  const existing = await db.warehouse.findMany({
    where: {
      unitId,
      name: {
        in: DEFAULT_WAREHOUSES,
      },
    },
    select: { name: true },
  });

  const existingNames = new Set(existing.map((w) => w.name));

  const missing = DEFAULT_WAREHOUSES.filter((name) => !existingNames.has(name));
  if (missing.length === 0) return;

  await db.warehouse.createMany({
    data: missing.map((name, index) => ({
      unitId,
      name,
      nameNormalized: normalizeForCompare(name),
      isSystemDefault: true,
      sortOrder: DEFAULT_WAREHOUSES.indexOf(name) + index + 1,
    })),
    skipDuplicates: true,
  });
}

async function ensureWarehouseNameUnique({ unitId, nameNormalized, excludeId = null }) {
  const existed = await prisma.warehouse.findFirst({
    where: {
      unitId,
      nameNormalized,
    },
  });

  if (!existed) return;
  if (excludeId && existed.id === excludeId) return;

  throwConflict(
    existed.deletedAt
      ? "Tên kho đã tồn tại nhưng đang ở trạng thái đã xoá"
      : "Tên kho đã tồn tại trong đơn vị",
    "WAREHOUSE_NAME_DUPLICATE",
  );
}

function mapWarehouse(warehouse) {
  const linkedCategoryIds = [
    ...new Set(
      (warehouse.categoryWarehouseStocks || [])
        .map((item) => item.variant?.categoryId)
        .filter((id) => Number.isInteger(id)),
    ),
  ];
  return {
    id: warehouse.id,
    unitId: warehouse.unitId,
    name: warehouse.name,
    isSystemDefault: warehouse.isSystemDefault,
    sortOrder: warehouse.sortOrder,
    createdAt: warehouse.createdAt,
    updatedAt: warehouse.updatedAt,
    deletedAt: warehouse.deletedAt,
    itemCount: linkedCategoryIds.length || warehouse._count?.categoryWarehouseStocks || 0,
    linkedCategoryIds,
  };
}

function normalizeCategoryIds(rawIds) {
  if (!Array.isArray(rawIds)) return [];
  return [
    ...new Set(
      rawIds
        .map((id) => Number.parseInt(id, 10))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];
}

async function validateCategoryIds(categoryIds) {
  if (!categoryIds.length) return;
  const categories = await prisma.category.findMany({
    where: {
      id: { in: categoryIds },
      deletedAt: null,
    },
    select: { id: true },
  });
  if (categories.length !== categoryIds.length) {
    throwBadRequest("Có mặt hàng không tồn tại hoặc đã bị xoá", "CATEGORY_NOT_FOUND");
  }
}

async function getActiveVariantRowsByCategoryIds(categoryIds) {
  if (!categoryIds.length) return [];
  return prisma.categoryVariant.findMany({
    where: {
      categoryId: { in: categoryIds },
      category: { deletedAt: null },
      version: { deletedAt: null },
      color: { deletedAt: null },
    },
    select: {
      id: true,
      categoryId: true,
    },
  });
}

function buildVariantTupleKey({ categoryId, versionId, colorId }) {
  return `${categoryId}-${versionId}-${colorId}`;
}

async function mapItemRowsToVariantIdMap(itemRows) {
  if (!itemRows.length) return new Map();

  const tupleByItemId = new Map();
  const tuples = [];
  for (const item of itemRows) {
    const versionId = Number(item.versionId || item.category?.versionId || 0);
    const colorId = Number(item.colorId || item.category?.colorId || 0);
    if (!versionId || !colorId) continue;
    const tuple = {
      categoryId: item.categoryId,
      versionId,
      colorId,
    };
    tupleByItemId.set(item.id, tuple);
    tuples.push(tuple);
  }

  const uniqueTuples = [
    ...new Map(
      tuples.map((tuple) => [buildVariantTupleKey(tuple), tuple]),
    ).values(),
  ];
  if (!uniqueTuples.length) return new Map();

  const variants = await prisma.categoryVariant.findMany({
    where: {
      OR: uniqueTuples,
      category: { deletedAt: null },
      version: { deletedAt: null },
      color: { deletedAt: null },
    },
    select: {
      id: true,
      categoryId: true,
      versionId: true,
      colorId: true,
    },
  });
  const variantIdByTupleKey = new Map(
    variants.map((variant) => [buildVariantTupleKey(variant), variant.id]),
  );

  const variantIdByItemId = new Map();
  for (const [itemId, tuple] of tupleByItemId.entries()) {
    const variantId = variantIdByTupleKey.get(buildVariantTupleKey(tuple));
    if (variantId) {
      variantIdByItemId.set(itemId, variantId);
    }
  }

  return variantIdByItemId;
}

async function syncWarehouseCategoryLinks({ warehouseId, categoryIds }) {
  const nextVariantRows = await getActiveVariantRowsByCategoryIds(categoryIds);
  const nextVariantIdSet = new Set(nextVariantRows.map((item) => item.id));

  const currentRows = await prisma.categoryWarehouseStock.findMany({
    where: { warehouseId },
    select: {
      variantId: true,
      quantity: true,
      variant: {
        select: {
          categoryId: true,
        },
      },
    },
  });

  const toAdd = nextVariantRows.filter(
    (item) => !currentRows.some((row) => row.variantId === item.id),
  );

  const toRemove = currentRows.filter(
    (row) => !nextVariantIdSet.has(row.variantId),
  );

  if (toRemove.some((row) => row.quantity > 0)) {
    throwBadRequest(
      "Không thể bỏ liên kết category variant đang còn tồn kho",
      "WAREHOUSE_CATEGORY_HAS_STOCK",
    );
  }

  await prisma.$transaction(async (tx) => {
    if (toRemove.length) {
      await tx.categoryWarehouseStock.deleteMany({
        where: {
          warehouseId,
          variantId: { in: toRemove.map((row) => row.variantId) },
        },
      });
    }

    if (toAdd.length) {
      await tx.categoryWarehouseStock.createMany({
        data: toAdd.map((row) => ({
          warehouseId,
          variantId: row.id,
          quantity: 0,
        })),
        skipDuplicates: true,
      });
    }
  });
}

export async function listWarehouses({ actor }) {
  const unitId = getActorUnitId(actor);
  await ensureDefaultWarehouses({ unitId });

  const warehouses = await prisma.warehouse.findMany({
    where: {
      unitId,
      deletedAt: null,
    },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      id: true,
      unitId: true,
      name: true,
      isSystemDefault: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      _count: {
        select: { categoryWarehouseStocks: true },
      },
      categoryWarehouseStocks: {
        select: {
          variant: {
            select: { categoryId: true },
          },
        },
      },
    },
  });

  return {
    warehouses: warehouses.map(mapWarehouse),
  };
}

export async function createWarehouse({ actor, body }) {
  const unitId = getActorUnitId(actor);
  await ensureDefaultWarehouses({ unitId });

  const name = normalizeName(body?.name);
  if (!name) {
    throwBadRequest("Tên kho là bắt buộc", "WAREHOUSE_NAME_REQUIRED");
  }

  const nameNormalized = normalizeForCompare(name);
  await ensureWarehouseNameUnique({ unitId, nameNormalized });
  const hasCategoryIdsPayload = Array.isArray(body?.categoryIds);
  const categoryIds = hasCategoryIdsPayload ? normalizeCategoryIds(body?.categoryIds) : [];
  if (hasCategoryIdsPayload) {
    await validateCategoryIds(categoryIds);
  }

  const maxSortOrder = await prisma.warehouse.aggregate({
    where: {
      unitId,
      deletedAt: null,
    },
    _max: {
      sortOrder: true,
    },
  });

  const warehouse = await prisma.$transaction(async (tx) => {
    const created = await tx.warehouse.create({
      data: {
        unitId,
        name,
        nameNormalized,
        isSystemDefault: false,
        sortOrder: (maxSortOrder._max.sortOrder || 0) + 1,
      },
      select: {
        id: true,
      },
    });

    if (categoryIds.length) {
      const variantRows = await getActiveVariantRowsByCategoryIds(categoryIds);
      if (variantRows.length) {
        await tx.categoryWarehouseStock.createMany({
          data: variantRows.map((row) => ({
            warehouseId: created.id,
            variantId: row.id,
            quantity: 0,
          })),
          skipDuplicates: true,
        });
      }
    }

    return tx.warehouse.findUnique({
      where: { id: created.id },
      select: {
        id: true,
        unitId: true,
        name: true,
        isSystemDefault: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        _count: {
          select: { categoryWarehouseStocks: true },
        },
        categoryWarehouseStocks: {
          select: {
            variant: {
              select: { categoryId: true },
            },
          },
        },
      },
    });
  });

  return { warehouse: mapWarehouse(warehouse) };
}

export async function updateWarehouse({ actor, warehouseId, body }) {
  const unitId = getActorUnitId(actor);
  await ensureDefaultWarehouses({ unitId });

  const id = Number.parseInt(warehouseId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throwBadRequest("warehouseId không hợp lệ", "INVALID_WAREHOUSE_ID");
  }

  await ensureWarehouseInUnit({ unitId, warehouseId: id });

  const name = normalizeName(body?.name);
  if (!name) {
    throwBadRequest("Tên kho là bắt buộc", "WAREHOUSE_NAME_REQUIRED");
  }

  const nameNormalized = normalizeForCompare(name);
  await ensureWarehouseNameUnique({ unitId, nameNormalized, excludeId: id });
  const hasCategoryIdsPayload = Array.isArray(body?.categoryIds);
  const categoryIds = hasCategoryIdsPayload ? normalizeCategoryIds(body?.categoryIds) : [];
  if (hasCategoryIdsPayload) {
    await validateCategoryIds(categoryIds);
  }

  await prisma.warehouse.update({
    where: { id },
    data: {
      name,
      nameNormalized,
    },
  });
  if (hasCategoryIdsPayload) {
    await syncWarehouseCategoryLinks({
      warehouseId: id,
      categoryIds,
    });
  }

  const warehouse = await prisma.warehouse.findUnique({
    where: { id },
    select: {
      id: true,
      unitId: true,
      name: true,
      isSystemDefault: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      _count: {
        select: { categoryWarehouseStocks: true },
      },
      categoryWarehouseStocks: {
        select: {
          variant: {
            select: { categoryId: true },
          },
        },
      },
    },
  });

  return { warehouse: mapWarehouse(warehouse) };
}

export async function deleteWarehouse({ actor, warehouseId }) {
  const unitId = getActorUnitId(actor);
  await ensureDefaultWarehouses({ unitId });

  const id = Number.parseInt(warehouseId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throwBadRequest("warehouseId không hợp lệ", "INVALID_WAREHOUSE_ID");
  }

  const warehouse = await prisma.warehouse.findFirst({
    where: {
      id,
      unitId,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });

  if (!warehouse) {
    throwNotFound("Kho không tồn tại trong đơn vị", "WAREHOUSE_NOT_FOUND");
  }

  const categoryStock = await prisma.categoryWarehouseStock.findFirst({
    where: {
      warehouseId: id,
      quantity: {
        gt: 0,
      },
    },
    select: {
      warehouseId: true,
    },
  });

  if (categoryStock) {
    throwBadRequest(
      "Không thể xoá kho khi vẫn còn tồn kho lớn hơn 0",
      "WAREHOUSE_HAS_STOCK",
    );
  }

  await prisma.warehouse.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return { id };
}

async function ensureWarehouseInUnit({ unitId, warehouseId }) {
  const warehouse = await prisma.warehouse.findFirst({
    where: {
      id: warehouseId,
      unitId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!warehouse) {
    throwNotFound("Kho không tồn tại trong đơn vị", "WAREHOUSE_NOT_FOUND");
  }

  return warehouse;
}

export async function listWarehouseItems({ actor, warehouseId, search, page, limit }) {
  const unitId = getActorUnitId(actor);
  await ensureDefaultWarehouses({ unitId });

  const id = Number.parseInt(warehouseId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throwBadRequest("warehouseId không hợp lệ", "INVALID_WAREHOUSE_ID");
  }

  const warehouse = await ensureWarehouseInUnit({ unitId, warehouseId: id });
  const currentPage = Number.parseInt(page, 10) > 0 ? Number.parseInt(page, 10) : 1;
  const pageSize = Math.min(Number.parseInt(limit, 10) > 0 ? Number.parseInt(limit, 10) : 20, 100);

  const linkedCategoryRows = await prisma.categoryWarehouseStock.findMany({
    where: { warehouseId: id },
    select: {
      variant: {
        select: {
          categoryId: true,
        },
      },
    },
  });
  const linkedCategoryIds = [
    ...new Set(
      linkedCategoryRows
        .map((row) => row.variant?.categoryId)
        .filter((categoryId) => Number.isInteger(categoryId)),
    ),
  ];

  if (!linkedCategoryIds.length) {
    return {
      warehouse,
      items: [],
      pagination: {
        page: currentPage,
        limit: pageSize,
        total: 0,
        totalPages: 1,
      },
    };
  }

  const itemWhere = {
    deletedAt: null,
    categoryId: { in: linkedCategoryIds },
  };
  if (search) {
    itemWhere.nameNormalized = {
      contains: normalizeForCompare(search),
    };
  }

  const [total, items] = await Promise.all([
    prisma.supplyItem.count({ where: itemWhere }),
    prisma.supplyItem.findMany({
      where: itemWhere,
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        code: true,
        categoryId: true,
        versionId: true,
        colorId: true,
        category: {
          select: {
            id: true,
            name: true,
            versionId: true,
            colorId: true,
          },
        },
        unitOfMeasure: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
  ]);

  const variantIdByItemId = await mapItemRowsToVariantIdMap(items);
  const variantIds = [...new Set(Array.from(variantIdByItemId.values()))];
  const stockRows = variantIds.length
    ? await prisma.categoryWarehouseStock.findMany({
        where: {
          warehouseId: id,
          variantId: { in: variantIds },
        },
        select: {
          variantId: true,
          quantity: true,
          updatedAt: true,
        },
      })
    : [];
  const stockByVariantId = new Map(
    stockRows.map((stock) => [stock.variantId, stock]),
  );

  return {
    warehouse,
    items: items.map((item) => {
      const variantId = variantIdByItemId.get(item.id);
      const stock = variantId ? stockByVariantId.get(variantId) : null;
      return {
        warehouse: {
          id: warehouse.id,
          name: warehouse.name,
        },
        item: {
          id: item.id,
          name: item.name,
          code: item.code,
          category: item.category
            ? {
                id: item.category.id,
                name: item.category.name,
              }
            : null,
          unitOfMeasure: item.unitOfMeasure,
        },
        quantity: stock?.quantity ?? 0,
        updatedAt: stock?.updatedAt ?? null,
      };
    }),
    pagination: {
      page: currentPage,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 1,
    },
  };
}

export async function addWarehouseItems({ actor, warehouseId, body }) {
  const unitId = getActorUnitId(actor);
  await ensureDefaultWarehouses({ unitId });

  const id = Number.parseInt(warehouseId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throwBadRequest("warehouseId không hợp lệ", "INVALID_WAREHOUSE_ID");
  }

  await ensureWarehouseInUnit({ unitId, warehouseId: id });

  const itemIdsRaw = Array.isArray(body?.itemIds) ? body.itemIds : [];
  const itemIds = [...new Set(itemIdsRaw.map((itemId) => Number.parseInt(itemId, 10)).filter((itemId) => Number.isInteger(itemId) && itemId > 0))];
  if (!itemIds.length) {
    throwBadRequest("itemIds là bắt buộc", "ITEM_IDS_REQUIRED");
  }

  const existingItems = await prisma.supplyItem.findMany({
    where: {
      id: {
        in: itemIds,
      },
      deletedAt: null,
    },
    select: {
      id: true,
      categoryId: true,
    },
  });
  const existingItemIds = new Set(existingItems.map((item) => item.id));
  const invalidItemId = itemIds.find((itemId) => !existingItemIds.has(itemId));
  if (invalidItemId) {
    throwBadRequest(`Mặt hàng không tồn tại: ${invalidItemId}`, "ITEM_NOT_FOUND");
  }

  const categoryIds = [
    ...new Set(existingItems.map((item) => item.categoryId)),
  ];
  const variantRows = await getActiveVariantRowsByCategoryIds(categoryIds);
  if (variantRows.length) {
    await prisma.categoryWarehouseStock.createMany({
      data: variantRows.map((row) => ({
        warehouseId: id,
        variantId: row.id,
        quantity: 0,
      })),
      skipDuplicates: true,
    });
  }

  return {
    warehouseId: id,
    addedItemIds: itemIds,
  };
}

export async function removeWarehouseItem({ actor, warehouseId, itemId }) {
  const unitId = getActorUnitId(actor);
  await ensureDefaultWarehouses({ unitId });

  const parsedWarehouseId = Number.parseInt(warehouseId, 10);
  const parsedItemId = Number.parseInt(itemId, 10);
  if (!Number.isInteger(parsedWarehouseId) || parsedWarehouseId <= 0) {
    throwBadRequest("warehouseId không hợp lệ", "INVALID_WAREHOUSE_ID");
  }
  if (!Number.isInteger(parsedItemId) || parsedItemId <= 0) {
    throwBadRequest("itemId không hợp lệ", "INVALID_ITEM_ID");
  }

  await ensureWarehouseInUnit({ unitId, warehouseId: parsedWarehouseId });

  const item = await prisma.supplyItem.findFirst({
    where: {
      id: parsedItemId,
      deletedAt: null,
    },
    select: {
      id: true,
      categoryId: true,
    },
  });

  if (!item) {
    throwNotFound("Mặt hàng không tồn tại", "ITEM_NOT_FOUND");
  }

  const variantRows = await getActiveVariantRowsByCategoryIds([item.categoryId]);
  if (!variantRows.length) {
    throwNotFound("Mặt hàng chưa được gán vào kho", "WAREHOUSE_ITEM_NOT_FOUND");
  }

  const variantIds = variantRows.map((variant) => variant.id);
  const existingLinks = await prisma.categoryWarehouseStock.findMany({
    where: {
      warehouseId: parsedWarehouseId,
      variantId: {
        in: variantIds,
      },
    },
    select: {
      variantId: true,
      quantity: true,
    },
  });

  if (!existingLinks.length) {
    throwNotFound("Mặt hàng chưa được gán vào kho", "WAREHOUSE_ITEM_NOT_FOUND");
  }

  if (existingLinks.some((stock) => Number(stock.quantity || 0) > 0)) {
    throwBadRequest(
      "Không thể gỡ mặt hàng khỏi kho khi tồn kho vẫn lớn hơn 0",
      "WAREHOUSE_ITEM_HAS_STOCK",
    );
  }

  await prisma.categoryWarehouseStock.deleteMany({
    where: {
      warehouseId: parsedWarehouseId,
      variantId: {
        in: variantIds,
      },
    },
  });

  return {
    warehouseId: parsedWarehouseId,
    itemId: parsedItemId,
  };
}
