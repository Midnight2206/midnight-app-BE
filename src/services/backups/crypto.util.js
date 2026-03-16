import fs from "fs";
import fsp from "fs/promises";
import crypto from "crypto";
import { createGzip, createGunzip } from "zlib";
import { pipeline } from "stream/promises";

const HEADER_MAGIC = Buffer.from("BKP1");

export function buildTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}_${hour}${minute}${second}`;
}

export async function gzipFile(sourcePath, outputPath) {
  await pipeline(
    fs.createReadStream(sourcePath),
    createGzip({ level: 9 }),
    fs.createWriteStream(outputPath),
  );
}

export async function gunzipFile(sourcePath, outputPath) {
  await pipeline(
    fs.createReadStream(sourcePath),
    createGunzip(),
    fs.createWriteStream(outputPath),
  );
}

export async function encryptFile({ sourcePath, outputPath, key }) {
  const iv = crypto.randomBytes(12);
  const tmpCipherPath = `${outputPath}.tmp_cipher`;
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  await pipeline(
    fs.createReadStream(sourcePath),
    cipher,
    fs.createWriteStream(tmpCipherPath),
  );

  const tag = cipher.getAuthTag();

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(outputPath);
    out.on("error", reject);
    out.write(Buffer.concat([HEADER_MAGIC, iv]));

    const tmpIn = fs.createReadStream(tmpCipherPath);
    tmpIn.on("error", reject);
    tmpIn.on("end", () => {
      out.end(tag);
    });
    tmpIn.pipe(out, { end: false });
    out.on("finish", resolve);
  });

  await fsp.rm(tmpCipherPath, { force: true });
}

export async function decryptFile({ sourcePath, outputPath, key }) {
  const sourceStat = await fsp.stat(sourcePath);
  const minLength = HEADER_MAGIC.length + 12 + 16;
  if (sourceStat.size <= minLength) {
    throw new Error("Encrypted backup file is too small or invalid");
  }

  const fd = await fsp.open(sourcePath, "r");
  let headerBuffer;
  let footerBuffer;

  try {
    headerBuffer = Buffer.alloc(HEADER_MAGIC.length + 12);
    footerBuffer = Buffer.alloc(16);
    await fd.read(headerBuffer, 0, headerBuffer.length, 0);
    await fd.read(footerBuffer, 0, footerBuffer.length, sourceStat.size - 16);
  } finally {
    await fd.close();
  }

  const magic = headerBuffer.subarray(0, HEADER_MAGIC.length);
  if (!magic.equals(HEADER_MAGIC)) {
    throw new Error("Invalid encrypted backup header");
  }

  const iv = headerBuffer.subarray(HEADER_MAGIC.length);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(footerBuffer);

  const encryptedContentStart = HEADER_MAGIC.length + 12;
  const encryptedContentEnd = sourceStat.size - 16 - 1;

  await pipeline(
    fs.createReadStream(sourcePath, {
      start: encryptedContentStart,
      end: encryptedContentEnd,
    }),
    decipher,
    fs.createWriteStream(outputPath),
  );
}

export async function sha256File(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

