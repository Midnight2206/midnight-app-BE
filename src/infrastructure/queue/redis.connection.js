import IORedis from "ioredis";

let connection = null;

function createRedisConnection() {
  const redisUrl = process.env.REDIS_URL;
  const instance = redisUrl
    ? new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
      })
    : new IORedis({
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: Number(process.env.REDIS_PORT || 6379),
        username: process.env.REDIS_USERNAME || undefined,
        password: process.env.REDIS_PASSWORD || undefined,
        db: Number(process.env.REDIS_DB || 0),
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
      });

  instance.on("error", (error) => {
    console.error("[Redis] connection error:", error?.message || error);
  });

  return instance;
}

export function getRedisConnection() {
  if (!connection) {
    connection = createRedisConnection();
  }
  return connection;
}

export async function closeRedisConnection() {
  if (!connection) return;
  await connection.quit().catch(async () => {
    await connection.disconnect();
  });
  connection = null;
}
