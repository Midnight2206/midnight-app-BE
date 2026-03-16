export function buildYearAssignmentCondition({
  selectedYear,
  useCurrentAssuranceOnly,
  currentYear,
}) {
  const snapshotYear = useCurrentAssuranceOnly ? currentYear : selectedYear;
  return { snapshotYear };
}

export function buildScopeWhereCondition({
  scopeUnitId,
  snapshotYear,
  snapshotTypeId = null,
}) {
  const conditions = [
    { transferInYear: { lte: snapshotYear } },
    {
      OR: [
        { transferOutYear: null },
        { transferOutYear: { gte: snapshotYear } },
      ],
    },
  ];

  if (Number.isInteger(snapshotTypeId)) {
    conditions.push({
      OR: [{ typeId: snapshotTypeId }, { typeId: null }],
    });
  }

  if (scopeUnitId) {
    conditions.push({ unitId: scopeUnitId });
  }

  const snapshotWhere = {
    AND: conditions,
  };

  return {
    AND: [
      {
        militaryUnits: {
          some: snapshotWhere,
        },
      },
    ],
  };
}

export function toSortableYearValue({ value, direction }) {
  return value ?? (direction === "asc" ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER);
}
