import { sendVerifyEmail } from "#services/email.service.js";

export const VERIFY_EMAIL_QUEUE_NAME = "email.verify";
export const VERIFY_EMAIL_JOB_NAME = "send-verify-email";

export default {
  queueName: VERIFY_EMAIL_QUEUE_NAME,
  jobName: VERIFY_EMAIL_JOB_NAME,
  concurrency: Number(process.env.VERIFY_EMAIL_JOB_CONCURRENCY || 2),
  defaultJobOptions: {
    attempts: Number(process.env.VERIFY_EMAIL_JOB_ATTEMPTS || 3),
    backoff: {
      type: "exponential",
      delay: Number(process.env.VERIFY_EMAIL_JOB_BACKOFF_MS || 1000),
    },
  },
  processor: async (job) => {
    await sendVerifyEmail(job.data);
    return {
      delivered: true,
      to: job.data?.to,
    };
  },
};
