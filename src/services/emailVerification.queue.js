import {
  VERIFY_EMAIL_JOB_NAME,
  VERIFY_EMAIL_QUEUE_NAME,
} from "#src/jobs/verify-email.job.js";
import { enqueueJob } from "#src/queues/bullmq.manager.js";

export async function enqueueVerifyEmail(payload) {
  const job = await enqueueJob({
    queueName: VERIFY_EMAIL_QUEUE_NAME,
    jobName: VERIFY_EMAIL_JOB_NAME,
    data: payload,
  });

  return {
    jobId: job.id,
    queueName: VERIFY_EMAIL_QUEUE_NAME,
  };
}
