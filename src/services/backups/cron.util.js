export function parseCronField(rawField, min, max) {
  const field = String(rawField || "").trim();
  if (!field) throw new Error(`Invalid cron field: "${rawField}"`);

  const values = new Set();

  const addRange = (start, end, step = 1) => {
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      throw new Error(`Invalid cron range: ${start}-${end}`);
    }
    if (start < min || end > max || start > end || step <= 0) {
      throw new Error(`Out of range cron value: ${start}-${end}/${step}`);
    }
    for (let i = start; i <= end; i += step) values.add(i);
  };

  for (const part of field.split(",")) {
    const token = part.trim();
    if (!token) continue;

    const [base, stepRaw] = token.split("/");
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isFinite(step) || step <= 0) {
      throw new Error(`Invalid cron step: ${token}`);
    }

    if (base === "*") {
      addRange(min, max, step);
      continue;
    }

    if (base.includes("-")) {
      const [startRaw, endRaw] = base.split("-");
      addRange(Number(startRaw), Number(endRaw), step);
      continue;
    }

    const single = Number(base);
    if (!Number.isInteger(single)) {
      throw new Error(`Invalid cron value: ${token}`);
    }
    if (single < min || single > max) {
      throw new Error(`Cron value out of range: ${token}`);
    }
    if (stepRaw) {
      addRange(single, max, step);
    } else {
      values.add(single);
    }
  }

  return values;
}

export function parseCronExpression(expression) {
  const parts = String(expression || "").trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `Invalid cron expression "${expression}". Expected 5 fields.`,
    );
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return {
    minute: parseCronField(minute, 0, 59),
    hour: parseCronField(hour, 0, 23),
    dayOfMonth: parseCronField(dayOfMonth, 1, 31),
    month: parseCronField(month, 1, 12),
    dayOfWeek: parseCronField(dayOfWeek, 0, 6),
  };
}

export function cronMatches(date, parsed) {
  return (
    parsed.minute.has(date.getMinutes()) &&
    parsed.hour.has(date.getHours()) &&
    parsed.dayOfMonth.has(date.getDate()) &&
    parsed.month.has(date.getMonth() + 1) &&
    parsed.dayOfWeek.has(date.getDay())
  );
}

export function minuteKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}${month}${day}${hour}${minute}`;
}

