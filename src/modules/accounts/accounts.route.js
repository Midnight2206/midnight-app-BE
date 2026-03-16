import { Router } from "express";
import accountsController from "#controllers/accounts.controller.js";
import { validate } from "#middlewares/validateRequest.js";
import {
  createAdminSchema,
  resetPasswordSchema,
  updateAccountStatusSchema,
} from "#zodSchemas/accounts.schema.js";
import { wrapRouter } from "#utils/wrapRouter.js";

import { protectedRoute } from "#middlewares/routerMeta.js";
import { requirePermission } from "#middlewares/requiredPermission.js";

const router = wrapRouter(Router());

/* =======================
   APPLY RBAC FOR WHOLE MODULE
======================= */
router.use(protectedRoute, requirePermission());

/* =======================
   ACCOUNTS
======================= */

router.get("/", accountsController.listAccounts);

router.get("/units", accountsController.listUnits);

router.get("/audits", accountsController.listAudits);

router.post(
  "/admins",
  validate(createAdminSchema),
  accountsController.createAdmin,
);

router.patch(
  "/:userId/status",
  validate(updateAccountStatusSchema),
  accountsController.updateAccountStatus,
);

router.patch(
  "/:userId/reset-password",
  validate(resetPasswordSchema),
  accountsController.resetPassword,
);

export default router;
