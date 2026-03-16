import { prisma } from "#configs/prisma.config.js";
import { sendSystemEmail } from "#services/email.service.js";
import { asInteger } from "#services/backups/config.js";

export async function getBackupRecipients() {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      roles: {
        some: {
          role: {
            name: "SUPER_ADMIN",
            deletedAt: null,
          },
        },
      },
    },
    select: {
      email: true,
    },
  });

  const dbEmails = users.map((user) => user.email).filter(Boolean);
  const envEmails = String(process.env.BACKUP_NOTIFY_EMAILS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const superAdminEmail = String(process.env.SUPER_ADMIN_EMAIL || "").trim();
  const adminEmail = String(process.env.ADMIN_EMAIL || "").trim();

  return [
    ...new Set(
      [...dbEmails, ...envEmails, superAdminEmail, adminEmail].filter(Boolean),
    ),
  ];
}

export async function sendBackupReportEmail({
  uploadedFile,
  checksum,
  encryptedSizeBytes,
  startedAt,
  finishedAt,
  hostName,
  backupFileName,
  storageType = "drive",
  localFilePath = "",
}) {
  const recipients = await getBackupRecipients();
  if (recipients.length === 0) {
    console.warn(
      "[Backup] No SUPER_ADMIN email found. Skip sending backup report email.",
    );
    return;
  }

  const to = recipients.join(",");
  const subject = `[Backup] ${process.env.DB_NAME || "database"} ${backupFileName}`;
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const isDrive = storageType === "drive";
  const driveLink =
    uploadedFile?.webViewLink ||
    uploadedFile?.webContentLink ||
    (uploadedFile?.id
      ? `https://drive.google.com/file/d/${uploadedFile.id}/view`
      : "");

  const text = [
    "Backup completed successfully.",
    `Host: ${hostName}`,
    `Database: ${process.env.DB_NAME || ""}`,
    `Started at: ${startedAt.toISOString()}`,
    `Finished at: ${finishedAt.toISOString()}`,
    `Duration: ${durationMs}ms`,
    `File name: ${backupFileName}`,
    `File size (encrypted): ${encryptedSizeBytes} bytes`,
    `SHA-256: ${checksum}`,
    isDrive
      ? `Google Drive file ID: ${uploadedFile?.id || ""}`
      : `Local file path: ${localFilePath || ""}`,
    isDrive ? `Google Drive link: ${driveLink}` : "Storage: local",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
      <h2 style="margin:0 0 12px;">Backup completed successfully</h2>
      <p><strong>Host:</strong> ${hostName}</p>
      <p><strong>Database:</strong> ${process.env.DB_NAME || ""}</p>
      <p><strong>Started at:</strong> ${startedAt.toISOString()}</p>
      <p><strong>Finished at:</strong> ${finishedAt.toISOString()}</p>
      <p><strong>Duration:</strong> ${durationMs} ms</p>
      <p><strong>File name:</strong> ${backupFileName}</p>
      <p><strong>Encrypted size:</strong> ${encryptedSizeBytes} bytes</p>
      <p><strong>SHA-256:</strong> <code>${checksum}</code></p>
      ${
        isDrive
          ? `<p><strong>Google Drive file ID:</strong> <code>${uploadedFile?.id || ""}</code></p>
      <p>
        <a href="${driveLink}" target="_blank" rel="noreferrer">Open backup file on Google Drive</a>
      </p>`
          : `<p><strong>Storage:</strong> local</p>
      <p><strong>Local file path:</strong> <code>${localFilePath || ""}</code></p>`
      }
    </div>
  `;

  await sendSystemEmail({
    to,
    subject,
    text,
    html,
  });
}

export async function sendRestoreReportEmail({
  fileId,
  fileName,
  startedAt,
  finishedAt,
  actorEmail,
}) {
  const recipients = await getBackupRecipients();
  if (recipients.length === 0) return;

  const to = recipients.join(",");
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const subject = `[Restore] ${process.env.DB_NAME || "database"} restored from Drive`;

  const text = [
    "Database restore completed successfully.",
    `Database: ${process.env.DB_NAME || ""}`,
    `Started at: ${startedAt.toISOString()}`,
    `Finished at: ${finishedAt.toISOString()}`,
    `Duration: ${durationMs}ms`,
    `Drive file id: ${fileId}`,
    `Drive file name: ${fileName || ""}`,
    `Requested by: ${actorEmail || "unknown"}`,
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
      <h2 style="margin:0 0 12px;">Database restore completed</h2>
      <p><strong>Database:</strong> ${process.env.DB_NAME || ""}</p>
      <p><strong>Started at:</strong> ${startedAt.toISOString()}</p>
      <p><strong>Finished at:</strong> ${finishedAt.toISOString()}</p>
      <p><strong>Duration:</strong> ${durationMs} ms</p>
      <p><strong>Drive file ID:</strong> <code>${fileId}</code></p>
      <p><strong>Drive file name:</strong> ${fileName || ""}</p>
      <p><strong>Requested by:</strong> ${actorEmail || "unknown"}</p>
    </div>
  `;

  await sendSystemEmail({ to, subject, text, html });
}

export async function cleanupLocalBackups(workDir) {
  const keepFiles = asInteger(process.env.BACKUP_KEEP_LOCAL_FILES, 2);
  if (keepFiles < 0) return;

  const fs = await import("fs/promises");
  const path = await import("path");
  const entries = await fs.readdir(workDir, { withFileTypes: true });
  const encryptedFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".enc"))
    .map((entry) => path.join(workDir, entry.name));

  if (encryptedFiles.length <= keepFiles) return;

  const withStats = await Promise.all(
    encryptedFiles.map(async (file) => ({
      file,
      stat: await fs.stat(file),
    })),
  );

  withStats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  const stale = withStats.slice(keepFiles);
  await Promise.all(stale.map((item) => fs.rm(item.file, { force: true })));
}
