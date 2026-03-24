import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function normalizeOrigin(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) return "";

  try {
    return new URL(normalized).origin;
  } catch {
    return "";
  }
}

function getAllowedOrigins() {
  return String(process.env.ALLOW_ORIGIN || "")
    .split(",")
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);
}

function resolveRequestOrigin(req) {
  const origin = normalizeOrigin(req.get("origin") || "");
  if (origin) return origin;
  return normalizeOrigin(req.get("referer") || "");
}

function hasAuthCookies(req) {
  return Boolean(req.cookies?.accessToken || req.cookies?.refreshToken);
}

export function csrfProtection(req, res, next) {
  if (!UNSAFE_METHODS.has(req.method)) return next();
  if (!hasAuthCookies(req)) return next();

  const allowedOrigins = getAllowedOrigins();
  if (allowedOrigins.length === 0) return next();

  const requestOrigin = resolveRequestOrigin(req);
  if (!requestOrigin) {
    return next(
      new AppError({
        message: "CSRF protection blocked this request",
        statusCode: HTTP_CODES.FORBIDDEN,
        errorCode: "CSRF_ORIGIN_MISSING",
        metadata:
          process.env.NODE_ENV === "development"
            ? { allowedOrigins }
            : undefined,
      }),
    );
  }

  if (allowedOrigins.includes(requestOrigin)) {
    return next();
  }

  return next(
    new AppError({
      message: "CSRF protection blocked this request",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "CSRF_ORIGIN_DENIED",
      metadata:
        process.env.NODE_ENV === "development"
          ? { requestOrigin, allowedOrigins }
          : undefined,
    }),
  );
}
