import "dotenv/config";
import { loadEnv } from "#src/infrastructure/config/env.js";
import app from "#src/app/create-app.js";
import { syncPermissionsFromRoutes } from "#services/permission-sync.service.js";
import {
  startBackupScheduler,
  stopBackupScheduler,
} from "#src/modules/backups/backupScheduler.service.js";

loadEnv();

const PORT = process.env.PORT || 3000;
const shouldSyncPermissionOnBoot =
  process.env.PERMISSION_SYNC_ON_BOOT !== "false";
let httpServer = null;
let shuttingDown = false;

async function bootstrap() {
  if (shouldSyncPermissionOnBoot) {
    const syncResult = await syncPermissionsFromRoutes();
    console.log("Permission sync:", syncResult);
  } else {
    console.log("Permission sync skipped (PERMISSION_SYNC_ON_BOOT=false)");
  }

  startBackupScheduler();

  httpServer = app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[Server] received ${signal}, shutting down...`);
  stopBackupScheduler();

  if (!httpServer) {
    process.exit(0);
    return;
  }

  httpServer.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

bootstrap().catch((error) => {
  console.error("Failed to bootstrap server:", error);
  process.exit(1);
});
