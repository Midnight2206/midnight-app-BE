import { RateLimiterRedis } from "rate-limiter-flexible";
import { getRedisConnection } from "#src/queues/redis.connection.js";

function getIp(req) {
  // Express uses `req.ip` + trust proxy; fallback for safety
  return (
    req.ip ||
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

export function createRateLimiter({
  windowMs = 60000,
  maxRequests = 100,
  message = "Too many requests",
  keyPrefix = "rl",
  keyGenerator,
  softFail = true,
} = {}) {
  const redis = getRedisConnection();
  const durationSec = Math.max(1, Math.ceil(windowMs / 1000));

  const limiter = new RateLimiterRedis({
    storeClient: redis,
    keyPrefix,
    points: maxRequests,
    duration: durationSec,
    execEvenly: false,
  });

  return async (req, res, next) => {
    const ip = getIp(req);
    const key =
      typeof keyGenerator === "function" ? keyGenerator(req, ip) : ip;

    try {
      await limiter.consume(key, 1);
      return next();
    } catch (err) {
      // If Redis is down/misconfigured, we can choose not to block the whole API.
      if (softFail && (err?.name === "RateLimiterRes" || err?.msBeforeNext)) {
        // This is a real rate-limit rejection → should block
      } else if (softFail) {
        console.warn("[RateLimit] soft-fail:", err?.message || err);
        return next();
      }

      const msBeforeNext = Number(err?.msBeforeNext || 0);
      if (msBeforeNext > 0) {
        res.set("Retry-After", String(Math.ceil(msBeforeNext / 1000)));
      }

      return res.status(429).json({
        success: false,
        message,
        errorCode: "TOO_MANY_REQUESTS",
      });
    }
  };
}

export const apiRateLimiter = createRateLimiter({
  windowMs: 60000,
  maxRequests: 100,
  message: "Too many requests",
  keyPrefix: "rl_api",
});

export const authRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  maxRequests: 5,
  message: "Too many auth attempts. Please try again later.",
  keyPrefix: "rl_auth",
  keyGenerator: (req, ip) => `${ip}:${req.originalUrl || req.url}`,
  softFail: false,
});

export const refreshRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  maxRequests: 10,
  message: "Too many refresh attempts. Please try again later.",
  keyPrefix: "rl_refresh",
  keyGenerator: (req, ip) => `${ip}:${req.originalUrl || req.url}`,
  softFail: false,
});
