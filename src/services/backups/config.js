import crypto from "crypto";

const DEFAULTS = {
  CRON: "0 2 * * *",
  TICK_MS: 30_000,
  DRIVE_SCOPE: "https://www.googleapis.com/auth/drive.file",
  WORK_DIR: "/tmp/f8-backups",
  STORAGE: "drive",
};

export function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

export function asInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getBackupConfig() {
  return {
    cron: process.env.BACKUP_CRON || DEFAULTS.CRON,
    cronTickMs: asInteger(process.env.BACKUP_CRON_TICK_MS, DEFAULTS.TICK_MS),
    runOnBoot: asBoolean(process.env.BACKUP_RUN_ON_BOOT, false),
    enabled: asBoolean(process.env.BACKUP_CRON_ENABLED, false),
    workDir: process.env.BACKUP_WORK_DIR || DEFAULTS.WORK_DIR,
    keepLocalFiles: asInteger(process.env.BACKUP_KEEP_LOCAL_FILES, 2),
    storage: String(process.env.BACKUP_STORAGE || DEFAULTS.STORAGE)
      .trim()
      .toLowerCase(),
    driveScope: process.env.GDRIVE_SCOPE || DEFAULTS.DRIVE_SCOPE,
    mysqlDumpBin: process.env.BACKUP_MYSQLDUMP_BIN || "mysqldump",
    mysqlBin: process.env.BACKUP_MYSQL_BIN || "mysql",
  };
}

export function getEncryptionKey() {
  const secret = String(process.env.BACKUP_ENCRYPTION_KEY || "");
  if (!secret) {
    throw new Error("BACKUP_ENCRYPTION_KEY is required for backup encryption");
  }
  return crypto.createHash("sha256").update(secret).digest();
}
