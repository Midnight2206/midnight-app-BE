import { Router } from "express";
import backupController from "#controllers/backup.controller.js";
import { validate } from "#middlewares/validateRequest.js";
import {
  downloadBackupSchema,
  listBackupsSchema,
  restoreBackupSchema,
} from "#zodSchemas/backup.schema.js";
import { protectedRoute } from "#middlewares/routerMeta.js";
import { requirePermission } from "#middlewares/requiredPermission.js";
import { wrapRouter } from "#utils/wrapRouter.js";

const router = wrapRouter(Router());

router.use(protectedRoute, requirePermission());

router.get("/", validate(listBackupsSchema), backupController.listBackups);
router.post("/run", backupController.runBackup);
router.post(
  "/restore",
  validate(restoreBackupSchema),
  backupController.restoreBackup,
);
router.post("/restore/upload", backupController.restoreBackupFromUpload);
router.get(
  "/:fileId/download",
  validate(downloadBackupSchema),
  backupController.downloadBackup,
);

export default router;
