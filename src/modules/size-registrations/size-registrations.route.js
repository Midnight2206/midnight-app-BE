import { Router } from "express";
import sizeRegistrationWorkflowController from "#controllers/sizeRegistrationWorkflow.controller.js";
import { protectedRoute } from "#middlewares/routerMeta.js";
import { requirePermission } from "#middlewares/requiredPermission.js";
import { validate } from "#middlewares/validateRequest.js";
import {
  reviewRegistrationRequestSchema,
  submitRegistrationRequestSchema,
  upsertRegistrationPeriodSchema,
} from "#zodSchemas/sizeRegistrationWorkflow.schema.js";
import { wrapRouter } from "#utils/wrapRouter.js";

const router = wrapRouter(Router());

router.use(protectedRoute, requirePermission());

router.get("/my/context", sizeRegistrationWorkflowController.getMyContext);
router.post(
  "/my/requests",
  validate(submitRegistrationRequestSchema),
  sizeRegistrationWorkflowController.submitMyRequest,
);

router.get("/periods", sizeRegistrationWorkflowController.listPeriods);
router.put(
  "/periods/:year",
  validate(upsertRegistrationPeriodSchema),
  sizeRegistrationWorkflowController.upsertPeriodStatus,
);

router.get("/requests", sizeRegistrationWorkflowController.listRequests);
router.patch(
  "/requests/:requestId/review",
  validate(reviewRegistrationRequestSchema),
  sizeRegistrationWorkflowController.reviewRequest,
);

export default router;
