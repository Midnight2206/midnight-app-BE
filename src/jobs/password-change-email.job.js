import { sendSystemEmail } from "#services/email.service.js";

export const PASSWORD_CHANGE_EMAIL_QUEUE_NAME = "email.password-change";
export const PASSWORD_CHANGE_EMAIL_JOB_NAME = "send-password-change-email";

export default {
  queueName: PASSWORD_CHANGE_EMAIL_QUEUE_NAME,
  jobName: PASSWORD_CHANGE_EMAIL_JOB_NAME,
  concurrency: Number(process.env.PASSWORD_CHANGE_EMAIL_JOB_CONCURRENCY || 2),
  defaultJobOptions: {
    attempts: Number(process.env.PASSWORD_CHANGE_EMAIL_JOB_ATTEMPTS || 3),
    backoff: {
      type: "exponential",
      delay: Number(process.env.PASSWORD_CHANGE_EMAIL_JOB_BACKOFF_MS || 1000),
    },
  },
  processor: async (job) => {
    await sendSystemEmail(job.data);
    return {
      delivered: true,
      to: job.data?.to,
    };
  },
};
