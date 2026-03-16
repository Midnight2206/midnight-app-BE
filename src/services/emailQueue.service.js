const DEFAULT_POLL_INTERVAL_MS = 400;

class InMemoryEmailQueue {
  constructor() {
    this.jobs = [];
    this.running = false;
    this.timer = null;
    this.handler = null;
  }

  start(handler) {
    if (typeof handler !== "function") {
      throw new Error("Email queue handler must be a function");
    }

    this.handler = handler;

    if (this.running) return;

    this.running = true;
    this.timer = setInterval(() => {
      this._drain().catch((error) => {
        console.error("[EmailQueue] drain error:", error);
      });
    }, DEFAULT_POLL_INTERVAL_MS);

    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  stop() {
    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  enqueue(payload, options = {}) {
    const maxAttempts = Number(options.maxAttempts || 3);

    const job = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      attempts: 0,
      maxAttempts,
      payload,
      availableAt: Date.now(),
      createdAt: new Date().toISOString(),
    };

    this.jobs.push(job);
    return job.id;
  }

  getStats() {
    return {
      pending: this.jobs.length,
      running: this.running,
    };
  }

  async _drain() {
    if (!this.running || !this.handler || this.jobs.length === 0) return;

    const now = Date.now();
    const readyIndex = this.jobs.findIndex((job) => job.availableAt <= now);
    if (readyIndex < 0) return;

    const [job] = this.jobs.splice(readyIndex, 1);
    await this._processJob(job);
  }

  async _processJob(job) {
    try {
      job.attempts += 1;
      await this.handler(job.payload, {
        id: job.id,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
      });
    } catch (error) {
      if (job.attempts < job.maxAttempts) {
        const delayMs = Math.min(15_000, 1000 * 2 ** (job.attempts - 1));
        job.availableAt = Date.now() + delayMs;
        this.jobs.push(job);
        return;
      }

      console.error("[EmailQueue] job failed permanently", {
        id: job.id,
        attempts: job.attempts,
        error: error?.message || error,
      });
    }
  }
}

const emailQueue = new InMemoryEmailQueue();

export default emailQueue;
