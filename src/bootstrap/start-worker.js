import "dotenv/config";
import {
  startBullWorkers,
  stopBullWorkers,
} from "#src/infrastructure/queue/bullmq.manager.js";

let shuttingDown = false;

async function bootstrap() {
  await startBullWorkers();
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[Worker] received ${signal}, shutting down...`);
  try {
    await stopBullWorkers();
  } catch (error) {
    console.error("[Worker] failed to stop workers cleanly:", error);
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

bootstrap().catch((error) => {
  console.error("Failed to bootstrap worker:", error);
  process.exit(1);
});
