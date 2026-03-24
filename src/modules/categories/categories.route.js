import { Router } from "express";
import categoryController from "#controllers/category.controller.js";
import { validate } from "#middlewares/validateRequest.js";
import {
  createCategorySchema,
  updateCategorySchema,
  deleteCategorySchema,
  restoreCategorySchema,
  checkCategoryExistSchema,
} from "#zodSchemas/category.schema.js";
import {
  colorIdParamSchema as inventoryColorIdParamSchema,
  createColorSchema as inventoryCreateColorSchema,
  createVersionSchema as inventoryCreateVersionSchema,
  createAllocationServiceLifeRuleSchema,
  getAllocationServiceLifeEditorSchema,
  listAllocationServiceLifeRulesSchema,
  saveAllocationServiceLifeEditorSchema,
  serviceLifeRuleIdParamSchema,
  updateAllocationServiceLifeRuleSchema,
  versionIdParamSchema as inventoryVersionIdParamSchema,
} from "#zodSchemas/inventory.schema.js";
import { wrapRouter } from "#utils/wrapRouter.js";

import { protectedRoute } from "#middlewares/routerMeta.js";
import { requirePermission } from "#middlewares/requiredPermission.js";

const router = wrapRouter(Router());

/* =======================
   APPLY RBAC FOR WHOLE MODULE
======================= */
router.use(protectedRoute, requirePermission());

router.get("/catalog-options", categoryController.getCatalogOptions);
router.get(
  "/allocation-service-life-rules",
  validate(listAllocationServiceLifeRulesSchema),
  categoryController.listAllocationServiceLifeRules,
);
router.get(
  "/allocation-service-life-rules/editor",
  validate(getAllocationServiceLifeEditorSchema),
  categoryController.getAllocationServiceLifeEditor,
);
router.post(
  "/allocation-service-life-rules",
  validate(createAllocationServiceLifeRuleSchema),
  categoryController.createAllocationServiceLifeRule,
);
router.put(
  "/allocation-service-life-rules/editor",
  validate(saveAllocationServiceLifeEditorSchema),
  categoryController.saveAllocationServiceLifeEditor,
);
router.patch(
  "/allocation-service-life-rules/:ruleId",
  validate(updateAllocationServiceLifeRuleSchema),
  categoryController.updateAllocationServiceLifeRule,
);
router.delete(
  "/allocation-service-life-rules/:ruleId",
  validate(serviceLifeRuleIdParamSchema),
  categoryController.deleteAllocationServiceLifeRule,
);
router.get("/versions", categoryController.listVersions);
router.post(
  "/versions",
  validate(inventoryCreateVersionSchema),
  categoryController.createVersion,
);
router.delete(
  "/versions/:versionId",
  validate(inventoryVersionIdParamSchema),
  categoryController.deleteVersion,
);

router.get("/colors", categoryController.listColors);
router.post(
  "/colors",
  validate(inventoryCreateColorSchema),
  categoryController.createColor,
);
router.delete(
  "/colors/:colorId",
  validate(inventoryColorIdParamSchema),
  categoryController.deleteColor,
);

router.get("/", categoryController.getAll);

router.post(
  "/exists",
  validate(checkCategoryExistSchema),
  categoryController.checkExist,
);

router.post("/", validate(createCategorySchema), categoryController.add);

router.patch("/:id", validate(updateCategorySchema), categoryController.update);

router.delete(
  "/:id",
  validate(deleteCategorySchema),
  categoryController.delete,
);

router.post(
  "/:id/restore",
  validate(restoreCategorySchema),
  categoryController.restore,
);

export default router;
