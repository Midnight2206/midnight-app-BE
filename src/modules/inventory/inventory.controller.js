import inventoryService from "#services/inventory.service.js";
import { HTTP_CODES } from "#src/constants.js";

class InventoryController {
  listVersions = async (req, res) => {
    const result = await inventoryService.listVersions({
      status: req.query.status,
    });
    return res.success({
      data: result,
      message: "Get versions successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  createVersion = async (req, res) => {
    const result = await inventoryService.createVersion({
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Create version successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  deleteVersion = async (req, res) => {
    const result = await inventoryService.deleteVersion({
      versionId: req.params.versionId,
    });
    return res.success({
      data: result,
      message: "Delete version successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  listColors = async (req, res) => {
    const result = await inventoryService.listColors({
      status: req.query.status,
    });
    return res.success({
      data: result,
      message: "Get colors successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  createColor = async (req, res) => {
    const result = await inventoryService.createColor({
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Create color successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  deleteColor = async (req, res) => {
    const result = await inventoryService.deleteColor({
      colorId: req.params.colorId,
    });
    return res.success({
      data: result,
      message: "Delete color successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  listUnitOfMeasures = async (req, res) => {
    const result = await inventoryService.listUnitOfMeasures({
      status: req.query.status,
    });
    return res.success({
      data: result,
      message: "Get unit of measures successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  createUnitOfMeasure = async (req, res) => {
    const result = await inventoryService.createUnitOfMeasure({
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Create unit of measure successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  deleteUnitOfMeasure = async (req, res) => {
    const result = await inventoryService.deleteUnitOfMeasure({
      unitOfMeasureId: req.params.unitOfMeasureId,
    });
    return res.success({
      data: result,
      message: "Delete unit of measure successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  listAllocationSubjects = async (req, res) => {
    const result = await inventoryService.listAllocationSubjects({
      actor: req.user,
      status: req.query.status,
      unitId: req.query.unitId,
    });
    return res.success({
      data: result,
      message: "Get allocation subjects successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  createAllocationSubject = async (req, res) => {
    const result = await inventoryService.createAllocationSubject({
      actor: req.user,
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Create allocation subject successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  deleteAllocationSubject = async (req, res) => {
    const result = await inventoryService.deleteAllocationSubject({
      actor: req.user,
      subjectId: req.params.subjectId,
      unitId: req.query.unitId,
    });
    return res.success({
      data: result,
      message: "Delete allocation subject successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  listAllocationSubjectMemberships = async (req, res) => {
    const result = await inventoryService.listAllocationSubjectMemberships({
      actor: req.user,
      militaryId: req.query.militaryId,
      unitId: req.query.unitId,
      asOfYear: req.query.asOfYear,
    });
    return res.success({
      data: result,
      message: "Get allocation subject memberships successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  setAllocationSubjectMemberships = async (req, res) => {
    const result = await inventoryService.setAllocationSubjectMemberships({
      actor: req.user,
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Update allocation subject memberships successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  listAllocationStandards = async (req, res) => {
    const result = await inventoryService.listAllocationStandards({
      actor: req.user,
      search: req.query.search,
      subjectId: req.query.subjectId,
      categoryId: req.query.categoryId,
      unitId: req.query.unitId,
      status: req.query.status,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.success({
      data: result,
      message: "Get allocation standards successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  createAllocationStandard = async (req, res) => {
    const result = await inventoryService.createAllocationStandard({
      actor: req.user,
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Create allocation standard successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  updateAllocationStandard = async (req, res) => {
    const result = await inventoryService.updateAllocationStandard({
      actor: req.user,
      standardId: req.params.standardId,
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Update allocation standard successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  deleteAllocationStandard = async (req, res) => {
    const result = await inventoryService.deleteAllocationStandard({
      actor: req.user,
      standardId: req.params.standardId,
      unitId: req.query.unitId,
    });
    return res.success({
      data: result,
      message: "Delete allocation standard successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  getAllocationEligibleItems = async (req, res) => {
    const result = await inventoryService.getAllocationEligibleItems({
      actor: req.user,
      subjectId: req.query.subjectId,
      militaryId: req.query.militaryId,
      categoryId: req.query.categoryId,
      asOfDate: req.query.asOfDate,
      asOfYear: req.query.asOfYear,
      gender: req.query.gender,
      unitId: req.query.unitId,
    });
    return res.success({
      data: result,
      message: "Get allocation eligible items successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  createAllocationIssueLog = async (req, res) => {
    const result = await inventoryService.createAllocationIssueLog({
      actor: req.user,
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Create allocation issue log successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  listAllocationIssueVouchers = async (req, res) => {
    const result = await inventoryService.listAllocationIssueVouchers({
      actor: req.user,
      militaryId: req.query.militaryId,
      warehouseId: req.query.warehouseId,
      page: req.query.page,
      limit: req.query.limit,
      unitId: req.query.unitId,
    });
    return res.success({
      data: result,
      message: "Get allocation issue vouchers successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  getAllocationIssueVoucherById = async (req, res) => {
    const result = await inventoryService.getAllocationIssueVoucherById({
      actor: req.user,
      voucherId: req.params.voucherId,
      unitId: req.query.unitId,
    });
    return res.success({
      data: result,
      message: "Get allocation issue voucher successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  getCatalogOptions = async (req, res) => {
    const result = await inventoryService.getCatalogOptions({
      actor: req.user,
      unitId: req.query.unitId,
    });
    return res.success({
      data: result,
      message: "Get inventory catalog options successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  listWarehouses = async (req, res) => {
    const result = await inventoryService.listWarehouses({ actor: req.user });
    return res.success({
      data: result,
      message: "Get warehouses successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  createWarehouse = async (req, res) => {
    const result = await inventoryService.createWarehouse({
      actor: req.user,
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Create warehouse successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  updateWarehouse = async (req, res) => {
    const result = await inventoryService.updateWarehouse({
      actor: req.user,
      warehouseId: req.params.warehouseId,
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Update warehouse successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  deleteWarehouse = async (req, res) => {
    const result = await inventoryService.deleteWarehouse({
      actor: req.user,
      warehouseId: req.params.warehouseId,
    });
    return res.success({
      data: result,
      message: "Delete warehouse successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  listWarehouseItems = async (req, res) => {
    const result = await inventoryService.listWarehouseItems({
      actor: req.user,
      warehouseId: req.params.warehouseId,
      search: req.query.search,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.success({
      data: result,
      message: "Get warehouse items successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  addWarehouseItems = async (req, res) => {
    const result = await inventoryService.addWarehouseItems({
      actor: req.user,
      warehouseId: req.params.warehouseId,
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Add warehouse items successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  removeWarehouseItem = async (req, res) => {
    const result = await inventoryService.removeWarehouseItem({
      actor: req.user,
      warehouseId: req.params.warehouseId,
      itemId: req.params.itemId,
    });
    return res.success({
      data: result,
      message: "Remove warehouse item successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  listWarehouseCategoryItems = async (req, res) => {
    const result = await inventoryService.listWarehouseCategoryItems({
      actor: req.user,
      warehouseId: req.params.warehouseId,
      search: req.query.search,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.success({
      data: result,
      message: "Get warehouse category items successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  removeWarehouseCategoryItem = async (req, res) => {
    const result = await inventoryService.removeWarehouseCategoryItem({
      actor: req.user,
      warehouseId: req.params.warehouseId,
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Remove warehouse category item successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  adjustWarehouseCategoryStock = async (req, res) => {
    const result = await inventoryService.adjustWarehouseCategoryStock({
      actor: req.user,
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Adjust warehouse category stock successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  transferWarehouseCategoryStock = async (req, res) => {
    const result = await inventoryService.transferWarehouseCategoryStock({
      actor: req.user,
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Transfer warehouse category stock successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  listItems = async (req, res) => {
    const result = await inventoryService.listItems({
      actor: req.user,
      search: req.query.search,
      categoryId: req.query.categoryId,
      status: req.query.status,
      page: req.query.page,
      limit: req.query.limit,
    });

    return res.success({
      data: result,
      message: "Get supply items successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  createItem = async (req, res) => {
    const result = await inventoryService.createItem({
      actor: req.user,
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Create supply item successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  itemTemplate = async (req, res) => {
    const templateBuffer = await inventoryService.getItemImportTemplate();
    const fileName = inventoryService.getItemImportTemplateFileName();

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    return res.status(HTTP_CODES.OK).send(templateBuffer);
  };

  importItems = async (req, res) => {
    const result = await inventoryService.importItemsByTemplate({ req });
    return res.success({
      data: result,
      message: "Import supply items successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  updateItem = async (req, res) => {
    const result = await inventoryService.updateItem({
      actor: req.user,
      itemId: req.params.itemId,
      body: req.body,
    });

    return res.success({
      data: result,
      message: "Update supply item successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  deleteItem = async (req, res) => {
    const result = await inventoryService.deleteItem({
      itemId: req.params.itemId,
    });

    return res.success({
      data: result,
      message: "Delete supply item successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  restoreItem = async (req, res) => {
    const result = await inventoryService.restoreItem({
      itemId: req.params.itemId,
    });

    return res.success({
      data: result,
      message: "Restore supply item successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  listStocks = async (req, res) => {
    const result = await inventoryService.listStocks({
      actor: req.user,
      warehouseId: req.query.warehouseId,
      search: req.query.search,
      page: req.query.page,
      limit: req.query.limit,
    });

    return res.success({
      data: result,
      message: "Get warehouse stocks successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  adjustStock = async (req, res) => {
    const result = await inventoryService.adjustStock({
      actor: req.user,
      body: req.body,
    });

    return res.success({
      data: result,
      message: "Adjust stock successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  adjustStockBatch = async (req, res) => {
    const result = await inventoryService.adjustStockBatch({
      actor: req.user,
      body: req.body,
    });

    return res.success({
      data: result,
      message: "Adjust stock batch successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  transferStock = async (req, res) => {
    const result = await inventoryService.transferStock({
      actor: req.user,
      body: req.body,
    });

    return res.success({
      data: result,
      message: "Transfer stock successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  transferStockBatch = async (req, res) => {
    const result = await inventoryService.transferStockBatch({
      actor: req.user,
      body: req.body,
    });

    return res.success({
      data: result,
      message: "Transfer stock batch successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  listAdjustmentLogs = async (req, res) => {
    const result = await inventoryService.listAdjustmentLogs({
      actor: req.user,
      warehouseId: req.query.warehouseId,
      itemId: req.query.itemId,
      page: req.query.page,
      limit: req.query.limit,
    });

    return res.success({
      data: result,
      message: "Get stock adjustment logs successfully",
      statusCode: HTTP_CODES.OK,
    });
  };
}

export default new InventoryController();
