import { prisma } from "#configs/prisma.config.js";
import {
  DEFAULT_ALLOCATION_SUBJECTS,
  getActorUnitId,
  normalizeForCompare,
  parseUnitIdOrNull,
  throwForbidden,
} from "#services/inventory/common.js";
import { ensureAnyRole } from "#utils/roleGuards.js";
import {
  getItemImportTemplate,
  getItemImportTemplateFileName,
  importItemsByTemplate,
} from "#services/inventory/item-import.service.js";
import {
  createItem,
  deleteItem,
  listItems,
  restoreItem,
  updateItem,
} from "#services/inventory/item.service.js";
import {
  createUnitOfMeasure,
  deleteUnitOfMeasure,
  ensureDefaultUnitOfMeasures,
  listUnitOfMeasures,
} from "#services/inventory/unit-measure.service.js";
import {
  createColor,
  createVersion,
  deleteColor,
  deleteVersion,
  ensureDefaultVersionsAndColors,
  listColors,
  listVersions,
} from "#services/inventory/item-variant.service.js";
import {
  createAllocationIssueLog,
  createAllocationStandard,
  createAllocationSubject,
  deleteAllocationStandard,
  deleteAllocationSubject,
  ensureDefaultAllocationSubjects,
  getAllocationIssueVoucherById,
  getAllocationEligibleItems,
  listAllocationSubjectMemberships,
  listAllocationIssueVouchers,
  listAllocationStandards,
  listAllocationSubjects,
  setAllocationSubjectMemberships,
  updateAllocationStandard,
} from "#services/inventory/allocation-standard.service.js";
import {
  adjustStock,
  adjustStockBatch,
  listAdjustmentLogs,
  listStocks,
  transferStock,
  transferStockBatch,
} from "#services/inventory/stock.service.js";
import {
  addWarehouseItems,
  createWarehouse,
  deleteWarehouse,
  listWarehouseItems,
  listWarehouses,
  removeWarehouseItem,
  updateWarehouse,
} from "#services/inventory/warehouse.service.js";
import categoryWarehouseService from "#services/categoryWarehouse.service.js";

class InventoryService {
  listVersions = async ({ status }) => listVersions({ status });

  createVersion = async ({ body }) => createVersion({ body });

  deleteVersion = async ({ versionId }) => deleteVersion({ versionId });

  listColors = async ({ status }) => listColors({ status });

  createColor = async ({ body }) => createColor({ body });

  deleteColor = async ({ colorId }) => deleteColor({ colorId });

  listUnitOfMeasures = async ({ status }) => listUnitOfMeasures({ status });

  createUnitOfMeasure = async ({ body }) => createUnitOfMeasure({ body });

  deleteUnitOfMeasure = async ({ unitOfMeasureId }) =>
    deleteUnitOfMeasure({ unitOfMeasureId });

  listAllocationSubjects = async ({ actor, status, unitId }) =>
    listAllocationSubjects({ actor, status, unitId });

  createAllocationSubject = async ({ actor, body }) =>
    createAllocationSubject({ actor, body });

  deleteAllocationSubject = async ({ actor, subjectId, unitId }) =>
    deleteAllocationSubject({ actor, subjectId, unitId });

  listAllocationSubjectMemberships = async ({ actor, ...query }) =>
    listAllocationSubjectMemberships({ actor, ...query });

  setAllocationSubjectMemberships = async ({ actor, body }) =>
    setAllocationSubjectMemberships({ actor, body });

  listAllocationStandards = async ({ actor, ...query }) =>
    listAllocationStandards({ actor, ...query });

  createAllocationStandard = async ({ actor, body }) =>
    createAllocationStandard({ actor, body });

  updateAllocationStandard = async ({ actor, standardId, body }) =>
    updateAllocationStandard({ actor, standardId, body });

  deleteAllocationStandard = async ({ actor, standardId, unitId }) =>
    deleteAllocationStandard({ actor, standardId, unitId });

  getAllocationEligibleItems = async ({ actor, ...query }) =>
    getAllocationEligibleItems({ actor, ...query });

  createAllocationIssueLog = async ({ actor, body }) =>
    createAllocationIssueLog({ actor, body });

  listAllocationIssueVouchers = async ({ actor, ...query }) =>
    listAllocationIssueVouchers({ actor, ...query });

  getAllocationIssueVoucherById = async ({ actor, voucherId, unitId }) =>
    getAllocationIssueVoucherById({ actor, voucherId, unitId });

  listWarehouses = async ({ actor }) => listWarehouses({ actor });

  createWarehouse = async ({ actor, body }) => createWarehouse({ actor, body });

  updateWarehouse = async ({ actor, warehouseId, body }) =>
    updateWarehouse({ actor, warehouseId, body });

  deleteWarehouse = async ({ actor, warehouseId }) =>
    deleteWarehouse({ actor, warehouseId });

