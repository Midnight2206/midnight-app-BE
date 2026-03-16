/**
 * Check if integration tests can run (DB and optionally Redis reachable).
 * Use in beforeAll: if (!(await canRunIntegration())) throw new Error("...");
 * Or use to decide describe.skip vs describe.
 */
let cached = null;

export async function canRunIntegration() {
  if (cached !== null) return cached;

  try {
    const { prisma } = await import("#configs/prisma.config.js");
    await prisma.$queryRawUnsafe("SELECT 1");
    cached = true;
    return true;
  } catch (err) {
    cached = false;
    return false;
  }
}

const SKIP_MESSAGE =
  "Integration tests skipped. Set RUN_INTEGRATION_TESTS=1 and ensure DB (and Redis for rate-limit tests) are running. See .env.test and docs.";

export function logSkipIfNotRequested() {
  if (process.env.RUN_INTEGRATION_TESTS !== "1") {
    console.log(SKIP_MESSAGE);
  }
}
