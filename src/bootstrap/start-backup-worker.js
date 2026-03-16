import "dotenv/config";
import {
  startBackupScheduler,
  stopBackupScheduler,
} from "#src/modules/backups/backupScheduler.service.js";

let shuttingDown = false;

function bootstrap() {
  startBackupScheduler();
  console.log("[BackupWorker] running...");
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[BackupWorker] received ${signal}, shutting down...`);
  stopBackupScheduler();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

bootstrap();
