import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import YAML from "yaml";
import swaggerUi from "swagger-ui-express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const docsDirectory = path.resolve(__dirname, "../../docs");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Portfolio API",
      version: "1.0.0",
      description: "API documentation for portfolio project",
    },
    servers: [
      {
        url: "http://localhost:3000/api",
      },
    ],
    components: {
      securitySchemes: {
        accessToken: {
          type: "apiKey",
          in: "cookie",
          name: "accessToken",
        },
        refreshToken: {
          type: "apiKey",
          in: "cookie",
          name: "refreshToken",
        },
      },
    },
  },
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeSwaggerFragment(target, source) {
  if (Array.isArray(target) && Array.isArray(source)) {
    return [...target, ...source];
  }

  if (isPlainObject(target) && isPlainObject(source)) {
    const merged = { ...target };
    for (const [key, value] of Object.entries(source)) {
      merged[key] =
        key in merged ? mergeSwaggerFragment(merged[key], value) : value;
    }
    return merged;
  }

  return source;
}

function extractSwaggerYamlBlocks(fileContent) {
  const blocks = [];
  const blockPattern = /\/\*\*([\s\S]*?)\*\//g;
  let match = blockPattern.exec(fileContent);

  while (match) {
    const lines = match[1]
      .split("\n")
      .map((line) => line.replace(/^\s*\*\s?/, ""));
    const swaggerIndex = lines.findIndex((line) =>
      line.trim().startsWith("@swagger"),
    );

    if (swaggerIndex >= 0) {
      const afterMarker = lines[swaggerIndex].replace(/^.*@swagger\s*/, "");
      const yamlLines = [
        ...(afterMarker ? [afterMarker] : []),
        ...lines.slice(swaggerIndex + 1),
      ];
      const yamlText = yamlLines.join("\n").trim();
      if (yamlText) blocks.push(yamlText);
    }

    match = blockPattern.exec(fileContent);
  }

  return blocks;
}

function loadSwaggerSpec() {
  const spec = structuredClone(options.definition);
  const docFiles = fs
    .readdirSync(docsDirectory)
    .filter((file) => file.endsWith(".swagger.js"))
    .sort();

  for (const file of docFiles) {
    const absolutePath = path.join(docsDirectory, file);
    const fileContent = fs.readFileSync(absolutePath, "utf8");
    const yamlBlocks = extractSwaggerYamlBlocks(fileContent);

    for (const yamlText of yamlBlocks) {
      try {
        const parsed = YAML.parse(yamlText);
        if (parsed && typeof parsed === "object") {
          Object.assign(spec, mergeSwaggerFragment(spec, parsed));
        }
      } catch (error) {
        throw new Error(
          `Failed to parse Swagger block in ${file}: ${error.message}`,
        );
      }
    }
  }

  return spec;
}

const swaggerSpec = loadSwaggerSpec();

export function setupSwagger(app) {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}
