import { prisma } from "#configs/prisma.config.js";

let hasTransferLogTableCache = null;

export async function hasMilitaryTransferLogTable() {
  if (typeof hasTransferLogTableCache === "boolean") {
    return hasTransferLogTableCache;
  }

  try {
    const rows = await prisma.$queryRawUnsafe(
      `
        SELECT COUNT(*) AS total
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'military_transfer_logs'
      `,
    );
    hasTransferLogTableCache = Number(rows?.[0]?.total || 0) > 0;
    return hasTransferLogTableCache;
  } catch {
    hasTransferLogTableCache = false;
    return false;
  }
}
