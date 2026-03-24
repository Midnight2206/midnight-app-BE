const OPEN_ENDED_TRANSFER_YEAR = 9999;

function normalizeTransferEndYear(year) {
  return year ?? OPEN_ENDED_TRANSFER_YEAR;
}

function matchesTypeScope({ assignment, typeId }) {
  if (!Number.isInteger(typeId)) return true;
  return Number(assignment?.typeId || 0) === Number(typeId);
}

function matchesUnitScope({ assignment, scopeUnitId }) {
  if (!scopeUnitId) return true;
  return Number(assignment?.unitId || 0) === Number(scopeUnitId);
}

export function matchesAssignmentScope({
  assignment,
  typeId = null,
  scopeUnitId = null,
}) {
  return (
    matchesTypeScope({ assignment, typeId }) &&
    matchesUnitScope({ assignment, scopeUnitId })
  );
}

function compareAssignmentTimeline({ assignment, year, strictEnd = false }) {
  const transferInYear = Number(assignment?.transferInYear || 0);
  const transferOutYear =
    assignment?.transferOutYear === null || assignment?.transferOutYear === undefined
      ? null
      : Number(assignment.transferOutYear);

  const startsOnOrBeforeYear = transferInYear <= Number(year);
  const isIncludedInUnitForYear =
    startsOnOrBeforeYear &&
    (transferOutYear === null || Number(year) < transferOutYear);
  const isShownMilitaryForYear =
    startsOnOrBeforeYear &&
    (transferOutYear === null || Number(year) <= transferOutYear);
  const endsAfterYear = strictEnd ? isIncludedInUnitForYear : isShownMilitaryForYear;

  return {
    transferInYear,
    transferOutYear,
    startsOnOrBeforeYear,
    endsAfterYear,
    isIncludedInUnitForYear,
    isShownMilitaryForYear,
    includesYear: startsOnOrBeforeYear && endsAfterYear,
    transferredOutOnOrBeforeYear:
      transferOutYear !== null && transferOutYear <= Number(year),
  };
}

export function sortAssignmentHistory(assignments = []) {
  return [...assignments].sort((left, right) => {
    const leftType = Number.isInteger(left?.typeId) ? 1 : 0;
    const rightType = Number.isInteger(right?.typeId) ? 1 : 0;
    if (leftType !== rightType) return rightType - leftType;

    const leftIn = Number(left?.transferInYear || 0);
    const rightIn = Number(right?.transferInYear || 0);
    if (leftIn !== rightIn) return rightIn - leftIn;

    const leftOut = normalizeTransferEndYear(left?.transferOutYear);
    const rightOut = normalizeTransferEndYear(right?.transferOutYear);
    if (leftOut !== rightOut) return leftOut - rightOut;

    return Number(right?.id || 0) - Number(left?.id || 0);
  });
}

export function getScopedAssignmentHistory({
  assignments = [],
  typeId = null,
  scopeUnitId = null,
} = {}) {
  const unitScopedAssignments = assignments.filter((assignment) =>
    matchesUnitScope({ assignment, scopeUnitId }),
  );

  if (!Number.isInteger(typeId)) {
    return sortAssignmentHistory(unitScopedAssignments);
  }

  const exactTypeAssignments = unitScopedAssignments.filter((assignment) =>
    matchesTypeScope({ assignment, typeId }),
  );

  if (exactTypeAssignments.length > 0) {
    return sortAssignmentHistory(exactTypeAssignments);
  }

  // Backward-compatible fallback for old generic rows before per-type history was introduced.
  return sortAssignmentHistory(
    unitScopedAssignments.filter(
      (assignment) => assignment?.typeId === null || assignment?.typeId === undefined,
    ),
  );
}

export function findOpenAssignment({
  assignments = [],
  typeId = null,
  scopeUnitId = null,
} = {}) {
  return (
    getScopedAssignmentHistory({
      assignments,
      typeId,
      scopeUnitId,
    }).find(
      (assignment) =>
        assignment?.transferOutYear === null || assignment?.transferOutYear === undefined,
    ) || null
  );
}

export function findIncludedAssignmentByYear({
  assignments = [],
  year,
  typeId = null,
  scopeUnitId = null,
} = {}) {
  return (
    getScopedAssignmentHistory({
      assignments,
      typeId,
      scopeUnitId,
    }).find(
      (assignment) =>
        compareAssignmentTimeline({ assignment, year }).isIncludedInUnitForYear,
    ) || null
  );
}

export function findShownAssignmentByYear({
  assignments = [],
  year,
  typeId = null,
  scopeUnitId = null,
} = {}) {
  return (
    getScopedAssignmentHistory({
      assignments,
      typeId,
      scopeUnitId,
    }).find(
      (assignment) =>
        compareAssignmentTimeline({ assignment, year }).isShownMilitaryForYear,
    ) || null
  );
}

export function findClosedAssignmentByYear({
  assignments = [],
  year,
  typeId = null,
  scopeUnitId = null,
} = {}) {
  return (
    getScopedAssignmentHistory({
      assignments,
      typeId,
      scopeUnitId,
    }).find(
      (assignment) =>
        assignment?.transferOutYear !== null &&
        assignment?.transferOutYear !== undefined &&
        Number(assignment.transferOutYear) === Number(year),
    ) || null
  );
}

