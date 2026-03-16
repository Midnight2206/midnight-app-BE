import { Router } from "express";
import roleController from "#controllers/role.controller.js";
import { requirePermission } from "#middlewares/requiredPermission.js";

const router = Router();
const rolePermission = (method, path) =>
  `${method.toUpperCase()} /api/role${path}`;

/* ================= ROLE CRUD ================= */

router.post(
  "/",

  requirePermission(rolePermission("post", "")),
  roleController.createRole,
);

router.put(
  "/:id",

  requirePermission(rolePermission("put", "/:id")),
  roleController.updateRole,
);

router.delete(
  "/:id",

  requirePermission(rolePermission("delete", "/:id")),
  roleController.deleteRole,
);

router.get(
  "/:id",

  requirePermission(rolePermission("get", "/:id")),
  roleController.getRoleDetail,
);

/* ================= PERMISSION MANAGEMENT ================= */

router.post(
  "/:id/permissions",

  requirePermission(rolePermission("post", "/:id/permissions")),
  roleController.assignPermission,
);

router.delete(
  "/:id/permissions",

  requirePermission(rolePermission("delete", "/:id/permissions")),
  roleController.removePermission,
);

/* ================= USER ROLE MANAGEMENT ================= */

router.post(
  "/:id/users",

  requirePermission(rolePermission("post", "/:id/users")),
  roleController.assignRoleToUser,
);

router.delete(
  "/:id/users",

  requirePermission(rolePermission("delete", "/:id/users")),
  roleController.removeRoleFromUser,
);

export default router;
