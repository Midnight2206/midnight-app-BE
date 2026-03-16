export const VERIFY_EMAIL_COOLDOWN_MS = Number(
  process.env.VERIFY_EMAIL_COOLDOWN_MS || 60_000,
);

const DEFAULT_REFRESH_TOKEN_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function getRefreshTokenExpireMs() {
  const n = Number(process.env.REFRESH_TOKEN_EXPIRES);
  if (!Number.isFinite(n) || n < 86400_000) return DEFAULT_REFRESH_TOKEN_EXPIRES_MS;
  return Math.min(n, 365 * 24 * 60 * 60 * 1000);
}

export function getFrontendOrigin() {
  const fromEnv = process.env.FRONTEND_APP_URL;
  if (fromEnv) return fromEnv;

  const allowOrigin = String(process.env.ALLOW_ORIGIN || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)[0];

  return allowOrigin || "http://localhost:5173";
}

export function mapBasicUser(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    unitId: user.unitId,
    verifiedAt: user.verifiedAt,
    roles: user.roles.map((r) => r.role.name),
  };
}
