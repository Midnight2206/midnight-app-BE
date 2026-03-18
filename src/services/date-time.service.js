const DEFAULT_TIME_ZONE = "Asia/Ho_Chi_Minh";

export function getAppTimeZone() {
  const fromEnv = String(process.env.TZ || "").trim();
  return fromEnv || DEFAULT_TIME_ZONE;
}

export function formatDateTimeInAppTimeZone(value, locale = "vi-VN") {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(locale, {
    timeZone: getAppTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
