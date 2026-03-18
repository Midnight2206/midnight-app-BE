import { hashToken } from "#utils/createRefreshToken.js";

function pickFirstIp(value) {
  return String(value || "")
    .split(",")[0]
    ?.trim();
}

function normalizeIp(ip) {
  const value = String(ip || "").trim();
  if (!value) return "";
  if (value.startsWith("::ffff:")) return value.slice(7);
  return value;
}

export function getClientIp(req) {
  return normalizeIp(
    pickFirstIp(req.headers["cf-connecting-ip"]) ||
      pickFirstIp(req.headers["true-client-ip"]) ||
      pickFirstIp(req.headers["x-real-ip"]) ||
      pickFirstIp(req.headers["x-forwarded-for"]) ||
      req.ip ||
      req.socket?.remoteAddress ||
      "",
  );
}

export function getUserAgent(req) {
  return String(req.get("User-Agent") || "").trim();
}

export function getRefreshTokenFromRequest(req) {
  return String(req.cookies?.refreshToken || "").trim();
}

export function getRefreshTokenHashFromRequest(req) {
  const refreshToken = getRefreshTokenFromRequest(req);
  if (!refreshToken) return null;
  return hashToken(refreshToken);
}
