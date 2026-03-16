export default async function globalTeardown() {
  // Best-effort cleanup to help Jest exit cleanly.
  try {
    const { prisma } = await import("../configs/prisma.config.js");
    await prisma.$disconnect();
  } catch {
    // ignore
  }

  try {
    const { closeRedisConnection, getRedisConnection } = await import(
      "../queues/redis.connection.js"
    );

    const timeoutMs = 1000;
    await Promise.race([
      closeRedisConnection(),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);

    // If Redis still keeps event loop alive, hard disconnect.
    try {
      const redis = getRedisConnection();
      redis.disconnect();
    } catch {
      // ignore
    }
  } catch {
    // ignore
  }
}

