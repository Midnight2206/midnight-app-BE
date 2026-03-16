import { PrismaClient } from "#src/generated/prisma/index.js";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

const requiredEnv = ["DB_USER", "DB_PASSWORD", "DB_NAME"];
for (const envKey of requiredEnv) {
  if (!process.env[envKey]) {
    throw new Error(`${envKey} is required in environment variables`);
  }
}

const adapter = new PrismaMariaDb({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT ?? 5),
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT ?? 10000),
  acquireTimeout: Number(process.env.DB_ACQUIRE_TIMEOUT ?? 10000),
  initializationTimeout: Number(process.env.DB_INIT_TIMEOUT ?? 10000),
});

const prisma = new PrismaClient({ adapter });
export { prisma };
