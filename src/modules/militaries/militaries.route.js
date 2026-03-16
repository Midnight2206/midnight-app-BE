import { Router } from "express";
import militariesController from "#controllers/militaries.controller.js";
import { validate } from "#middlewares/validateRequest.js";
import {
  createUnitSchema,
  createRegistrationYearSchema,
  createMilitaryTypeSchema,
  createCutTransferRequestSchema,
  cutMilitaryAssuranceSchema,
  militaryTypeIdParamSchema,
  requestIdParamSchema,
  receiveMilitaryAssuranceSchema,
  transferMilitaryAssuranceSchema,
  updateMilitarySizeRegistrationsSchema,
} from "#zodSchemas/military.schema.js";
import { wrapRouter } from "#utils/wrapRouter.js";

import { protectedRoute } from "#middlewares/routerMeta.js";
import { requirePermission } from "#middlewares/requiredPermission.js";

const router = wrapRouter(Router());

/* =======================
   APPLY RBAC FOR WHOLE MODULE
======================= */
router.use(protectedRoute, requirePermission());

/* =======================
   MILITARIES
======================= */

router.get("/", militariesController.list);

router.get("/units", militariesController.listUnits);

router.get("/types", militariesController.listTypes);

router.post(
  "/types",
  validate(createMilitaryTypeSchema),
  militariesController.createType,
);

router.delete(
  "/types/:typeId",
  validate(militaryTypeIdParamSchema),
  militariesController.deleteType,
);

router.post(
  "/units",
  validate(createUnitSchema),
  militariesController.createUnit,
);

router.get("/template", militariesController.template);

router.post("/import", militariesController.import);

router.get(
  "/registrations/template",
  militariesController.registrationTemplate,
);

router.post(
  "/registrations/import-preview",
  militariesController.previewImportMilitaryRegistrations,
);

router.post(
  "/registrations/import",
  militariesController.importMilitaryRegistrations,
);

router.delete("/reset", militariesController.reset);

router.get(
  "/registration-options",
  militariesController.getRegistrationOptions,
);

router.get(
  "/registration-years",
  militariesController.listRegistrationYears,
);

router.post(
  "/registration-years",
  validate(createRegistrationYearSchema),
  militariesController.createRegistrationYear,
);

router.get(
  "/:militaryId/registrations",
  militariesController.getMilitaryRegistrations,
);

router.put(
  "/:militaryId/registrations",
  validate(updateMilitarySizeRegistrationsSchema),
  militariesController.updateMilitaryRegistrations,
);

router.post(
  "/:militaryId/transfers/cut",
  validate(cutMilitaryAssuranceSchema),
  militariesController.cutMilitaryAssurance,
);

router.post(
  "/transfers/receive",
  validate(receiveMilitaryAssuranceSchema),
  militariesController.receiveMilitaryAssurance,
);

router.post(
  "/transfers",
  validate(transferMilitaryAssuranceSchema),
  militariesController.transferMilitaryAssurance,
);

router.get(
  "/transfers/incoming",
  militariesController.listIncomingTransferRequests,
);

router.post(
  "/:militaryId/transfers/cut-request",
  validate(createCutTransferRequestSchema),
  militariesController.createCutTransferRequest,
);

router.post(
  "/transfers/:requestId/accept",
  validate(requestIdParamSchema),
  militariesController.acceptTransferRequest,
);

router.post(
  "/transfers/:requestId/undo-cut",
  validate(requestIdParamSchema),
  militariesController.undoCutTransferRequest,
);

export default router;
