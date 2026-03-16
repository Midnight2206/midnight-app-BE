import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function validateJobDefinition(definition, fileName) {
  if (!definition || typeof definition !== "object") {
    throw new Error(`Job definition in ${fileName} must export an object`);
  }

  if (!definition.queueName || typeof definition.queueName !== "string") {
    throw new Error(`Job ${fileName} missing queueName`);
  }

  if (!definition.jobName || typeof definition.jobName !== "string") {
    throw new Error(`Job ${fileName} missing jobName`);
  }

  if (typeof definition.processor !== "function") {
    throw new Error(`Job ${fileName} missing processor(job)`);
  }

  return definition;
}

export async function loadJobDefinitions() {
  const files = fs
    .readdirSync(__dirname)
    .filter((file) => file.endsWith(".job.js"));

  const definitions = [];
  const keySet = new Set();

  for (const file of files) {
    const filePath = path.join(__dirname, file);
    const moduleUrl = pathToFileURL(filePath).href;
    const imported = await import(moduleUrl);
    const definition = validateJobDefinition(imported.default, file);

    const key = `${definition.queueName}:${definition.jobName}`;
    if (keySet.has(key)) {
      throw new Error(`Duplicate job definition key: ${key}`);
    }

    keySet.add(key);
    definitions.push(definition);
  }

  return definitions;
}
