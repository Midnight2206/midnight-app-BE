import os from "os";
import path from "path";
import fsp from "fs/promises";
import { getBackupConfig, getEncryptionKey } from "#services/backups/config.js";
import {
  buildTimestamp,
  decryptFile,
  encryptFile,
  gunzipFile,
  gzipFile,
  sha256File,
} from "#services/backups/crypto.util.js";
import {
  downloadFileFromGoogleDrive,
  listBackupFilesFromGoogleDrive,
  uploadFileToGoogleDrive,
} from "#services/backups/googleDrive.util.js";
import { runMysqldump, runMysqlRestore } from "#services/backups/mysql.util.js";
import {
  cleanupLocalBackups,
  sendBackupReportEmail,
  sendRestoreReportEmail,
} from "#services/backups/notification.util.js";
import {
  cronMatches,
  minuteKey,
  parseCronExpression,
} from "#services/backups/cron.util.js";

const runtimeState = {
  schedulerTimer: null,
  activeTask: null,
  lastRunMinuteKey: null,
};

function startTask(taskName) {
  if (runtimeState.activeTask) {
    throw new Error(
      `Backup service is busy with "${runtimeState.activeTask}" task`,
    );
  }
  runtimeState.activeTask = taskName;
}

function stopTask() {
  runtimeState.activeTask = null;
}

async function restoreFromEncryptedBackup({
  encryptedPath,
  fileId,
  fileName = "",
  actorEmail = "",
  cleanupEncrypted = false,
}) {
  const config = getBackupConfig();
  const startedAt = new Date();
  const timestamp = buildTimestamp(startedAt);
  const gzipPath = path.join(config.workDir, `restore_${timestamp}.sql.gz`);
  const sqlPath = path.join(config.workDir, `restore_${timestamp}.sql`);

  await fsp.mkdir(config.workDir, { recursive: true });
  try {
    const encryptionKey = getEncryptionKey();
    await decryptFile({
      sourcePath: encryptedPath,
      outputPath: gzipPath,
      key: encryptionKey,
    });

    await gunzipFile(gzipPath, sqlPath);
    await runMysqlRestore(sqlPath);

    const finishedAt = new Date();
    await sendRestoreReportEmail({
      fileId,
      fileName,
      startedAt,
      finishedAt,
      actorEmail,
    });

    console.log("[Backup] Restore completed successfully", {
      fileId,
      fileName,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    });

    return {
      fileId,
      fileName,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    };
  } finally {
    await Promise.all([
      fsp.rm(gzipPath, { force: true }).catch(() => {}),
      fsp.rm(sqlPath, { force: true }).catch(() => {}),
      cleanupEncrypted ? fsp.rm(encryptedPath, { force: true }).catch(() => {}) : Promise.resolve(),
    ]);
  }
}

