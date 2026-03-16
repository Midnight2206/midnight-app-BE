import { Queue, Worker, QueueEvents } from "bullmq";
import {
  closeRedisConnection,
  getRedisConnection,
} from "#src/queues/redis.connection.js";
import { loadJobDefinitions } from "#src/jobs/index.js";

const queueMap = new Map();
const workers = [];
const queueEvents = [];
let started = false;

function getOrCreateQueue(queueName, defaultJobOptions = {}) {
  if (queueMap.has(queueName)) {
    return queueMap.get(queueName);
  }

  const queue = new Queue(queueName, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 200,
      ...defaultJobOptions,
    },
  });

  queueMap.set(queueName, queue);
  return queue;
}

export async function enqueueJob({
  queueName,
  jobName,
  data,
  options = {},
}) {
  const queue = getOrCreateQueue(queueName);
  const job = await queue.add(jobName, data, options);
  return job;
}

export async function startBullWorkers() {
  if (started) return;

  const definitions = await loadJobDefinitions();

  for (const definition of definitions) {
    const queue = getOrCreateQueue(
      definition.queueName,
      definition.defaultJobOptions || {},
    );

    const events = new QueueEvents(definition.queueName, {
      connection: getRedisConnection(),
    });
    queueEvents.push(events);

    events.on("failed", ({ jobId, failedReason }) => {
      console.error(`[BullMQ][${definition.queueName}] job failed`, {
        jobId,
        failedReason,
      });
    });

    const worker = new Worker(
      definition.queueName,
      async (job) => {
        if (job.name !== definition.jobName) return null;
        return definition.processor(job);
      },
      {
        connection: getRedisConnection(),
        concurrency: Number(definition.concurrency || 1),
      },
    );

    worker.on("error", (error) => {
      console.error(`[BullMQ][${definition.queueName}] worker error`, error);
    });

    workers.push(worker);

    console.log(
      `[BullMQ] worker started: queue=${definition.queueName} job=${definition.jobName}`,
    );
  }

  started = true;
}

export async function stopBullWorkers() {
  await Promise.all(workers.map((worker) => worker.close()));
  await Promise.all(queueEvents.map((events) => events.close()));
  await Promise.all([...queueMap.values()].map((queue) => queue.close()));
  await closeRedisConnection();
  workers.length = 0;
  queueEvents.length = 0;
  queueMap.clear();
  started = false;
}
