import { prisma } from "#configs/prisma.config.js";
import { ensureAnyRole } from "#utils/roleGuards.js";
import { ensureDefaultWarehouses } from "#services/inventory/warehouse.service.js";
import {
  getActorUnitId,
  normalizeForCompare,
  normalizeName,
  parsePositiveInt,
  throwBadRequest,
  throwConflict,
  throwNotFound,
} from "#services/inventory/common.js";

function ensureAdmin(actor) {
  ensureAnyRole(actor, ["ADMIN", "SUPER_ADMIN"]);
  return getActorUnitId(actor);
}

async function ensureWarehouseInUnit({ unitId, warehouseId, db = prisma }) {
  const warehouse = await db.warehouse.findFirst({
    where: {
      id: warehouseId,
      unitId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      unitId: true,
      isSystemDefault: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!warehouse) {
    throwNotFound("Kho không tồn tại trong đơn vị", "WAREHOUSE_NOT_FOUND");
  }

  return warehouse;
}

async function ensureWarehouseNameUnique({ unitId, nameNormalized, excludeId = null }) {
  const existed = await prisma.warehouse.findFirst({
    where: {
      unitId,
      nameNormalized,
    },
    select: {
      id: true,
      deletedAt: true,
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
  return {
    id: warehouse.id,
    unitId: warehouse.unitId,
    name: warehouse.name,
    isSystemDefault: warehouse.isSystemDefault,
    sortOrder: warehouse.sortOrder,
    createdAt: warehouse.createdAt,
    updatedAt: warehouse.updatedAt,
    deletedAt: warehouse.deletedAt,
    itemCount: warehouse._count?.categoryWarehouseStocks || 0,
  };
}

function isNoneVariantName(value) {
  return typeof value === "string" && value.trim().toLowerCase() === "none";
}

function buildCategoryVariantDisplayName({ categoryName, versionName, colorName }) {
  const parts = [categoryName];
  if (versionName && !isNoneVariantName(versionName)) {
    parts.push(versionName);
  }
  if (colorName && !isNoneVariantName(colorName)) {
    parts.push(colorName);
  }
  return parts.join(" - ");
}

async function ensureEntryValid({ categoryId, versionId, colorId, db = prisma }) {
  const variant = await db.categoryVariant.findFirst({
    where: {
      categoryId,
      versionId,
      colorId,
      category: { deletedAt: null },
      version: { deletedAt: null },
      color: { deletedAt: null },
    },
    select: {
      id: true,
      categoryId: true,
      versionId: true,
      colorId: true,
      category: {
        select: {
          id: true,
          name: true,
          code: true,
          unitOfMeasure: {
            select: {
              id: true,
              name: true,
            },
          },
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
    },
  });

  if (!variant) {
    throwBadRequest(
      "Tổ hợp mặt hàng-version-color chưa được khai báo hoặc đã bị xoá",
      "CATEGORY_VARIANT_NOT_FOUND",
    );
  }

  return variant;
}

export async function listCategoryWarehouses({ actor }) {
  const unitId = ensureAdmin(actor);
  await ensureDefaultWarehouses({ unitId });

  const warehouses = await prisma.warehouse.findMany({
    where: {
      unitId,
      deletedAt: null,
    },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: {
      _count: {
        select: { categoryWarehouseStocks: true },
      },
    },
  });

  return {
    warehouses: warehouses.map(mapWarehouse),
  };
}

export async function createCategoryWarehouse({ actor, body }) {
  const unitId = ensureAdmin(actor);
  await ensureDefaultWarehouses({ unitId });

  const name = normalizeName(body?.name);
  if (!name) {
    throwBadRequest("Tên kho là bắt buộc", "WAREHOUSE_NAME_REQUIRED");
  }

  const nameNormalized = normalizeForCompare(name);
  await ensureWarehouseNameUnique({ unitId, nameNormalized });

  const maxSortOrder = await prisma.warehouse.aggregate({
    where: {
      unitId,
      deletedAt: null,
    },
    _max: {
      sortOrder: true,
    },
  });

  const warehouse = await prisma.warehouse.create({
    data: {
      unitId,
      name,
      nameNormalized,
      isSystemDefault: false,
      sortOrder: (maxSortOrder?._max?.sortOrder || 0) + 1,
    },
    include: {
      _count: {
        select: { categoryWarehouseStocks: true },
      },
    },
  });

  return {
    warehouse: mapWarehouse(warehouse),
  };
}

export async function updateCategoryWarehouse({ actor, warehouseId, body }) {
  const unitId = ensureAdmin(actor);
  await ensureDefaultWarehouses({ unitId });

  const parsedWarehouseId = Number.parseInt(warehouseId, 10);
  if (!Number.isInteger(parsedWarehouseId) || parsedWarehouseId <= 0) {
    throwBadRequest("warehouseId không hợp lệ", "INVALID_WAREHOUSE_ID");
  }

  const warehouse = await ensureWarehouseInUnit({
    unitId,
    warehouseId: parsedWarehouseId,
  });

  const name = normalizeName(body?.name);
  if (!name) {
    throwBadRequest("Tên kho là bắt buộc", "WAREHOUSE_NAME_REQUIRED");
  }

  const nameNormalized = normalizeForCompare(name);
  await ensureWarehouseNameUnique({
    unitId,
    nameNormalized,
    excludeId: parsedWarehouseId,
  });

  const updated = await prisma.warehouse.update({
    where: { id: parsedWarehouseId },
    data: {
      name,
      nameNormalized,
    },
    include: {
      _count: {
        select: { categoryWarehouseStocks: true },
      },
    },
  });

  return {
    warehouse: mapWarehouse({ ...updated, isSystemDefault: warehouse.isSystemDefault }),
  };
}

export async function deleteCategoryWarehouse({ actor, warehouseId }) {
  const unitId = ensureAdmin(actor);
  await ensureDefaultWarehouses({ unitId });

  const parsedWarehouseId = Number.parseInt(warehouseId, 10);
  if (!Number.isInteger(parsedWarehouseId) || parsedWarehouseId <= 0) {
    throwBadRequest("warehouseId không hợp lệ", "INVALID_WAREHOUSE_ID");
  }

  await ensureWarehouseInUnit({
    unitId,
    warehouseId: parsedWarehouseId,
  });

  const categoryStock = await prisma.categoryWarehouseStock.findFirst({
    where: {
      warehouseId: parsedWarehouseId,
      quantity: { gt: 0 },
    },
    select: { warehouseId: true },
  });

  if (categoryStock) {
    throwBadRequest(
      "Không thể xoá kho khi vẫn còn tồn kho lớn hơn 0",
      "WAREHOUSE_HAS_STOCK",
    );
  }

  await prisma.$transaction([
    prisma.warehouse.update({
      where: { id: parsedWarehouseId },
      data: { deletedAt: new Date() },
    }),
    prisma.categoryWarehouseStock.deleteMany({
      where: { warehouseId: parsedWarehouseId },
    }),
  ]);

  return {
    id: parsedWarehouseId,
  };
}

export async function listCategoryWarehouseItems({
  actor,
  warehouseId,
  search,
  page,
  limit,
}) {
  const unitId = ensureAdmin(actor);
  await ensureDefaultWarehouses({ unitId });

  const parsedWarehouseId = Number.parseInt(warehouseId, 10);
  if (!Number.isInteger(parsedWarehouseId) || parsedWarehouseId <= 0) {
    throwBadRequest("warehouseId không hợp lệ", "INVALID_WAREHOUSE_ID");
  }

  const warehouse = await ensureWarehouseInUnit({
    unitId,
    warehouseId: parsedWarehouseId,
  });

  const currentPage = parsePositiveInt(page, 1);
  const pageSize = Math.min(parsePositiveInt(limit, 20), 100);

  const where = {
    warehouseId: parsedWarehouseId,
    variant: {
      category: {
        deletedAt: null,
      },
      version: {
        deletedAt: null,
      },
      color: {
        deletedAt: null,
      },
    },
  };

  if (search) {
    const q = String(search || "").trim();
    const qNormalized = normalizeForCompare(q);
    where.OR = [
      { variant: { category: { nameNormalized: { contains: qNormalized } } } },
      { variant: { category: { code: { contains: q } } } },
      { variant: { version: { nameNormalized: { contains: qNormalized } } } },
      { variant: { version: { name: { contains: q } } } },
      { variant: { color: { nameNormalized: { contains: qNormalized } } } },
      {
        variant: {
          category: {
            sizes: {
              some: {
                deletedAt: null,
                size: {
                  deletedAt: null,
                  name: { contains: q },
                },
              },
            },
          },
        },
      },
    ];
  }

  const [total, entries] = await Promise.all([
    prisma.categoryWarehouseStock.count({ where }),
    prisma.categoryWarehouseStock.findMany({
      where,
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
      orderBy: [
        { variant: { category: { name: "asc" } } },
        { variant: { version: { name: "asc" } } },
        { variant: { color: { name: "asc" } } },
      ],
      include: {
        variant: {
          include: {
            category: {
              select: {
                id: true,
                name: true,
                code: true,
                unitOfMeasure: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
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
          },
        },
      },
    }),
  ]);

  return {
    warehouse,
    items: entries.map((entry) => {
      const category = entry.variant.category;
      const version = entry.variant.version;
      const color = entry.variant.color;
      const displayName = buildCategoryVariantDisplayName({
        categoryName: category?.name,
        versionName: version?.name,
        colorName: color?.name,
      });
      return {
        category: {
          ...category,
          name: displayName,
        },
        version,
        color,
        quantity: entry.quantity,
        updatedAt: entry.updatedAt,
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

export async function addCategoryWarehouseItems({ actor, warehouseId, body }) {
  const unitId = ensureAdmin(actor);
  await ensureDefaultWarehouses({ unitId });

  const parsedWarehouseId = Number.parseInt(warehouseId, 10);
  if (!Number.isInteger(parsedWarehouseId) || parsedWarehouseId <= 0) {
    throwBadRequest("warehouseId không hợp lệ", "INVALID_WAREHOUSE_ID");
  }

  await ensureWarehouseInUnit({
    unitId,
    warehouseId: parsedWarehouseId,
  });

  const rawEntries = Array.isArray(body?.entries) ? body.entries : [];
  if (!rawEntries.length) {
    throwBadRequest("entries là bắt buộc", "WAREHOUSE_ENTRIES_REQUIRED");
  }

  const entries = [
    ...new Map(
      rawEntries
        .map((entry) => ({
          categoryId: Number.parseInt(entry?.categoryId, 10),
          versionId: Number.parseInt(entry?.versionId, 10),
          colorId: Number.parseInt(entry?.colorId, 10),
        }))
        .filter(
          (entry) =>
            Number.isInteger(entry.categoryId) &&
            entry.categoryId > 0 &&
            Number.isInteger(entry.versionId) &&
            entry.versionId > 0 &&
            Number.isInteger(entry.colorId) &&
            entry.colorId > 0,
        )
        .map((entry) => [
          `${entry.categoryId}-${entry.versionId}-${entry.colorId}`,
          entry,
        ]),
    ).values(),
  ];

  if (!entries.length) {
    throwBadRequest("entries không hợp lệ", "INVALID_WAREHOUSE_ENTRIES");
  }

  const variants = await Promise.all(entries.map((entry) => ensureEntryValid(entry)));

  await prisma.categoryWarehouseStock.createMany({
    data: variants.map((variant) => ({
      warehouseId: parsedWarehouseId,
      variantId: variant.id,
      quantity: 0,
    })),
    skipDuplicates: true,
  });

  return {
    warehouseId: parsedWarehouseId,
    addedEntries: entries,
  };
}

export async function removeCategoryWarehouseItem({ actor, warehouseId, body }) {
  const unitId = ensureAdmin(actor);
  await ensureDefaultWarehouses({ unitId });

  const parsedWarehouseId = Number.parseInt(warehouseId, 10);
  const categoryId = Number.parseInt(body?.categoryId, 10);
  const versionId = Number.parseInt(body?.versionId, 10);
  const colorId = Number.parseInt(body?.colorId, 10);

  if (!Number.isInteger(parsedWarehouseId) || parsedWarehouseId <= 0) {
    throwBadRequest("warehouseId không hợp lệ", "INVALID_WAREHOUSE_ID");
  }
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    throwBadRequest("categoryId không hợp lệ", "INVALID_CATEGORY_ID");
  }
  if (!Number.isInteger(versionId) || versionId <= 0) {
    throwBadRequest("versionId không hợp lệ", "INVALID_VERSION_ID");
  }
  if (!Number.isInteger(colorId) || colorId <= 0) {
    throwBadRequest("colorId không hợp lệ", "INVALID_COLOR_ID");
  }

  await ensureWarehouseInUnit({
    unitId,
    warehouseId: parsedWarehouseId,
  });

  const variant = await ensureEntryValid({ categoryId, versionId, colorId });

  const stock = await prisma.categoryWarehouseStock.findUnique({
    where: {
      warehouseId_variantId: {
        warehouseId: parsedWarehouseId,
        variantId: variant.id,
      },
    },
    select: {
      quantity: true,
    },
  });

  if (!stock) {
    throwNotFound("Mặt hàng chưa được gán vào kho", "WAREHOUSE_ITEM_NOT_FOUND");
  }

  if ((stock?.quantity || 0) > 0) {
    throwBadRequest(
      "Không thể gỡ mặt hàng khỏi kho khi tồn kho vẫn lớn hơn 0",
      "WAREHOUSE_ITEM_HAS_STOCK",
    );
  }

  await prisma.categoryWarehouseStock.delete({
    where: {
      warehouseId_variantId: {
        warehouseId: parsedWarehouseId,
        variantId: variant.id,
      },
    },
  });

  return {
    warehouseId: parsedWarehouseId,
    categoryId,
    versionId,
    colorId,
  };
}

export async function adjustCategoryStock({ actor, body }) {
  const unitId = ensureAdmin(actor);
  await ensureDefaultWarehouses({ unitId });

  const warehouseId = Number.parseInt(body?.warehouseId, 10);
  const categoryId = Number.parseInt(body?.categoryId, 10);
  const versionId = Number.parseInt(body?.versionId, 10);
  const colorId = Number.parseInt(body?.colorId, 10);
  const delta = Number.parseInt(body?.delta, 10);

  if (!Number.isInteger(warehouseId) || warehouseId <= 0) {
    throwBadRequest("warehouseId không hợp lệ", "INVALID_WAREHOUSE_ID");
  }
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    throwBadRequest("categoryId không hợp lệ", "INVALID_CATEGORY_ID");
  }
  if (!Number.isInteger(versionId) || versionId <= 0) {
    throwBadRequest("versionId không hợp lệ", "INVALID_VERSION_ID");
  }
  if (!Number.isInteger(colorId) || colorId <= 0) {
    throwBadRequest("colorId không hợp lệ", "INVALID_COLOR_ID");
  }
  if (!Number.isInteger(delta) || delta === 0) {
    throwBadRequest("delta phải là số nguyên khác 0", "INVALID_STOCK_DELTA");
  }

  await ensureWarehouseInUnit({ unitId, warehouseId });
  const variant = await ensureEntryValid({ categoryId, versionId, colorId });

  const relation = await prisma.categoryWarehouseStock.findUnique({
    where: {
      warehouseId_variantId: {
        warehouseId,
        variantId: variant.id,
      },
    },
    select: {
      warehouseId: true,
    },
  });

  if (!relation) {
    throwBadRequest(
      "Mặt hàng chưa được gán vào kho. Hãy thêm vào kho trước khi điều chỉnh.",
      "WAREHOUSE_ITEM_NOT_LINKED",
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.categoryWarehouseStock.findUnique({
      where: {
        warehouseId_variantId: {
          warehouseId,
          variantId: variant.id,
        },
      },
      select: {
        quantity: true,
      },
    });

    if (!current) {
      throwBadRequest(
        "Mặt hàng chưa được gán vào kho. Hãy thêm vào kho trước khi điều chỉnh.",
        "WAREHOUSE_ITEM_NOT_LINKED",
      );
    }

    const nextQuantity = current.quantity + delta;
    if (nextQuantity < 0) {
      throwBadRequest(
        `Tồn kho không đủ để trừ. Tồn hiện tại: ${current.quantity}`,
        "INSUFFICIENT_STOCK",
      );
    }

    return tx.categoryWarehouseStock.update({
      where: {
        warehouseId_variantId: {
          warehouseId,
          variantId: variant.id,
        },
      },
      data: {
        quantity: nextQuantity,
      },
      include: {
        warehouse: {
          select: {
            id: true,
            name: true,
          },
        },
        variant: {
          include: {
            category: {
              select: {
                id: true,
                name: true,
                code: true,
                unitOfMeasure: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
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
          },
        },
      },
    });
  });

  return {
    stock: {
      warehouse: result.warehouse,
      category: result.variant.category,
      version: result.variant.version,
      color: result.variant.color,
      quantity: result.quantity,
      updatedAt: result.updatedAt,
    },
  };
}

export async function transferCategoryStock({ actor, body }) {
  const unitId = ensureAdmin(actor);
  await ensureDefaultWarehouses({ unitId });

  const fromWarehouseId = Number.parseInt(body?.fromWarehouseId, 10);
  const toWarehouseId = Number.parseInt(body?.toWarehouseId, 10);
  const categoryId = Number.parseInt(body?.categoryId, 10);
  const versionId = Number.parseInt(body?.versionId, 10);
  const colorId = Number.parseInt(body?.colorId, 10);
  const quantity = Number.parseInt(body?.quantity, 10);

  if (!Number.isInteger(fromWarehouseId) || fromWarehouseId <= 0) {
    throwBadRequest("fromWarehouseId không hợp lệ", "INVALID_FROM_WAREHOUSE_ID");
  }
  if (!Number.isInteger(toWarehouseId) || toWarehouseId <= 0) {
    throwBadRequest("toWarehouseId không hợp lệ", "INVALID_TO_WAREHOUSE_ID");
  }
  if (fromWarehouseId === toWarehouseId) {
    throwBadRequest("Kho nguồn và kho đích phải khác nhau", "WAREHOUSE_TRANSFER_SAME_SOURCE_TARGET");
  }
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    throwBadRequest("categoryId không hợp lệ", "INVALID_CATEGORY_ID");
  }
  if (!Number.isInteger(versionId) || versionId <= 0) {
    throwBadRequest("versionId không hợp lệ", "INVALID_VERSION_ID");
  }
  if (!Number.isInteger(colorId) || colorId <= 0) {
    throwBadRequest("colorId không hợp lệ", "INVALID_COLOR_ID");
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throwBadRequest("quantity không hợp lệ", "INVALID_TRANSFER_QUANTITY");
  }

  const [sourceWarehouse, targetWarehouse] = await Promise.all([
    ensureWarehouseInUnit({ unitId, warehouseId: fromWarehouseId }),
    ensureWarehouseInUnit({ unitId, warehouseId: toWarehouseId }),
  ]);
  const variant = await ensureEntryValid({ categoryId, versionId, colorId });

  const sourceRelation = await prisma.categoryWarehouseStock.findUnique({
    where: {
      warehouseId_variantId: {
        warehouseId: fromWarehouseId,
        variantId: variant.id,
      },
    },
    select: { warehouseId: true },
  });

  if (!sourceRelation) {
    throwBadRequest(
      "Mặt hàng chưa được gán vào kho nguồn",
      "SOURCE_WAREHOUSE_ITEM_NOT_LINKED",
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const decremented = await tx.categoryWarehouseStock.updateMany({
      where: {
        warehouseId: fromWarehouseId,
        variantId: variant.id,
        quantity: {
          gte: quantity,
        },
      },
      data: {
        quantity: {
          decrement: quantity,
        },
      },
    });

    if (decremented.count === 0) {
      const sourceStock = await tx.categoryWarehouseStock.findUnique({
        where: {
          warehouseId_variantId: {
            warehouseId: fromWarehouseId,
            variantId: variant.id,
          },
        },
        select: {
          quantity: true,
        },
      });
      throwBadRequest(
        `Tồn kho nguồn không đủ để chuyển. Tồn hiện tại: ${sourceStock?.quantity || 0}`,
        "INSUFFICIENT_SOURCE_STOCK",
      );
    }

    const [nextSource, nextTarget] = await Promise.all([
      tx.categoryWarehouseStock.findUnique({
        where: {
          warehouseId_variantId: {
            warehouseId: fromWarehouseId,
            variantId: variant.id,
          },
        },
        select: { quantity: true, updatedAt: true },
      }),
      tx.categoryWarehouseStock.upsert({
        where: {
          warehouseId_variantId: {
            warehouseId: toWarehouseId,
            variantId: variant.id,
          },
        },
        update: {
          quantity: {
            increment: quantity,
          },
        },
        create: {
          warehouseId: toWarehouseId,
          variantId: variant.id,
          quantity,
        },
        select: { quantity: true, updatedAt: true },
      }),
    ]);

    return { nextSource, nextTarget };
  });

  return {
    transfer: {
      fromWarehouse: { id: sourceWarehouse.id, name: sourceWarehouse.name },
      toWarehouse: { id: targetWarehouse.id, name: targetWarehouse.name },
      categoryId,
      versionId,
      colorId,
      quantity,
      sourceQuantityAfter: result.nextSource?.quantity || 0,
      targetQuantityAfter: result.nextTarget.quantity,
      movedAt: new Date().toISOString(),
    },
  };
}

export default {
  listCategoryWarehouses,
  createCategoryWarehouse,
  updateCategoryWarehouse,
  deleteCategoryWarehouse,
  listCategoryWarehouseItems,
  addCategoryWarehouseItems,
  removeCategoryWarehouseItem,
  adjustCategoryStock,
  transferCategoryStock,
};
