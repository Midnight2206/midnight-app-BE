import "dotenv/config";
import { runRestoreFromDrive } from "#services/backupScheduler.service.js";

function parseArgs(argv) {
  const map = {};
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const [key, value] = token.slice(2).split("=");
    if (!key) continue;
    map[key] = value ?? "";
  }
  return map;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fileId =
    args.fileId ||
    process.env.BACKUP_RESTORE_FILE_ID ||
    process.env.BACKUP_RESTORE_DRIVE_FILE_ID;

  if (!fileId) {
    throw new Error(
      "Missing restore file id. Use --fileId=<drive_file_id> or set BACKUP_RESTORE_FILE_ID",
    );
  }

  await runRestoreFromDrive({ fileId });
}

main().catch((error) => {
  console.error("[Backup] Restore failed:", error);
  process.exit(1);
});
