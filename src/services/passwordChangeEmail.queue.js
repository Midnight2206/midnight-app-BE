import {
  PASSWORD_CHANGE_EMAIL_JOB_NAME,
  PASSWORD_CHANGE_EMAIL_QUEUE_NAME,
} from "#src/jobs/password-change-email.job.js";
import { enqueueJob } from "#src/queues/bullmq.manager.js";

export async function enqueuePasswordChangeEmail(payload) {
  const job = await enqueueJob({
    queueName: PASSWORD_CHANGE_EMAIL_QUEUE_NAME,
    jobName: PASSWORD_CHANGE_EMAIL_JOB_NAME,
    data: payload,
  });

  return {
    jobId: job.id,
    queueName: PASSWORD_CHANGE_EMAIL_QUEUE_NAME,
  };
}
