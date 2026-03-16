import backupAdminService from "#services/backupAdmin.service.js";
import { HTTP_CODES } from "#src/constants.js";
import { parseMultipartFormData } from "#services/militaries/common.js";

class BackupController {
  listBackups = async (req, res) => {
    const result = await backupAdminService.listBackups({
      actor: req.user,
      query: req.query,
    });

    return res.success({
      data: result,
      message: "Get backup files successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  runBackup = async (req, res) => {
    const result = await backupAdminService.runBackup({
      actor: req.user,
    });

    return res.success({
      data: result,
      message: "Run backup successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  restoreBackup = async (req, res) => {
    const result = await backupAdminService.restoreBackup({
      actor: req.user,
      body: req.body,
    });

    return res.success({
      data: result,
      message: "Restore backup successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  downloadBackup = async (req, res) => {
    const result = await backupAdminService.downloadBackup({
      actor: req.user,
      params: req.params,
    });

    return res.download(result.filePath, result.fileName);
  };

  restoreBackupFromUpload = async (req, res) => {
    const { files } = await parseMultipartFormData(req);
    const backupFile = files?.backupFile;

    const result = await backupAdminService.restoreBackupFromUpload({
      actor: req.user,
      file: backupFile,
    });

    return res.success({
      data: result,
      message: "Restore backup from upload successfully",
      statusCode: HTTP_CODES.OK,
    });
  };
}

export default new BackupController();
