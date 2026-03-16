export function normalizeVietnameseSearchText(value) {
  const text = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");

  return text;
}

export function buildMilitarySearchNormalized({
  fullname,
  rank,
  position,
  gender,
  type,
  militaryCode,
  assignedUnit,
  unitName,
}) {
  return normalizeVietnameseSearchText(
    [fullname, militaryCode, rank, position, gender, type, assignedUnit, unitName]
      .filter(Boolean)
      .join(" "),
  );
}
