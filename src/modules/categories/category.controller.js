import categoryService from "#services/category.service.js";
import CategoryWithSizesService from "#services/categoryWithSizes.service.js";
import categoryWarehouseService from "#services/categoryWarehouse.service.js";
import inventoryService from "#services/inventory.service.js";
import { AppError } from "#utils/AppError.js";
import { HTTP_CODES } from "#src/constants.js";
class CategoryController {
  listWarehouses = async (req, res) => {
    const result = await categoryWarehouseService.listCategoryWarehouses({
      actor: req.user,
    });
    return res.success({
      data: result,
      message: "Get category warehouses successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  createWarehouse = async (req, res) => {
    const result = await categoryWarehouseService.createCategoryWarehouse({
      actor: req.user,
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Create category warehouse successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  updateWarehouse = async (req, res) => {
    const result = await categoryWarehouseService.updateCategoryWarehouse({
      actor: req.user,
      warehouseId: req.params.warehouseId,
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Update category warehouse successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  deleteWarehouse = async (req, res) => {
    const result = await categoryWarehouseService.deleteCategoryWarehouse({
      actor: req.user,
      warehouseId: req.params.warehouseId,
    });
    return res.success({
      data: result,
      message: "Delete category warehouse successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  listWarehouseItems = async (req, res) => {
    const result = await categoryWarehouseService.listCategoryWarehouseItems({
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

  addWarehouseItems = async (req, res) => {
    const result = await categoryWarehouseService.addCategoryWarehouseItems({
      actor: req.user,
      warehouseId: req.params.warehouseId,
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Add warehouse category items successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  removeWarehouseItem = async (req, res) => {
    const result = await categoryWarehouseService.removeCategoryWarehouseItem({
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

  adjustWarehouseStock = async (req, res) => {
    const result = await categoryWarehouseService.adjustCategoryStock({
      actor: req.user,
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Adjust category warehouse stock successfully",
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
      message: "Get category catalog options successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  listAllocationServiceLifeRules = async (req, res) => {
    const result = await inventoryService.listAllocationServiceLifeRules({
      actor: req.user,
      unitId: req.query.unitId,
      typeId: req.query.typeId,
      categoryId: req.query.categoryId,
      status: req.query.status,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.success({
      data: result,
      message: "Get category allocation service life rules successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  createAllocationServiceLifeRule = async (req, res) => {
    const result = await inventoryService.createAllocationServiceLifeRule({
      actor: req.user,
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Create category allocation service life rule successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  getAllocationServiceLifeEditor = async (req, res) => {
    const result = await inventoryService.getAllocationServiceLifeEditor({
      actor: req.user,
      unitId: req.query.unitId,
      typeId: req.query.typeId,
    });
    return res.success({
      data: result,
      message: "Get category allocation service life editor successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  saveAllocationServiceLifeEditor = async (req, res) => {
    const result = await inventoryService.saveAllocationServiceLifeEditor({
      actor: req.user,
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Save category allocation service life editor successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  updateAllocationServiceLifeRule = async (req, res) => {
    const result = await inventoryService.updateAllocationServiceLifeRule({
      actor: req.user,
      ruleId: req.params.ruleId,
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Update category allocation service life rule successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  deleteAllocationServiceLifeRule = async (req, res) => {
    const result = await inventoryService.deleteAllocationServiceLifeRule({
      actor: req.user,
      ruleId: req.params.ruleId,
      unitId: req.query.unitId,
    });
    return res.success({
      data: result,
      message: "Delete category allocation service life rule successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  listVersions = async (req, res) => {
    const result = await inventoryService.listVersions({
      status: req.query.status,
    });
    return res.success({
      data: result,
      message: "Get category versions successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  createVersion = async (req, res) => {
    const result = await inventoryService.createVersion({
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Create category version successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  deleteVersion = async (req, res) => {
    const result = await inventoryService.deleteVersion({
      versionId: req.params.versionId,
    });
    return res.success({
      data: result,
      message: "Delete category version successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  listColors = async (req, res) => {
    const result = await inventoryService.listColors({
      status: req.query.status,
    });
    return res.success({
      data: result,
      message: "Get category colors successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  createColor = async (req, res) => {
    const result = await inventoryService.createColor({
      body: req.body,
    });
    return res.success({
      data: result,
      message: "Create category color successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  deleteColor = async (req, res) => {
    const result = await inventoryService.deleteColor({
      colorId: req.params.colorId,
    });
    return res.success({
      data: result,
      message: "Delete category color successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  getAll = async (req, res) => {
    const categories = await categoryService.getAll({
      search: req.query.q,
      status: req.query.status,
      sortBy: req.query.sortBy,
      order: req.query.order,
    });
    return res.success({
      data: { categories },
      message: "Get all categories successfully",
      statusCode: 200,
    });
  };
  checkExist = async (req, res) => {
    const { name } = req.query;
    const category = await categoryService.findByName({ name });
    const exists = Boolean(category);
    return res.success({
      data: { exists },
      message: "Check category existence successfully",
      statusCode: HTTP_CODES.OK,
    });
  };
  add = async (req, res) => {
    const {
      name,
      sizes,
      code,
      unitOfMeasureId,
      versionId,
      colorId,
      versionIds,
      colorIds,
      totalQuantity,
      isActive,
    } = req.body;
    const category = await CategoryWithSizesService.create({
      name,
      sizeNames: sizes,
      code,
      unitOfMeasureId,
      versionId,
      colorId,
      versionIds,
      colorIds,
      totalQuantity,
      isActive,
    });
    return res.success({
      data: { category },
      message: "Category created successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };
  update = async (req, res) => {
    const id = parseInt(req.params.id);

    if (Number.isNaN(id)) {
      throw new AppError({
        statusCode: HTTP_CODES.BAD_REQUEST,
        message: "Invalid category id",
        errorCode: "INVALID_CATEGORY_ID",
      });
    }
    const {
      name,
      sizes,
      code,
      unitOfMeasureId,
      versionId,
      colorId,
      versionIds,
      colorIds,
      totalQuantity,
      isActive,
    } = req.body;

    const updatedCategory = await CategoryWithSizesService.update({
      id,
      name,
      sizeNames: Array.isArray(sizes) ? sizes : undefined,
      code,
      unitOfMeasureId,
      versionId,
      colorId,
      versionIds,
      colorIds,
      totalQuantity,
      isActive,
    });

    return res.success({
      data: { category: updatedCategory },
      message: "Category updated successfully",
      statusCode: HTTP_CODES.OK,
    });
  };
  delete = async (req, res) => {
    const id = parseInt(req.params.id);

    if (Number.isNaN(id)) {
      throw new AppError({
        statusCode: HTTP_CODES.BAD_REQUEST,
        message: "Invalid category id",
        errorCode: "INVALID_CATEGORY_ID",
      });
    }

    await CategoryWithSizesService.deleteCategory({ categoryId: id });

    return res.success({
      data: null,
      message: "Category deleted successfully",
      statusCode: HTTP_CODES.NO_CONTENT,
    });
  };
  restore = async (req, res) => {
    const id = parseInt(req.params.id);

    if (Number.isNaN(id)) {
      throw new AppError({
        statusCode: HTTP_CODES.BAD_REQUEST,
        message: "Invalid category id",
        errorCode: "INVALID_CATEGORY_ID",
      });
    }

    await CategoryWithSizesService.restoreCategory({ categoryId: id });

    return res.success({
      data: null,
      message: "Category restored successfully",
      statusCode: HTTP_CODES.OK,
    });
  };
}
export default new CategoryController();
