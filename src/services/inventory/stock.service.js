import { prisma } from "#configs/prisma.config.js";
import { ensureDefaultWarehouses } from "#services/inventory/warehouse.service.js";
import {
  getActorUnitId,
  normalizeForCompare,
  parsePositiveInt,
  throwBadRequest,
  throwNotFound,
} from "#services/inventory/common.js";

function mapLog(log) {
  return {
    id: log.id,
    createdAt: log.createdAt,
    note: log.note,
    delta: log.delta,
    quantityBefore: log.quantityBefore,
    quantityAfter: log.quantityAfter,
    createdBy: log.createdBy
      ? {
          id: log.createdBy.id,
          username: log.createdBy.username,
          email: log.createdBy.email,
        }
      : null,
    warehouse: {
      id: log.warehouse.id,
      name: log.warehouse.name,
    },
    item: {
      id: log.item.id,
      name: log.item.name,
      code: log.item.code,
      unitOfMeasure: log.item.unitOfMeasure
        ? {
            id: log.item.unitOfMeasure.id,
            name: log.item.unitOfMeasure.name,
          }
        : null,
    },
  };
}

function buildVariantTupleKey({ categoryId, versionId, colorId }) {
  return `${categoryId}-${versionId}-${colorId}`;
}

async function resolveItemVariantsByIds({ itemIds, db = prisma }) {
  if (!itemIds.length) {
    return {
      itemById: new Map(),
      variantIdByItemId: new Map(),
    };
  }

  const items = await db.supplyItem.findMany({
    where: {
      id: { in: itemIds },
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      code: true,
      categoryId: true,
      versionId: true,
      colorId: true,
      unitOfMeasure: {
        select: {
          id: true,
          name: true,
        },
      },
      category: {
        select: {
          id: true,
          name: true,
          versionId: true,
          colorId: true,
        },
      },
    },
  });

  const tuples = [];
  const tupleByItemId = new Map();
  for (const item of items) {
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

  const variants = uniqueTuples.length
    ? await db.categoryVariant.findMany({
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
      })
    : [];

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

  return {
    itemById: new Map(items.map((item) => [item.id, item])),
    variantIdByItemId,
  };
}

async function applySingleAdjustment({ tx, actor, warehouseId, itemId, variantId, delta, note }) {
  const current = await tx.categoryWarehouseStock.findUnique({
    where: {
      warehouseId_variantId: {
        warehouseId,
        variantId,
      },
    },
    select: {
      quantity: true,
    },
  });

  if (!current) {
    throwBadRequest(
      "Mặt hàng chưa được gán vào kho. Hãy thêm mặt hàng vào kho trước khi điều chỉnh.",
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

  const updatedStock = await tx.categoryWarehouseStock.update({
    where: {
      warehouseId_variantId: {
        warehouseId,
        variantId,
      },
    },
    data: {
      quantity: nextQuantity,
    },
  });

  const log = await tx.stockAdjustmentLog.create({
    data: {
      warehouseId,
      itemId,
      quantityBefore: current.quantity,
      delta,
      quantityAfter: nextQuantity,
      note,
      createdById: actor?.id || null,
    },
    include: {
      warehouse: {
        select: { id: true, name: true },
      },
      item: {
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
      createdBy: {
        select: {
          id: true,
          username: true,
          email: true,
        },
      },
    },
  });

  return {
    quantity: updatedStock.quantity,
    updatedAt: updatedStock.updatedAt,
    log: mapLog(log),
  };
}

export async function listStocks({ actor, warehouseId, search, page, limit }) {
  const unitId = getActorUnitId(actor);
  await ensureDefaultWarehouses({ unitId });

  const currentPage = parsePositiveInt(page, 1);
  const pageSize = Math.min(parsePositiveInt(limit, 20), 100);
  const where = {
    warehouse: {
      unitId,
      deletedAt: null,
    },
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

  if (warehouseId !== undefined) {
    const parsedWarehouseId = Number.parseInt(warehouseId, 10);
    if (!Number.isInteger(parsedWarehouseId) || parsedWarehouseId <= 0) {
      throwBadRequest("warehouseId không hợp lệ", "INVALID_WAREHOUSE_ID");
    }
    where.warehouseId = parsedWarehouseId;
  }

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

  const [total, relations] = await Promise.all([
    prisma.categoryWarehouseStock.count({ where }),
    prisma.categoryWarehouseStock.findMany({
      where,
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
      orderBy: [
        { warehouse: { sortOrder: "asc" } },
        { variant: { category: { name: "asc" } } },
        { variant: { version: { name: "asc" } } },
        { variant: { color: { name: "asc" } } },
      ],
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
                versionId: true,
                colorId: true,
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

  const variantTuples = [
    ...new Map(
      relations.map((entry) => {
        const tuple = {
          categoryId: entry.variant.categoryId,
          versionId: entry.variant.versionId,
          colorId: entry.variant.colorId,
        };
        return [buildVariantTupleKey(tuple), tuple];
      }),
    ).values(),
  ];
  const relatedItems = variantTuples.length
    ? await prisma.supplyItem.findMany({
        where: {
          deletedAt: null,
          OR: variantTuples,
        },
        orderBy: [{ id: "asc" }],
        select: {
          id: true,
          name: true,
          code: true,
          categoryId: true,
          versionId: true,
          colorId: true,
          unitOfMeasure: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })
    : [];
  const itemByVariantTupleKey = new Map();
  for (const item of relatedItems) {
    if (!item.versionId || !item.colorId) continue;
    const key = buildVariantTupleKey({
      categoryId: item.categoryId,
      versionId: item.versionId,
      colorId: item.colorId,
    });
    if (!itemByVariantTupleKey.has(key)) {
      itemByVariantTupleKey.set(key, item);
    }
  }

  return {
    stocks: relations.map((entry) => {
      const key = buildVariantTupleKey({
        categoryId: entry.variant.categoryId,
        versionId: entry.variant.versionId,
        colorId: entry.variant.colorId,
      });
      const mappedItem = itemByVariantTupleKey.get(key);
      const itemName = mappedItem?.name || `${entry.variant.category.name} - ${entry.variant.version.name} - ${entry.variant.color.name}`;

      return {
        warehouse: entry.warehouse,
        item: {
          id: mappedItem?.id || null,
          name: itemName,
          code: mappedItem?.code || entry.variant.category.code || null,
          category: {
            id: entry.variant.category.id,
            name: entry.variant.category.name,
          },
          unitOfMeasure: mappedItem?.unitOfMeasure || entry.variant.category.unitOfMeasure || null,
        },
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

async function assertWarehouseItemLinked({ warehouseId, variantId, db = prisma }) {
  const relation = await db.categoryWarehouseStock.findUnique({
    where: {
      warehouseId_variantId: {
        warehouseId,
        variantId,
      },
    },
    select: {
      warehouseId: true,
      variantId: true,
    },
  });

  if (!relation) {
    throwBadRequest(
      "Mặt hàng chưa được gán vào kho. Hãy thêm mặt hàng vào kho trước khi điều chỉnh.",
      "WAREHOUSE_ITEM_NOT_LINKED",
    );
  }
}

export async function adjustStock({ actor, body }) {
  const unitId = getActorUnitId(actor);
  await ensureDefaultWarehouses({ unitId });

  const warehouseId = Number.parseInt(body?.warehouseId, 10);
  const itemId = Number.parseInt(body?.itemId, 10);
  const delta = Number.parseInt(body?.delta, 10);
  const note = String(body?.note || "").trim() || null;

  if (!Number.isInteger(warehouseId) || warehouseId <= 0) {
    throwBadRequest("warehouseId không hợp lệ", "INVALID_WAREHOUSE_ID");
  }

  if (!Number.isInteger(itemId) || itemId <= 0) {
    throwBadRequest("itemId không hợp lệ", "INVALID_ITEM_ID");
  }

  if (!Number.isInteger(delta) || delta === 0) {
    throwBadRequest("delta phải là số nguyên khác 0", "INVALID_STOCK_DELTA");
  }

  const [warehouse, resolved] = await Promise.all([
    prisma.warehouse.findFirst({
      where: {
        id: warehouseId,
        unitId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
      },
    }),
    resolveItemVariantsByIds({ itemIds: [itemId] }),
  ]);

  if (!warehouse) {
    throwNotFound("Kho không tồn tại", "WAREHOUSE_NOT_FOUND");
  }

  const item = resolved.itemById.get(itemId);
  if (!item) {
    throwNotFound("Mặt hàng không tồn tại", "ITEM_NOT_FOUND");
  }
  const variantId = resolved.variantIdByItemId.get(itemId);
  if (!variantId) {
    throwBadRequest(
      "Mặt hàng chưa có category variant hợp lệ để quản lý tồn kho",
      "ITEM_VARIANT_NOT_FOUND",
    );
  }

  await assertWarehouseItemLinked({ warehouseId, variantId });

  const adjusted = await prisma.$transaction(async (tx) => {
    const result = await applySingleAdjustment({
      tx,
      actor,
      warehouseId,
      itemId,
      variantId,
      delta,
      note,
    });

    return {
      stock: {
        warehouse,
        item,
        quantity: result.quantity,
        updatedAt: result.updatedAt,
      },
      log: result.log,
    };
  });

  return adjusted;
}

export async function adjustStockBatch({ actor, body }) {
  const unitId = getActorUnitId(actor);
  await ensureDefaultWarehouses({ unitId });

  const adjustments = Array.isArray(body?.adjustments) ? body.adjustments : [];
  if (!adjustments.length) {
    throwBadRequest("adjustments là bắt buộc", "ADJUSTMENTS_REQUIRED");
  }

  const parsedAdjustments = adjustments.map((adjustment, index) => {
    const warehouseId = Number.parseInt(adjustment?.warehouseId, 10);
    const itemId = Number.parseInt(adjustment?.itemId, 10);
    const delta = Number.parseInt(adjustment?.delta, 10);
    const note = String(adjustment?.note || "").trim() || null;

    if (!Number.isInteger(warehouseId) || warehouseId <= 0) {
      throwBadRequest(
        `warehouseId không hợp lệ tại adjustments[${index}]`,
        "INVALID_WAREHOUSE_ID",
      );
    }
    if (!Number.isInteger(itemId) || itemId <= 0) {
      throwBadRequest(
        `itemId không hợp lệ tại adjustments[${index}]`,
        "INVALID_ITEM_ID",
      );
    }
    if (!Number.isInteger(delta) || delta === 0) {
      throwBadRequest(
        `delta không hợp lệ tại adjustments[${index}]`,
        "INVALID_STOCK_DELTA",
      );
    }

    return { warehouseId, itemId, delta, note };
  });

  const warehouseIds = [...new Set(parsedAdjustments.map((item) => item.warehouseId))];
  const itemIds = [...new Set(parsedAdjustments.map((item) => item.itemId))];

  const [warehouses, resolved] = await Promise.all([
    prisma.warehouse.findMany({
      where: {
        id: { in: warehouseIds },
        unitId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
      },
    }),
    resolveItemVariantsByIds({ itemIds }),
  ]);

  const warehouseMap = new Map(warehouses.map((item) => [item.id, item]));
  const itemMap = resolved.itemById;
  const variantIdByItemId = resolved.variantIdByItemId;

  const successes = [];
  const failures = [];

  for (const adjustment of parsedAdjustments) {
    const warehouse = warehouseMap.get(adjustment.warehouseId);
    const item = itemMap.get(adjustment.itemId);

    if (!warehouse) {
      failures.push({
        ...adjustment,
        reason: "Kho không tồn tại trong đơn vị",
      });
      continue;
    }

    if (!item) {
      failures.push({
        ...adjustment,
        reason: "Mặt hàng không tồn tại",
      });
      continue;
    }
    const variantId = variantIdByItemId.get(adjustment.itemId);
    if (!variantId) {
      failures.push({
        ...adjustment,
        reason: "Mặt hàng chưa có category variant hợp lệ",
      });
      continue;
    }

    try {
      await assertWarehouseItemLinked({
        warehouseId: adjustment.warehouseId,
        variantId,
      });

      const result = await prisma.$transaction((tx) =>
        applySingleAdjustment({
          tx,
          actor,
          warehouseId: adjustment.warehouseId,
          itemId: adjustment.itemId,
          variantId,
          delta: adjustment.delta,
          note: adjustment.note,
        }),
      );

      successes.push({
        stock: {
          warehouse,
          item,
          quantity: result.quantity,
          updatedAt: result.updatedAt,
        },
        log: result.log,
      });
    } catch (error) {
      failures.push({
        ...adjustment,
        reason: error?.message || "Điều chỉnh thất bại",
      });
    }
  }

  return {
    total: parsedAdjustments.length,
    succeeded: successes.length,
    failed: failures.length,
    results: successes,
    failures,
  };
}

export async function transferStock({ actor, body }) {
  const unitId = getActorUnitId(actor);
  await ensureDefaultWarehouses({ unitId });

  const fromWarehouseId = Number.parseInt(body?.fromWarehouseId, 10);
  const toWarehouseId = Number.parseInt(body?.toWarehouseId, 10);
  const itemId = Number.parseInt(body?.itemId, 10);
  const quantity = Number.parseInt(body?.quantity, 10);
  const note = String(body?.note || "").trim();

  if (!Number.isInteger(fromWarehouseId) || fromWarehouseId <= 0) {
    throwBadRequest("fromWarehouseId không hợp lệ", "INVALID_FROM_WAREHOUSE_ID");
  }
  if (!Number.isInteger(toWarehouseId) || toWarehouseId <= 0) {
    throwBadRequest("toWarehouseId không hợp lệ", "INVALID_TO_WAREHOUSE_ID");
  }
  if (fromWarehouseId === toWarehouseId) {
    throwBadRequest("Kho nguồn và kho đích phải khác nhau", "WAREHOUSE_TRANSFER_SAME");
  }
  if (!Number.isInteger(itemId) || itemId <= 0) {
    throwBadRequest("itemId không hợp lệ", "INVALID_ITEM_ID");
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throwBadRequest("quantity phải là số nguyên dương", "INVALID_TRANSFER_QUANTITY");
  }

  const [warehouses, resolved] = await Promise.all([
    prisma.warehouse.findMany({
      where: {
        id: {
          in: [fromWarehouseId, toWarehouseId],
        },
        unitId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
      },
    }),
    resolveItemVariantsByIds({ itemIds: [itemId] }),
  ]);

  const warehouseMap = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
  const fromWarehouse = warehouseMap.get(fromWarehouseId);
  const toWarehouse = warehouseMap.get(toWarehouseId);

  if (!fromWarehouse) {
    throwNotFound("Kho nguồn không tồn tại trong đơn vị", "FROM_WAREHOUSE_NOT_FOUND");
  }
  if (!toWarehouse) {
    throwNotFound("Kho đích không tồn tại trong đơn vị", "TO_WAREHOUSE_NOT_FOUND");
  }
  const item = resolved.itemById.get(itemId);
  if (!item) {
    throwNotFound("Mặt hàng không tồn tại", "ITEM_NOT_FOUND");
  }
  const variantId = resolved.variantIdByItemId.get(itemId);
  if (!variantId) {
    throwBadRequest(
      "Mặt hàng chưa có category variant hợp lệ để quản lý tồn kho",
      "ITEM_VARIANT_NOT_FOUND",
    );
  }

  const sourcePrefix = `Luân chuyển sang kho "${toWarehouse.name}"`;
  const targetPrefix = `Luân chuyển từ kho "${fromWarehouse.name}"`;
  const sourceNote = note ? `${sourcePrefix}. ${note}` : sourcePrefix;
  const targetNote = note ? `${targetPrefix}. ${note}` : targetPrefix;

  const result = await prisma.$transaction(async (tx) => {
    await assertWarehouseItemLinked({
      warehouseId: fromWarehouseId,
      variantId,
      db: tx,
    });

    await tx.categoryWarehouseStock.upsert({
      where: {
        warehouseId_variantId: {
          warehouseId: toWarehouseId,
          variantId,
        },
      },
      update: {},
      create: {
        warehouseId: toWarehouseId,
        variantId,
        quantity: 0,
      },
    });

    const source = await applySingleAdjustment({
      tx,
      actor,
      warehouseId: fromWarehouseId,
      itemId,
      variantId,
      delta: -quantity,
      note: sourceNote.slice(0, 191),
    });

    const target = await applySingleAdjustment({
      tx,
      actor,
      warehouseId: toWarehouseId,
      itemId,
      variantId,
      delta: quantity,
      note: targetNote.slice(0, 191),
    });

    return {
      from: {
        warehouse: fromWarehouse,
        item,
        quantity: source.quantity,
        updatedAt: source.updatedAt,
      },
      to: {
        warehouse: toWarehouse,
        item,
        quantity: target.quantity,
        updatedAt: target.updatedAt,
      },
      transfer: {
        quantity,
        note: note || null,
      },
      logs: {
        from: source.log,
        to: target.log,
      },
    };
  });

  return result;
}

export async function transferStockBatch({ actor, body }) {
  const unitId = getActorUnitId(actor);
  await ensureDefaultWarehouses({ unitId });

  const fromWarehouseId = Number.parseInt(body?.fromWarehouseId, 10);
  const toWarehouseId = Number.parseInt(body?.toWarehouseId, 10);
  const globalNote = String(body?.note || "").trim();
  const transfers = Array.isArray(body?.transfers) ? body.transfers : [];

  if (!Number.isInteger(fromWarehouseId) || fromWarehouseId <= 0) {
    throwBadRequest("fromWarehouseId không hợp lệ", "INVALID_FROM_WAREHOUSE_ID");
  }
  if (!Number.isInteger(toWarehouseId) || toWarehouseId <= 0) {
    throwBadRequest("toWarehouseId không hợp lệ", "INVALID_TO_WAREHOUSE_ID");
  }
  if (fromWarehouseId === toWarehouseId) {
    throwBadRequest("Kho nguồn và kho đích phải khác nhau", "WAREHOUSE_TRANSFER_SAME");
  }
  if (!transfers.length) {
    throwBadRequest("transfers là bắt buộc", "TRANSFER_ITEMS_REQUIRED");
  }

  const mergedMap = new Map();
  for (const transfer of transfers) {
    const itemId = Number.parseInt(transfer?.itemId, 10);
    const quantity = Number.parseInt(transfer?.quantity, 10);
    const note = String(transfer?.note || "").trim();

    if (!Number.isInteger(itemId) || itemId <= 0) {
      throwBadRequest("itemId không hợp lệ trong transfers", "INVALID_ITEM_ID");
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throwBadRequest("quantity không hợp lệ trong transfers", "INVALID_TRANSFER_QUANTITY");
    }

    if (!mergedMap.has(itemId)) {
      mergedMap.set(itemId, { itemId, quantity: 0, note: "" });
    }
    const current = mergedMap.get(itemId);
    current.quantity += quantity;
    if (note) {
      current.note = current.note ? `${current.note}; ${note}` : note;
    }
  }

  const normalizedTransfers = Array.from(mergedMap.values());
  const itemIds = normalizedTransfers.map((item) => item.itemId);

  const [warehouses, resolved] = await Promise.all([
    prisma.warehouse.findMany({
      where: {
        id: {
          in: [fromWarehouseId, toWarehouseId],
        },
        unitId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
      },
    }),
    resolveItemVariantsByIds({ itemIds }),
  ]);

  const warehouseMap = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
  const itemMap = resolved.itemById;
  const variantIdByItemId = resolved.variantIdByItemId;
  const fromWarehouse = warehouseMap.get(fromWarehouseId);
  const toWarehouse = warehouseMap.get(toWarehouseId);

  if (!fromWarehouse) {
    throwNotFound("Kho nguồn không tồn tại trong đơn vị", "FROM_WAREHOUSE_NOT_FOUND");
  }
  if (!toWarehouse) {
    throwNotFound("Kho đích không tồn tại trong đơn vị", "TO_WAREHOUSE_NOT_FOUND");
  }

  const missingItemId = itemIds.find((itemId) => !itemMap.has(itemId));
  if (missingItemId) {
    throwNotFound(`Mặt hàng không tồn tại: ${missingItemId}`, "ITEM_NOT_FOUND");
  }
  const missingVariantItemId = itemIds.find((id) => !variantIdByItemId.has(id));
  if (missingVariantItemId) {
    throwBadRequest(
      `Mặt hàng chưa có category variant hợp lệ: ${missingVariantItemId}`,
      "ITEM_VARIANT_NOT_FOUND",
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    for (const transfer of normalizedTransfers) {
      await assertWarehouseItemLinked({
        warehouseId: fromWarehouseId,
        variantId: variantIdByItemId.get(transfer.itemId),
        db: tx,
      });
    }

    for (const transfer of normalizedTransfers) {
      const variantId = variantIdByItemId.get(transfer.itemId);
      await tx.categoryWarehouseStock.upsert({
        where: {
          warehouseId_variantId: {
            warehouseId: toWarehouseId,
            variantId,
          },
        },
        update: {},
        create: {
          warehouseId: toWarehouseId,
          variantId,
          quantity: 0,
        },
      });
    }

    const results = [];
    for (const transfer of normalizedTransfers) {
      const item = itemMap.get(transfer.itemId);
      const variantId = variantIdByItemId.get(transfer.itemId);
      const itemNote = transfer.note || globalNote;
      const sourcePrefix = `Luân chuyển sang kho "${toWarehouse.name}"`;
      const targetPrefix = `Luân chuyển từ kho "${fromWarehouse.name}"`;
      const sourceNote = itemNote ? `${sourcePrefix}. ${itemNote}` : sourcePrefix;
      const targetNote = itemNote ? `${targetPrefix}. ${itemNote}` : targetPrefix;

      const source = await applySingleAdjustment({
        tx,
        actor,
        warehouseId: fromWarehouseId,
        itemId: transfer.itemId,
        variantId,
        delta: -transfer.quantity,
        note: sourceNote.slice(0, 191),
      });

      const target = await applySingleAdjustment({
        tx,
        actor,
        warehouseId: toWarehouseId,
        itemId: transfer.itemId,
        variantId,
        delta: transfer.quantity,
        note: targetNote.slice(0, 191),
      });

      results.push({
        item,
        quantity: transfer.quantity,
        from: {
          warehouse: fromWarehouse,
          quantity: source.quantity,
          updatedAt: source.updatedAt,
        },
        to: {
          warehouse: toWarehouse,
          quantity: target.quantity,
          updatedAt: target.updatedAt,
        },
        logs: {
          from: source.log,
          to: target.log,
        },
      });
    }

    return {
      fromWarehouse,
      toWarehouse,
      totalItems: results.length,
      totalQuantity: results.reduce((sum, item) => sum + item.quantity, 0),
      results,
    };
  });

  return result;
}

export async function listAdjustmentLogs({
  actor,
  warehouseId,
  itemId,
  page,
  limit,
}) {
  const unitId = getActorUnitId(actor);
  await ensureDefaultWarehouses({ unitId });

  const currentPage = parsePositiveInt(page, 1);
  const pageSize = Math.min(parsePositiveInt(limit, 20), 100);

  const where = {
    warehouse: {
      unitId,
      deletedAt: null,
    },
  };

  if (warehouseId !== undefined) {
    const parsedWarehouseId = Number.parseInt(warehouseId, 10);
    if (!Number.isInteger(parsedWarehouseId) || parsedWarehouseId <= 0) {
      throwBadRequest("warehouseId không hợp lệ", "INVALID_WAREHOUSE_ID");
    }
    where.warehouseId = parsedWarehouseId;
  }

  if (itemId !== undefined) {
    const parsedItemId = Number.parseInt(itemId, 10);
    if (!Number.isInteger(parsedItemId) || parsedItemId <= 0) {
      throwBadRequest("itemId không hợp lệ", "INVALID_ITEM_ID");
    }
    where.itemId = parsedItemId;
  }

  const [total, logs] = await Promise.all([
    prisma.stockAdjustmentLog.count({ where }),
    prisma.stockAdjustmentLog.findMany({
      where,
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        warehouse: {
          select: { id: true, name: true },
        },
        item: {
          select: { id: true, name: true, code: true },
        },
        createdBy: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    }),
  ]);

  return {
    logs: logs.map(mapLog),
    pagination: {
      page: currentPage,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 1,
    },
  };
}
