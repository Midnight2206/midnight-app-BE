import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import jwt from "jsonwebtoken";
import { getBackupConfig } from "#services/backups/config.js";

function normalizePrivateKey(raw) {
  return String(raw || "").replace(/\\n/g, "\n").trim();
}

function readServiceAccountFile() {
  const keyFile = String(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "").trim();
  if (!keyFile) return null;
  const absolutePath = path.isAbsolute(keyFile)
    ? keyFile
    : path.resolve(process.cwd(), keyFile);
  const raw = fs.readFileSync(absolutePath, "utf8");
  return JSON.parse(raw);
}

function resolveGoogleCredentials() {
  const fromFile = readServiceAccountFile();
  const authMode = String(process.env.GDRIVE_AUTH_MODE || "auto")
    .trim()
    .toLowerCase();

  const clientEmail =
    process.env.GDRIVE_SERVICE_ACCOUNT_EMAIL ||
    fromFile?.client_email ||
    null;
  const privateKey = normalizePrivateKey(
    process.env.GDRIVE_PRIVATE_KEY || fromFile?.private_key || "",
  );
  const folderId =
    process.env.GDRIVE_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID || null;
  const tokenUri =
    process.env.GDRIVE_TOKEN_URI || "https://oauth2.googleapis.com/token";
  const oauthClientId = process.env.GDRIVE_OAUTH_CLIENT_ID || null;
  const oauthClientSecret = process.env.GDRIVE_OAUTH_CLIENT_SECRET || null;
  const oauthRefreshToken = process.env.GDRIVE_OAUTH_REFRESH_TOKEN || null;
  const oauthTokenUri =
    process.env.GDRIVE_OAUTH_TOKEN_URI || "https://oauth2.googleapis.com/token";

  const hasOauthCredentials =
    Boolean(oauthClientId) &&
    Boolean(oauthClientSecret) &&
    Boolean(oauthRefreshToken);
  const hasServiceAccountCredentials = Boolean(clientEmail) && Boolean(privateKey);

  let resolvedAuthMode = "service_account";
  if (authMode === "oauth_refresh_token") {
    resolvedAuthMode = "oauth_refresh_token";
  } else if (authMode === "service_account") {
    resolvedAuthMode = "service_account";
  } else if (hasOauthCredentials) {
    resolvedAuthMode = "oauth_refresh_token";
  }

  return {
    authMode: resolvedAuthMode,
    clientEmail,
    privateKey,
    folderId,
    tokenUri,
    oauthClientId,
    oauthClientSecret,
    oauthRefreshToken,
    oauthTokenUri,
    hasOauthCredentials,
    hasServiceAccountCredentials,
  };
}

export async function getGoogleAccessToken() {
  const { driveScope } = getBackupConfig();
  const credentials = resolveGoogleCredentials();

  if (credentials.authMode === "oauth_refresh_token") {
    const {
      oauthClientId,
      oauthClientSecret,
      oauthRefreshToken,
      oauthTokenUri,
      hasOauthCredentials,
    } = credentials;
    if (!hasOauthCredentials) {
      throw new Error(
        "GDRIVE_OAUTH_CLIENT_ID, GDRIVE_OAUTH_CLIENT_SECRET and GDRIVE_OAUTH_REFRESH_TOKEN are required for GDRIVE_AUTH_MODE=oauth_refresh_token",
      );
    }

    const body = new URLSearchParams({
      client_id: oauthClientId,
      client_secret: oauthClientSecret,
      refresh_token: oauthRefreshToken,
      grant_type: "refresh_token",
    });

    const response = await fetch(oauthTokenUri, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(
        `Failed to get Google OAuth access token (${response.status}): ${responseText}`,
      );
    }

    const data = await response.json();
    if (!data.access_token) {
      throw new Error("Google OAuth token response missing access_token");
    }
    return {
      accessToken: data.access_token,
      authMode: credentials.authMode,
    };
  }

  const {
    clientEmail,
    privateKey,
    tokenUri,
    hasServiceAccountCredentials,
    hasOauthCredentials,
  } = credentials;

  if (!hasServiceAccountCredentials) {
    const oauthHint = hasOauthCredentials
      ? " GDRIVE_AUTH_MODE is currently forcing service_account."
      : "";
    throw new Error(
      `GDRIVE_SERVICE_ACCOUNT_EMAIL and GDRIVE_PRIVATE_KEY are required for service account mode.${oauthHint}`,
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: clientEmail,
      scope: driveScope,
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    },
    privateKey,
    { algorithm: "RS256" },
  );

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Failed to get Google access token (${response.status}): ${responseText}`,
    );
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error("Google access token response missing access_token");
  }
  return {
    accessToken: data.access_token,
    authMode: credentials.authMode,
  };
}

export async function uploadFileToGoogleDrive({ filePath, fileName }) {
  const { folderId } = resolveGoogleCredentials();
  if (!folderId) throw new Error("GDRIVE_FOLDER_ID is required");

  const { accessToken, authMode } = await getGoogleAccessToken();
  const fileBuffer = await fsp.readFile(filePath);
  const boundary = `backup_boundary_${Date.now()}`;

  const metadata = {
    name: fileName,
    parents: [folderId],
  };

  const start = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
      metadata,
    )}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
    "utf8",
  );
  const end = Buffer.from(`\r\n--${boundary}--`, "utf8");
  const body = Buffer.concat([start, fileBuffer, end]);

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,size,createdTime,modifiedTime,webViewLink,webContentLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  if (!response.ok) {
    const responseText = await response.text();
    const isServiceAccountQuotaError =
      authMode === "service_account" &&
      response.status === 403 &&
      responseText.includes("storageQuotaExceeded") &&
      responseText.includes("Service Accounts do not have storage quota");
    if (isServiceAccountQuotaError) {
      throw new Error(
        "Failed to upload backup to Google Drive (403): Service Account cannot upload to personal My Drive due to zero quota. Switch backup auth to OAuth refresh token (GDRIVE_AUTH_MODE=oauth_refresh_token) or use a Google Workspace Shared Drive.",
      );
    }
    throw new Error(
      `Failed to upload backup to Google Drive (${response.status}): ${responseText}`,
    );
  }

  return response.json();
}

export async function downloadFileFromGoogleDrive({ fileId, outputPath }) {
  if (!fileId) throw new Error("fileId is required to download backup");
  const { accessToken } = await getGoogleAccessToken();

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Failed to download backup from Google Drive (${response.status}): ${responseText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  await fsp.writeFile(outputPath, Buffer.from(arrayBuffer));
}

export async function listBackupFilesFromGoogleDrive({
  pageSize = 50,
  pageToken = "",
} = {}) {
  const { folderId } = resolveGoogleCredentials();
  if (!folderId) throw new Error("GDRIVE_FOLDER_ID is required");

  const { accessToken } = await getGoogleAccessToken();
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed=false`,
    pageSize: String(pageSize),
    orderBy: "createdTime desc",
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
    fields:
      "nextPageToken,files(id,name,size,createdTime,modifiedTime,mimeType,webViewLink,webContentLink)",
  });
  if (pageToken) params.set("pageToken", pageToken);

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Failed to list backups from Google Drive (${response.status}): ${responseText}`,
    );
  }

  const data = await response.json();
  const files = Array.isArray(data.files)
    ? data.files.filter((file) => file.name?.endsWith(".sql.gz.enc"))
    : [];

  return {
    files,
    nextPageToken: data.nextPageToken || null,
  };
}