export function analyzeAssignmentHistory({
  assignments = [],
  year,
  typeId = null,
  scopeUnitId = null,
  strictEnd = false,
} = {}) {
  const scopedAssignments = getScopedAssignmentHistory({
    assignments,
    typeId,
    scopeUnitId,
  });

  const openAssignment =
    scopedAssignments.find(
      (assignment) =>
        assignment?.transferOutYear === null || assignment?.transferOutYear === undefined,
    ) || null;
  const includeAssignment =
    findIncludedAssignmentByYear({
      assignments: scopedAssignments,
      year,
    }) || null;
  const showAssignment =
    findShownAssignmentByYear({
      assignments: scopedAssignments,
      year,
    }) || null;
  const currentAssignment =
    scopedAssignments.find((assignment) =>
      compareAssignmentTimeline({ assignment, year, strictEnd }).includesYear,
    ) || null;

  const latestAssignment = scopedAssignments[0] || null;
  const transferOutAssignments = scopedAssignments.filter(
    (assignment) => assignment?.transferOutYear !== null && assignment?.transferOutYear !== undefined,
  );
  const latestTransferOutAssignment = transferOutAssignments[0] || null;
  const closedAssignmentInYear =
    findClosedAssignmentByYear({
      assignments: scopedAssignments,
      year,
    }) || null;

  return {
    year: Number(year),
    strictEnd,
    assignments: scopedAssignments,
    openAssignment,
    includeAssignment,
    showAssignment,
    currentAssignment,
    latestAssignment,
    latestTransferOutAssignment,
    closedAssignmentInYear,
    hasAnyAssignment: scopedAssignments.length > 0,
    hasOpenAssignment: Boolean(openAssignment),
    hasHistoricalTransferOut: transferOutAssignments.length > 0,
    hasTransferOutOnOrBeforeYear: transferOutAssignments.some(
      (assignment) =>
        compareAssignmentTimeline({ assignment, year, strictEnd }).transferredOutOnOrBeforeYear,
    ),
  };
}

export function evaluateMilitaryUnitYearState({
  assignments = [],
  transferRequests = [],
  currentYear,
  unitId = null,
  typeId = null,
} = {}) {
  const includeAnalysis = analyzeAssignmentHistory({
    assignments,
    year: currentYear,
    typeId,
    scopeUnitId: unitId,
    strictEnd: true,
  });
  const showAnalysis = analyzeAssignmentHistory({
    assignments,
    year: currentYear,
    typeId,
    scopeUnitId: unitId,
    strictEnd: false,
  });

  const matchedRequests = (transferRequests || [])
    .filter((request) => {
      if (!request) return false;
      if (Number(request.transferYear || 0) !== Number(currentYear)) return false;
      if (Number(unitId || 0) !== Number(request.fromUnitId || 0)) return false;
      if (Number.isInteger(typeId) && Number(request.typeId || 0) !== Number(typeId)) return false;
      if (!["PENDING", "ACCEPTED"].includes(String(request.status || "").toUpperCase())) return false;
      return true;
    })
    .sort((left, right) => {
      const leftAccepted = left?.status === "ACCEPTED" ? 1 : 0;
      const rightAccepted = right?.status === "ACCEPTED" ? 1 : 0;
      if (leftAccepted !== rightAccepted) return rightAccepted - leftAccepted;
      return new Date(right?.requestedAt || 0).getTime() - new Date(left?.requestedAt || 0).getTime();
    });

  const matchedRequest = matchedRequests[0] || null;
  const isHasReqTransfer =
    matchedRequest?.status === "ACCEPTED"
      ? "accepted"
      : matchedRequest?.status === "PENDING"
        ? "waiting"
        : false;

  const isIncludeUnit = Boolean(includeAnalysis.includeAssignment);
  const isShowMilitary = Boolean(showAnalysis.showAssignment);
  const canCut =
    isIncludeUnit && includeAnalysis.includeAssignment?.transferOutYear === null;
  const displayStatus =
    isHasReqTransfer === "waiting"
      ? "waiting"
      : isHasReqTransfer === "accepted" || (!isIncludeUnit && isShowMilitary)
        ? "transferred"
        : null;

  return {
    currentYear: Number(currentYear),
    unitId: unitId ? Number(unitId) : null,
    typeId: Number.isInteger(typeId) ? typeId : null,
    isIncludeUnit,
    isShowMilitary,
    canCut,
    isHasReqTransfer,
    displayStatus,
    matchedRequest,
    includeAnalysis,
    showAnalysis,
  };
}

export async function listAssignmentHistory({
  db,
  militaryId,
  typeId = null,
  scopeUnitId = null,
  includeUnit = false,
}) {
  const conditions = [];

  if (Number.isInteger(typeId)) {
    conditions.push({ OR: [{ typeId }, { typeId: null }] });
  }

  if (scopeUnitId) {
    conditions.push({ unitId: scopeUnitId });
  }

  return db.militaryUnit.findMany({
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

export async function getAssignmentByYear({
  db,
  militaryId,
  typeId,
  year,
  scopeUnitId = null,
  strictEnd = false,
  includeUnit = false,
}) {
  const assignments = await listAssignmentHistory({
    db,
    militaryId,
    typeId,
    scopeUnitId,
    includeUnit,
  });

  return (
    analyzeAssignmentHistory({
      assignments,
      year,
      typeId,
      scopeUnitId,
      strictEnd,
    }).currentAssignment || null
  );
}

export function normalizeTransferWindowEnd(year) {
  return normalizeTransferEndYear(year);
}

export { compareAssignmentTimeline };