export async function runBackupNow() {
  const config = getBackupConfig();
  startTask("backup");

  const startedAt = new Date();
  const hostName = os.hostname();
  const timestamp = buildTimestamp(startedAt);
  const baseName = `${process.env.DB_NAME || "database"}_${timestamp}`;
  const sqlPath = path.join(config.workDir, `${baseName}.sql`);
  const gzipPath = path.join(config.workDir, `${baseName}.sql.gz`);
  const encryptedPath = path.join(config.workDir, `${baseName}.sql.gz.enc`);

  try {
    await fsp.mkdir(config.workDir, { recursive: true });
    await runMysqldump(sqlPath);
    await gzipFile(sqlPath, gzipPath);

    const encryptionKey = getEncryptionKey();
    await encryptFile({
      sourcePath: gzipPath,
      outputPath: encryptedPath,
      key: encryptionKey,
    });

    const [checksum, encryptedStat] = await Promise.all([
      sha256File(encryptedPath),
      fsp.stat(encryptedPath),
    ]);

    const isLocalStorage = config.storage === "local";
    const uploadedFile = isLocalStorage
      ? {
          id: `local:${path.basename(encryptedPath)}`,
          name: path.basename(encryptedPath),
          webViewLink: "",
          webContentLink: "",
        }
      : await uploadFileToGoogleDrive({
          filePath: encryptedPath,
          fileName: path.basename(encryptedPath),
        });

    const finishedAt = new Date();
    await sendBackupReportEmail({
      uploadedFile,
      checksum,
      encryptedSizeBytes: encryptedStat.size,
      startedAt,
      finishedAt,
      hostName,
      backupFileName: path.basename(encryptedPath),
      storageType: config.storage,
      localFilePath: encryptedPath,
    });

    await cleanupLocalBackups(config.workDir);
    console.log("[Backup] Backup completed successfully", {
      fileId: uploadedFile.id,
      fileName: path.basename(encryptedPath),
      size: encryptedStat.size,
      checksum,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    });

    return {
      fileId: uploadedFile.id,
      fileName: path.basename(encryptedPath),
      storage: config.storage,
      localFilePath: isLocalStorage ? encryptedPath : null,
      checksum,
      encryptedSizeBytes: encryptedStat.size,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    };
  } finally {
    await Promise.all([
      fsp.rm(sqlPath, { force: true }).catch(() => {}),
      fsp.rm(gzipPath, { force: true }).catch(() => {}),
    ]);
    stopTask();
  }
}

export async function listBackupsOnDrive({ pageSize = 50, pageToken = "" } = {}) {
  const config = getBackupConfig();
  if (config.storage === "local") {
    await fsp.mkdir(config.workDir, { recursive: true });
    const entries = await fsp.readdir(config.workDir, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".sql.gz.enc"))
        .map(async (entry) => {
          const fullPath = path.join(config.workDir, entry.name);
          const stat = await fsp.stat(fullPath);
          return {
            id: `local:${entry.name}`,
            name: entry.name,
            size: Number(stat.size || 0),
            createdTime: stat.birthtime?.toISOString?.() || null,
            modifiedTime: stat.mtime?.toISOString?.() || null,
            webViewLink: "",
          };
        }),
    );

    files.sort((a, b) => {
      const aTime = new Date(a.createdTime || 0).getTime();
      const bTime = new Date(b.createdTime || 0).getTime();
      return bTime - aTime;
    });

    return {
      files: files.slice(0, Math.max(1, pageSize)),
      nextPageToken: null,
    };
  }

  const result = await listBackupFilesFromGoogleDrive({
    pageSize,
    pageToken,
  });
  return {
    files: result.files.map((file) => ({
      id: file.id,
      name: file.name,
      size: Number(file.size || 0),
      createdTime: file.createdTime || null,
      modifiedTime: file.modifiedTime || null,
      webViewLink:
        file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
    })),
    nextPageToken: result.nextPageToken,
  };
}

function normalizeLocalBackupFileName(fileId) {
  const raw = String(fileId || "").trim();
  const withoutPrefix = raw.startsWith("local:") ? raw.slice("local:".length) : raw;
  const safeName = path.basename(withoutPrefix);
  if (!safeName || safeName !== withoutPrefix || !safeName.endsWith(".sql.gz.enc")) {
    throw new Error("Invalid local backup file id");
  }
  return safeName;
}

export async function resolveBackupFileForDownload(fileId) {
  const config = getBackupConfig();
  if (config.storage !== "local") {
    throw new Error("Download via server is only supported when BACKUP_STORAGE=local");
  }

  const fileName = normalizeLocalBackupFileName(fileId);
  const filePath = path.join(config.workDir, fileName);
  await fsp.access(filePath);

  return {
    fileName,
    filePath,
    storage: config.storage,
  };
}