  listWarehouseItems = async ({ actor, ...query }) =>
    listWarehouseItems({ actor, ...query });

  addWarehouseItems = async ({ actor, warehouseId, body }) =>
    addWarehouseItems({ actor, warehouseId, body });

  removeWarehouseItem = async ({ actor, warehouseId, itemId }) =>
    removeWarehouseItem({ actor, warehouseId, itemId });

  listWarehouseCategoryItems = async ({ actor, warehouseId, search, page, limit }) =>
    categoryWarehouseService.listCategoryWarehouseItems({
      actor,
      warehouseId,
      search,
      page,
      limit,
    });

  removeWarehouseCategoryItem = async ({ actor, warehouseId, body }) =>
    categoryWarehouseService.removeCategoryWarehouseItem({ actor, warehouseId, body });

  adjustWarehouseCategoryStock = async ({ actor, body }) =>
    categoryWarehouseService.adjustCategoryStock({ actor, body });

  transferWarehouseCategoryStock = async ({ actor, body }) =>
    categoryWarehouseService.transferCategoryStock({ actor, body });

  listItems = async ({ actor, ...query }) => listItems({ actor, ...query });

  createItem = async ({ actor, body }) => createItem({ actor, body });

  getItemImportTemplate = async () => getItemImportTemplate();

  getItemImportTemplateFileName = () => getItemImportTemplateFileName();

  importItemsByTemplate = async ({ req }) => importItemsByTemplate({ req });

  updateItem = async ({ actor, itemId, body }) => updateItem({ actor, itemId, body });

  deleteItem = async ({ itemId }) => deleteItem({ itemId });

  restoreItem = async ({ itemId }) => restoreItem({ itemId });

  listStocks = async ({ actor, ...query }) => listStocks({ actor, ...query });

  adjustStock = async ({ actor, body }) => adjustStock({ actor, body });

  adjustStockBatch = async ({ actor, body }) => adjustStockBatch({ actor, body });

  transferStock = async ({ actor, body }) => transferStock({ actor, body });

  transferStockBatch = async ({ actor, body }) => transferStockBatch({ actor, body });

  listAdjustmentLogs = async ({ actor, ...query }) =>
    listAdjustmentLogs({ actor, ...query });

  getCatalogOptions = async ({ actor, unitId } = {}) => {
    ensureAnyRole(actor, ["ADMIN"], {
      message: "Chỉ ADMIN đơn vị được thao tác tiêu chuẩn cấp phát",
      errorCode: "ALLOCATION_ADMIN_REQUIRED",
    });
    const actorUnitId = getActorUnitId(actor);
    const requestedUnitId = parseUnitIdOrNull(unitId);
    if (requestedUnitId && requestedUnitId !== actorUnitId) {
      throwForbidden("Bạn chỉ được thao tác trong đơn vị của mình", "UNIT_SCOPE_FORBIDDEN");
    }
    const scopeUnitId = actorUnitId;

    await ensureDefaultUnitOfMeasures();
    await ensureDefaultVersionsAndColors();
    await ensureDefaultAllocationSubjects({ unitId: scopeUnitId });

    const categories = await prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
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

    const defaultSubjectOrder = new Map(
      DEFAULT_ALLOCATION_SUBJECTS.map((name, index) => [normalizeForCompare(name), index]),
    );
    const defaultSubjectNormalizedValues = Array.from(defaultSubjectOrder.keys());

    const [unitOfMeasures, versions, colors, allocationSubjectsRaw] = await Promise.all([
      prisma.unitOfMeasure.findMany({
        where: { deletedAt: null },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
        },
      }),
      prisma.supplyVersion.findMany({
        where: { deletedAt: null },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
        },
      }),
      prisma.supplyColor.findMany({
        where: { deletedAt: null },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
        },
      }),
      prisma.supplyAllocationSubject.findMany({
        where: {
          deletedAt: null,
          unitId: scopeUnitId,
          nameNormalized: {
            in: defaultSubjectNormalizedValues,
          },
        },
        orderBy: [{ id: "asc" }],
        select: {
          id: true,
          name: true,
          unitId: true,
        },
      }),
    ]);

    const allocationSubjects = allocationSubjectsRaw
      .map((subject) => {
        const nameNormalized = normalizeForCompare(subject.name);
        return {
          ...subject,
          isSystemDefault: defaultSubjectOrder.has(nameNormalized),
          sortOrder: defaultSubjectOrder.has(nameNormalized)
            ? defaultSubjectOrder.get(nameNormalized)
            : Number.MAX_SAFE_INTEGER,
        };
      })
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name, "vi");
      })
      .map(({ sortOrder, ...subject }) => subject);

    return {
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        sizes: category.sizes.map((cs) => cs.size),
      })),
      unitOfMeasures,
      versions,
      colors,
      allocationSubjects,
    };
  };
}

export default new InventoryService();
