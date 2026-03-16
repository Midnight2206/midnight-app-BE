import { ensureSuperAdmin } from "#utils/roleGuards.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import {
  getBackupRuntimeState,
  listBackupsOnDrive,
  resolveBackupFileForDownload,
  runBackupNow,
  runRestoreFromDrive,
  runRestoreFromLocalServerFile,
  runRestoreFromUploadedLocalFile,
} from "#services/backupScheduler.service.js";
import { getBackupConfig } from "#services/backups/config.js";

function assertSuperAdmin(actor) {
  ensureSuperAdmin(actor, "Only SUPER_ADMIN can manage backup and restore");
}

class BackupAdminService {
  listBackups = async ({ actor, query }) => {
    assertSuperAdmin(actor);
    const pageSizeRaw = Number(query?.pageSize || 30);
    const pageSize = Number.isInteger(pageSizeRaw)
      ? Math.max(1, Math.min(pageSizeRaw, 100))
      : 30;
    const pageToken = String(query?.pageToken || "");

    const result = await listBackupsOnDrive({ pageSize, pageToken });
    return {
      ...result,
      state: getBackupRuntimeState(),
    };
  };

  runBackup = async ({ actor }) => {
    assertSuperAdmin(actor);
    return runBackupNow();
  };

  restoreBackup = async ({ actor, body }) => {
    assertSuperAdmin(actor);
    const fileId = String(body.fileId || "").trim();
    const fileName = String(body.fileName || "").trim();
    if (!fileId) {
      throw new AppError({
        message: "fileId is required",
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "BACKUP_FILE_ID_REQUIRED",
      });
    }

    const config = getBackupConfig();
    if (config.storage === "local") {
      return runRestoreFromLocalServerFile({
        fileId,
        actorEmail: actor?.email || "",
      });
    }

    return runRestoreFromDrive({
      fileId,
      fileName,
      actorEmail: actor?.email || "",
    });
  };

  restoreBackupFromUpload = async ({ actor, file }) => {
    assertSuperAdmin(actor);
    if (!file?.content || !Buffer.isBuffer(file.content)) {
      throw new AppError({
        message: "backupFile is required",
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "BACKUP_FILE_REQUIRED",
      });
    }

    return runRestoreFromUploadedLocalFile({
      originalFileName: file.filename || "uploaded_backup.sql.gz.enc",
      fileBuffer: file.content,
      actorEmail: actor?.email || "",
    });
  };

  downloadBackup = async ({ actor, params }) => {
    assertSuperAdmin(actor);
    const fileId = String(params?.fileId || "").trim();
    if (!fileId) {
      throw new AppError({
        message: "fileId is required",
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "BACKUP_FILE_ID_REQUIRED",
      });
    }

    try {
      return await resolveBackupFileForDownload(fileId);
    } catch (error) {
      const message = String(error?.message || "");
      if (message.includes("only supported")) {
        throw new AppError({
          message,
          statusCode: HTTP_CODES.BAD_REQUEST,
          errorCode: "BACKUP_DOWNLOAD_NOT_SUPPORTED",
        });
      }
      if (message.includes("Invalid local backup file id")) {
        throw new AppError({
          message: "Invalid backup file id",
          statusCode: HTTP_CODES.BAD_REQUEST,
          errorCode: "BACKUP_FILE_ID_INVALID",
        });
      }
      throw new AppError({
        message: "Backup file not found",
        statusCode: HTTP_CODES.NOT_FOUND,
        errorCode: "BACKUP_FILE_NOT_FOUND",
      });
    }
  };
}

export default new BackupAdminService();
