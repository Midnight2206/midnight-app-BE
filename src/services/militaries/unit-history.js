const OPEN_ENDED_TRANSFER_YEAR = 9999;

function normalizeTransferEndYear(year) {
  return year ?? OPEN_ENDED_TRANSFER_YEAR;
}

export async function getAssignmentByYear({
  db,
  militaryId,
  typeId,
  year,
  scopeUnitId = null,
  strictEnd = false,
  includeUnit = false,
}) {
  const transferOutCondition = strictEnd
    ? { gt: year }
    : { gte: year };

  const conditions = [
    { transferInYear: { lte: year } },
    {
      OR: [{ transferOutYear: null }, { transferOutYear: transferOutCondition }],
    },
  ];

  if (Number.isInteger(typeId)) {
    conditions.push({ OR: [{ typeId }, { typeId: null }] });
  }

  if (scopeUnitId) {
    conditions.push({ unitId: scopeUnitId });
  }

  return db.militaryUnit.findFirst({
    where: {
      militaryId,
      AND: conditions,
    },
    include: includeUnit
      ? {
          unit: {
            select: {
              id: true,
              name: true,
            },
          },
        }
      : undefined,
    orderBy: [
      { typeId: "desc" },
      { transferInYear: "desc" },
      { transferOutYear: "asc" },
      { id: "desc" },
    ],
  });
}

export function normalizeTransferWindowEnd(year) {
  return normalizeTransferEndYear(year);
}
