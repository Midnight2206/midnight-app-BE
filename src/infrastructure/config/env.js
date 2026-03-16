/**
 * Central environment validation. Load first in server.js so invalid config fails fast.
 * Uses zod for parsing and safe defaults.
 */
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    DB_HOST: z.string().min(1).default("127.0.0.1"),
    DB_PORT: z.coerce.number().int().min(1).default(3306),
    DB_USER: z.string().min(1).optional(),
    DB_PASSWORD: z.string().optional(),
    DB_NAME: z.string().min(1).optional(),

    JWT_ACCESS_SECRET: z.string().min(1).optional(),
    JWT_ACCESS_EXPIRES: z.coerce
      .number()
      .int()
      .positive()
      .transform((v) => (v > 10000 ? Math.floor(v / 1000) : v))
      .pipe(z.number().int().min(60).max(86400))
      .default(900),
    JWT_EMAIL_SECRET: z.string().min(1).optional(),
    JWT_EMAIL_EXPIRES: z.coerce
      .number()
      .int()
      .positive()
      .transform((v) => (v > 10000 ? Math.floor(v / 1000) : v))
      .pipe(z.number().int().min(300).max(86400 * 7))
      .default(3600),
    REFRESH_TOKEN_EXPIRES: z.coerce
      .number()
      .int()
      .min(86400_000)
      .max(86400 * 365 * 1000)
      .default(604800_000),

    ALLOW_ORIGIN: z.string().optional(),

    REDIS_HOST: z.string().default("127.0.0.1"),
    REDIS_PORT: z.coerce.number().int().min(1).default(6379),
    REDIS_DB: z.coerce.number().int().min(0).default(0),
    REDIS_URL: z.string().url().optional().or(z.literal("")),
  })
  .passthrough();

let cached = null;

function getEnv() {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Environment validation failed: ${msg}`);
  }

  cached = parsed.data;
  return cached;
}

export function loadEnv() {
  const env = getEnv();

  if (env.NODE_ENV === "production" && !env.ALLOW_ORIGIN?.trim()) {
    throw new Error(
      "ALLOW_ORIGIN is required in production. Set at least one allowed origin.",
    );
  }

  return env;
}

export function getEnvConfig() {
  return getEnv();
}