export async function runRestoreFromDrive({
  fileId,
  actorEmail = "",
  fileName = "",
}) {
  if (!fileId) {
    throw new Error("fileId is required for restore");
  }

  const config = getBackupConfig();
  startTask("restore");
  const startedAt = new Date();
  const timestamp = buildTimestamp(startedAt);
  const encryptedPath = path.join(config.workDir, `restore_${timestamp}.sql.gz.enc`);

  await fsp.mkdir(config.workDir, { recursive: true });
  try {
    await downloadFileFromGoogleDrive({
      fileId,
      outputPath: encryptedPath,
    });

    return await restoreFromEncryptedBackup({
      encryptedPath,
      fileId,
      fileName,
      actorEmail,
      cleanupEncrypted: true,
    });
  } finally {
    stopTask();
  }
}

export async function runRestoreFromLocalServerFile({
  fileId,
  actorEmail = "",
}) {
  if (!fileId) throw new Error("fileId is required for local restore");
  const config = getBackupConfig();
  if (config.storage !== "local") {
    throw new Error("Local restore from server file requires BACKUP_STORAGE=local");
  }

  startTask("restore");
  try {
    const file = await resolveBackupFileForDownload(fileId);
    return await restoreFromEncryptedBackup({
      encryptedPath: file.filePath,
      fileId,
      fileName: file.fileName,
      actorEmail,
      cleanupEncrypted: false,
    });
  } finally {
    stopTask();
  }
}

export async function runRestoreFromUploadedLocalFile({
  originalFileName,
  fileBuffer,
  actorEmail = "",
}) {
  if (!fileBuffer || !Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw new Error("Uploaded backup file is empty");
  }

  const normalizedName = path.basename(String(originalFileName || "uploaded_backup.sql.gz.enc"));
  if (!normalizedName.endsWith(".sql.gz.enc")) {
    throw new Error("Uploaded file must end with .sql.gz.enc");
  }

  const config = getBackupConfig();
  startTask("restore");
  const tempName = `upload_${buildTimestamp(new Date())}_${normalizedName}`;
  const uploadedPath = path.join(config.workDir, tempName);
  await fsp.mkdir(config.workDir, { recursive: true });
  await fsp.writeFile(uploadedPath, fileBuffer);

  try {
    return await restoreFromEncryptedBackup({
      encryptedPath: uploadedPath,
      fileId: `upload:${normalizedName}`,
      fileName: normalizedName,
      actorEmail,
      cleanupEncrypted: true,
    });
  } finally {
    stopTask();
  }
}

export function startBackupScheduler() {
  if (runtimeState.schedulerTimer) return;

  const config = getBackupConfig();
  if (!config.enabled) {
    console.log("[Backup] Scheduler disabled (BACKUP_CRON_ENABLED=false)");
    return;
  }

  const parsedCron = parseCronExpression(config.cron);
  if (config.runOnBoot) {
    runBackupNow().catch((error) => {
      console.error("[Backup] run on boot failed:", error);
    });
  }

  runtimeState.schedulerTimer = setInterval(() => {
    if (runtimeState.activeTask) return;
    const now = new Date();
    if (!cronMatches(now, parsedCron)) return;

    const currentMinuteKey = minuteKey(now);
    if (currentMinuteKey === runtimeState.lastRunMinuteKey) return;

    runtimeState.lastRunMinuteKey = currentMinuteKey;
    runBackupNow().catch((error) => {
      console.error("[Backup] Scheduled run failed:", error);
    });
  }, config.cronTickMs);

  if (typeof runtimeState.schedulerTimer.unref === "function") {
    runtimeState.schedulerTimer.unref();
  }

  console.log(`[Backup] Scheduler started with cron "${config.cron}"`);
}

export function stopBackupScheduler() {
  if (!runtimeState.schedulerTimer) return;
  clearInterval(runtimeState.schedulerTimer);
  runtimeState.schedulerTimer = null;
  console.log("[Backup] Scheduler stopped");
}

export function getBackupRuntimeState() {
  return {
    activeTask: runtimeState.activeTask,
    hasScheduler: Boolean(runtimeState.schedulerTimer),
  };
}
