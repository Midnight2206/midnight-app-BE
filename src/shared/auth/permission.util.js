const UUID_V4_OR_GENERIC_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeSegment(segment) {
  if (!segment) return segment;
  if (segment.startsWith(":")) return ":id";
  if (/^\d+$/.test(segment)) return ":id";
  if (UUID_V4_OR_GENERIC_REGEX.test(segment)) return ":id";
  return segment;
}

export function normalizePermissionPath(pathname) {
  const normalized = String(pathname || "")
    .replace(/\/+/g, "/")
    .trim();

  if (!normalized || normalized === "/") {
    return "/";
  }

  const segments = normalized
    .split("/")
    .filter(Boolean)
    .map(normalizeSegment);

  return `/${segments.join("/")}`;
}

export function buildPermissionCode(method, pathname) {
  return `${String(method || "").toUpperCase()} ${normalizePermissionPath(pathname)}`;
}
