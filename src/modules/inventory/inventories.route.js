import { Router } from "express";
import inventoryController from "#controllers/inventory.controller.js";
import { validate } from "#middlewares/validateRequest.js";
import {
  allocationIssueVoucherIdParamSchema,
  addWarehouseItemsSchema,
  adjustWarehouseCategoryStockSchema,
  adjustStockSchema,
  adjustStockBatchSchema,
  createAllocationIssueLogSchema,
  createAllocationStandardSchema,
  createAllocationSubjectSchema,
  transferStockSchema,
  transferCategoryStockSchema,
  transferStockBatchSchema,
  createWarehouseSchema,
  updateWarehouseSchema,
  createUnitOfMeasureSchema,
  createSupplyItemSchema,
  getAllocationEligibleItemsSchema,
  listAllocationSubjectMembershipsSchema,
  itemIdParamSchema,
  removeCategoryWarehouseItemSchema,
  setAllocationSubjectMembershipsSchema,
  standardIdParamSchema,
  subjectIdParamSchema,
  unitOfMeasureIdParamSchema,
  updateSupplyItemSchema,
  updateAllocationStandardSchema,
  warehouseIdParamSchema,
  warehouseItemParamSchema,
} from "#zodSchemas/inventory.schema.js";
import { wrapRouter } from "#utils/wrapRouter.js";
import { protectedRoute } from "#middlewares/routerMeta.js";
import { requirePermission } from "#middlewares/requiredPermission.js";

const router = wrapRouter(Router());

router.use(protectedRoute, requirePermission());

router.get("/unit-of-measures", inventoryController.listUnitOfMeasures);
router.post(
  "/unit-of-measures",
  validate(createUnitOfMeasureSchema),
  inventoryController.createUnitOfMeasure,
);
router.delete(
  "/unit-of-measures/:unitOfMeasureId",
  validate(unitOfMeasureIdParamSchema),
  inventoryController.deleteUnitOfMeasure,
);

router.get("/allocation-subjects", inventoryController.listAllocationSubjects);
router.post(
  "/allocation-subjects",
  validate(createAllocationSubjectSchema),
  inventoryController.createAllocationSubject,
);
router.delete(
  "/allocation-subjects/:subjectId",
  validate(subjectIdParamSchema),
  inventoryController.deleteAllocationSubject,
);
router.get(
  "/allocation-subjects/memberships",
  validate(listAllocationSubjectMembershipsSchema),
  inventoryController.listAllocationSubjectMemberships,
);
router.put(
  "/allocation-subjects/memberships",
  validate(setAllocationSubjectMembershipsSchema),
  inventoryController.setAllocationSubjectMemberships,
);

router.get("/allocation-standards", inventoryController.listAllocationStandards);
router.post(
  "/allocation-standards",
  validate(createAllocationStandardSchema),
  inventoryController.createAllocationStandard,
);
router.patch(
  "/allocation-standards/:standardId",
  validate(updateAllocationStandardSchema),
  inventoryController.updateAllocationStandard,
);
router.get(
  "/allocation-standards/eligible-items",
  validate(getAllocationEligibleItemsSchema),
  inventoryController.getAllocationEligibleItems,
);
router.delete(
  "/allocation-standards/:standardId",
  validate(standardIdParamSchema),
  inventoryController.deleteAllocationStandard,
);
router.post(
  "/allocation-issues",
  validate(createAllocationIssueLogSchema),
  inventoryController.createAllocationIssueLog,
);
router.get(
  "/allocation-issues/vouchers",
  inventoryController.listAllocationIssueVouchers,
);
router.get(
  "/allocation-issues/vouchers/:voucherId",
  validate(allocationIssueVoucherIdParamSchema),
  inventoryController.getAllocationIssueVoucherById,
);

router.get("/warehouses", inventoryController.listWarehouses);
router.post(
  "/warehouses",
  validate(createWarehouseSchema),
  inventoryController.createWarehouse,
);
router.patch(
  "/warehouses/:warehouseId",
  validate(updateWarehouseSchema),
  inventoryController.updateWarehouse,
);
router.delete(
  "/warehouses/:warehouseId",
  validate(warehouseIdParamSchema),
  inventoryController.deleteWarehouse,
);
router.get(
  "/warehouses/:warehouseId/items",
  validate(warehouseIdParamSchema),
  inventoryController.listWarehouseItems,
);
router.post(
  "/warehouses/:warehouseId/items",
  validate(addWarehouseItemsSchema),
  inventoryController.addWarehouseItems,
);
router.delete(
  "/warehouses/:warehouseId/items/:itemId",
  validate(warehouseItemParamSchema),
  inventoryController.removeWarehouseItem,
);
router.get(
  "/warehouses/:warehouseId/category-items",
  validate(warehouseIdParamSchema),
  inventoryController.listWarehouseCategoryItems,
);
router.delete(
  "/warehouses/:warehouseId/category-items",
  validate(removeCategoryWarehouseItemSchema),
  inventoryController.removeWarehouseCategoryItem,
);
router.post(
  "/warehouses/category-stocks/adjust",
  validate(adjustWarehouseCategoryStockSchema),
  inventoryController.adjustWarehouseCategoryStock,
);
router.post(
  "/warehouses/category-stocks/transfer",
  validate(transferCategoryStockSchema),
  inventoryController.transferWarehouseCategoryStock,
);

router.get("/items", inventoryController.listItems);
router.get("/items/template", inventoryController.itemTemplate);
router.post("/items/import", inventoryController.importItems);
router.post("/items", validate(createSupplyItemSchema), inventoryController.createItem);
router.patch(
  "/items/:itemId",
  validate(updateSupplyItemSchema),
  inventoryController.updateItem,
);
router.delete(
  "/items/:itemId",
  validate(itemIdParamSchema),
  inventoryController.deleteItem,
);
router.post(
  "/items/:itemId/restore",
  validate(itemIdParamSchema),
  inventoryController.restoreItem,
);

router.get("/stocks", inventoryController.listStocks);
router.post("/stocks/adjust", validate(adjustStockSchema), inventoryController.adjustStock);
router.post(
  "/stocks/adjust-batch",
  validate(adjustStockBatchSchema),
  inventoryController.adjustStockBatch,
);
router.post(
  "/stocks/transfer",
  validate(transferStockSchema),
  inventoryController.transferStock,
);
router.post(
  "/stocks/transfer-batch",
  validate(transferStockBatchSchema),
  inventoryController.transferStockBatch,
);
router.get("/stocks/logs", inventoryController.listAdjustmentLogs);

export default router;
