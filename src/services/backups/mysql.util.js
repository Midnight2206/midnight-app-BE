import fs from "fs";
import { spawn } from "child_process";
import { getBackupConfig } from "#services/backups/config.js";

function readDbConfig() {
  return {
    host: process.env.DB_HOST || "127.0.0.1",
    port: String(process.env.DB_PORT || "3306"),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || "",
    name: process.env.DB_NAME,
  };
}

export async function runMysqldump(outputPath) {
  const { mysqlDumpBin } = getBackupConfig();
  const db = readDbConfig();
  if (!db.user || !db.name) {
    throw new Error("DB_USER and DB_NAME are required to run mysqldump");
  }

  const baseArgs = [
    `--host=${db.host}`,
    `--port=${db.port}`,
    `--user=${db.user}`,
    "--single-transaction",
    "--quick",
    "--routines",
    "--events",
    "--triggers",
    "--databases",
    db.name,
  ];

  const dumpWithArgs = (args) =>
    new Promise((resolve, reject) => {
      const child = spawn(mysqlDumpBin, args, {
        env: {
          ...process.env,
          MYSQL_PWD: db.password,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const outStream = fs.createWriteStream(outputPath);
      let stderrText = "";
      child.stdout.pipe(outStream);
      child.stderr.on("data", (chunk) => {
        stderrText += chunk.toString("utf8");
      });
      child.on("error", (error) => reject(error));
      child.on("close", (code) => {
        outStream.end();
        if (code === 0) return resolve();
        reject(
          new Error(
            `mysqldump failed with code ${code}. ${stderrText || "No stderr output."}`,
          ),
        );
      });
    });

  try {
    await dumpWithArgs([...baseArgs.slice(0, -2), "--set-gtid-purged=OFF", ...baseArgs.slice(-2)]);
  } catch (error) {
    const message = String(error?.message || "");
    const isUnsupportedGtidFlag =
      message.includes("unknown variable 'set-gtid-purged=OFF'") ||
      message.includes("unknown option '--set-gtid-purged=OFF'");

    if (!isUnsupportedGtidFlag) throw error;

    try {
      fs.rmSync(outputPath, { force: true });
    } catch {
      // Ignore cleanup errors; retry will rewrite the file anyway.
    }
    await dumpWithArgs(baseArgs);
  }
}

export async function runMysqlRestore(sqlPath) {
  const { mysqlBin } = getBackupConfig();
  const db = readDbConfig();
  if (!db.user || !db.name) {
    throw new Error("DB_USER and DB_NAME are required to restore database");
  }

  await new Promise((resolve, reject) => {
    const args = [
      `--host=${db.host}`,
      `--port=${db.port}`,
      `--user=${db.user}`,
      db.name,
    ];

    const child = spawn(mysqlBin, args, {
      env: {
        ...process.env,
        MYSQL_PWD: db.password,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderrText = "";
    child.stdout.on("data", () => {});
    child.stderr.on("data", (chunk) => {
      stderrText += chunk.toString("utf8");
    });
    fs.createReadStream(sqlPath).pipe(child.stdin);
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(
        new Error(
          `mysql restore failed with code ${code}. ${stderrText || "No stderr output."}`,
        ),
      );
    });
  });
}
