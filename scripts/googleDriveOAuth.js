import process from "process";

const TOKEN_URI = process.env.GDRIVE_OAUTH_TOKEN_URI || "https://oauth2.googleapis.com/token";
const REDIRECT_URI =
  process.env.GDRIVE_OAUTH_REDIRECT_URI || "http://127.0.0.1:53682/oauth2callback";
const SCOPE = process.env.GDRIVE_SCOPE || "https://www.googleapis.com/auth/drive.file";

function getOAuthClientConfig() {
  const clientId = String(process.env.GDRIVE_OAUTH_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GDRIVE_OAUTH_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing GDRIVE_OAUTH_CLIENT_ID or GDRIVE_OAUTH_CLIENT_SECRET in environment.",
    );
  }
  return { clientId, clientSecret };
}

function buildAuthUrl() {
  const { clientId } = getOAuthClientConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const { clientId, clientSecret } = getOAuthClientConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  });

  const response = await fetch(TOKEN_URI, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }
  return JSON.parse(text);
}

function printUsage() {
  console.log("Usage:");
  console.log(
    "  DOTENV_CONFIG_PATH=.env.dev node --import=dotenv/config scripts/googleDriveOAuth.js auth-url",
  );
  console.log(
    "  DOTENV_CONFIG_PATH=.env.dev node --import=dotenv/config scripts/googleDriveOAuth.js exchange --code=<GOOGLE_AUTH_CODE>",
  );
}

async function main() {
  const command = process.argv[2];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  if (command === "auth-url") {
    const url = buildAuthUrl();
    console.log("Open this URL in your browser and approve access:");
    console.log(url);
    console.log("");
    console.log(`Redirect URI expected by script: ${REDIRECT_URI}`);
    return;
  }

  if (command === "exchange") {
    const codeArg = process.argv.find((arg) => arg.startsWith("--code="));
    const code = codeArg ? codeArg.slice("--code=".length) : "";
    if (!code) {
      throw new Error("Missing --code=<GOOGLE_AUTH_CODE>");
    }
    const tokenData = await exchangeCodeForTokens(code);
    console.log("Token exchange successful.");
    console.log("");
    console.log("Set these values in .env.dev (and .env.prod if needed):");
    console.log("GDRIVE_AUTH_MODE=oauth_refresh_token");
    console.log(`GDRIVE_OAUTH_REFRESH_TOKEN=${tokenData.refresh_token || ""}`);
    console.log(`GDRIVE_OAUTH_CLIENT_ID=${process.env.GDRIVE_OAUTH_CLIENT_ID || ""}`);
    console.log(
      `GDRIVE_OAUTH_CLIENT_SECRET=${process.env.GDRIVE_OAUTH_CLIENT_SECRET || ""}`,
    );
    console.log("");
    if (!tokenData.refresh_token) {
      console.log(
        "No refresh_token returned. Re-run auth-url and approve again with prompt=consent on a fresh consent flow.",
      );
    }
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
