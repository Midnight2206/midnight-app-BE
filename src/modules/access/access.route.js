import { Router } from "express";
import accessController from "#controllers/access.controller.js";
import { validate } from "#middlewares/validateRequest.js";
import {
  createRoleSchema,
  updateRolePermissionsSchema,
  updateUserRolesSchema as updateUserRoleSchema,
} from "#zodSchemas/access.schema.js";
import { wrapRouter } from "#utils/wrapRouter.js";

import { protectedRoute } from "#middlewares/routerMeta.js";
import { requirePermission } from "#middlewares/requiredPermission.js";

const router = wrapRouter(Router());

/* =======================
   APPLY ACCESS CONTROL TO WHOLE MODULE
======================= */
router.use(protectedRoute, requirePermission());

/* =======================
   ROLES
======================= */

router.get("/roles", accessController.listRoles);

router.post("/roles", validate(createRoleSchema), accessController.createRole);

router.patch(
  "/roles/:roleId/permissions",
  validate(updateRolePermissionsSchema),
  accessController.updateRolePermissions,
);

/* =======================
   PERMISSIONS
======================= */

router.get("/permissions", accessController.listPermissions);

router.post("/permissions/sync", accessController.syncPermissions);

/* =======================
   USERS ACCESS
======================= */

router.get("/users", accessController.listUsers);

router.patch(
  "/users/:userId/role",
  validate(updateUserRoleSchema),
  accessController.updateUserRole,
);

router.patch(
  "/users/:userId/roles",
  validate(updateUserRoleSchema),
  accessController.updateUserRole,
);

export default router;
