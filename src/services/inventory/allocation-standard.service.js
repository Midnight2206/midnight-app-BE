import { prisma } from "#configs/prisma.config.js";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_ALLOCATION_SUBJECTS,
  getActorUnitId,
  normalizeForCompare,
  normalizeName,
  parsePositiveInt,
  parseUnitIdOrNull,
  throwBadRequest,
  throwConflict,
  throwForbidden,
  throwNotFound,
} from "#services/inventory/common.js";
import { ensureAnyRole } from "#utils/roleGuards.js";
import { getMilitaryRankLabel } from "#services/militaries/profile-reference.js";

const ALLOCATION_RULE_MODE = {
  OPEN: "OPEN",
  CONDITIONAL: "CONDITIONAL",
};
const STANDARD_CONDITION_FIELD = {
  INITIAL_COMMISSIONING_YEAR: "INITIAL_COMMISSIONING_YEAR",
};
const STANDARD_CONDITION_OPERATORS = new Set(["GT", "GTE", "LT", "LTE", "EQ", "NEQ"]);

const ALLOCATION_GENDERS = new Set(["ANY", "MALE", "FEMALE"]);
const ALLOCATION_RANK_GROUPS = new Set(["ANY", "CAP_UY", "CAP_TA", "CAP_TUONG", "HSQ_BS"]);
const DEFAULT_ALLOCATION_SUBJECT_NORMALIZED = new Set(
  DEFAULT_ALLOCATION_SUBJECTS.map((name) => normalizeForCompare(name)),
);
const DEFAULT_ALLOCATION_SUBJECT_NORMALIZED_ARRAY = Array.from(
  DEFAULT_ALLOCATION_SUBJECT_NORMALIZED,
);

function normalizeNumber(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function mapSubject(subject) {
  const nameNormalized = normalizeForCompare(subject.name);
  return {
    id: subject.id,
    unitId: subject.unitId,
    unit: subject.unit
      ? {
          id: subject.unit.id,
          name: subject.unit.name,
        }
      : null,
    name: subject.name,
    isSystemDefault: DEFAULT_ALLOCATION_SUBJECT_NORMALIZED.has(nameNormalized),
    createdAt: subject.createdAt,
    updatedAt: subject.updatedAt,
    deletedAt: subject.deletedAt,
  };
}

function mapMilitaryType(type) {
  if (!type) return null;
  return {
    id: type.id,
    code: type.code,
    name: type.name || null,
  };
}

function mapServiceLifeRule(rule) {
  return {
    id: rule.id,
    unitId: rule.unitId,
    unit: rule.unit
      ? {
          id: rule.unit.id,
          name: rule.unit.name,
        }
      : null,
    type: mapMilitaryType(rule.type),
    category: rule.category
      ? {
          id: rule.category.id,
          name: rule.category.name,
        }
      : null,
    serviceLifeYears: rule.serviceLifeYears,
    gender: String(rule.gender || "ANY"),
    rankGroup: String(rule.rankGroup || "ANY"),
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
    deletedAt: rule.deletedAt,
  };
}

export async function ensureDefaultAllocationSubjects({ unitId, db = prisma } = {}) {
  const scopedUnitId = Number.parseInt(unitId, 10);
  if (!Number.isInteger(scopedUnitId) || scopedUnitId <= 0) {
    throwBadRequest("unitId là bắt buộc", "UNIT_ID_REQUIRED");
  }

  const existing = await db.supplyAllocationSubject.findMany({
    where: {
      unitId: scopedUnitId,
      nameNormalized: {
        in: DEFAULT_ALLOCATION_SUBJECTS.map((name) => normalizeForCompare(name)),
      },
    },
    select: {
      id: true,
      name: true,
      nameNormalized: true,
      deletedAt: true,
    },
  });

  const existingByNormalized = new Map(
    existing.map((subject) => [subject.nameNormalized, subject]),
  );

  const missing = DEFAULT_ALLOCATION_SUBJECTS.filter(
    (name) => !existingByNormalized.has(normalizeForCompare(name)),
  );

  if (missing.length) {
    await db.supplyAllocationSubject.createMany({
      data: missing.map((name) => ({
        unitId: scopedUnitId,
        name,
        nameNormalized: normalizeForCompare(name),
      })),
      skipDuplicates: true,
    });
  }

  const deletedDefaultIds = DEFAULT_ALLOCATION_SUBJECTS.map((name) => normalizeForCompare(name))
    .map((key) => existingByNormalized.get(key))
    .filter((subject) => subject?.deletedAt)
    .map((subject) => subject.id);

  if (deletedDefaultIds.length) {
    await db.supplyAllocationSubject.updateMany({
      where: {
        id: {
          in: deletedDefaultIds,
        },
      },
      data: {
        deletedAt: null,
      },
    });
  }
}

function parseServiceLifeYears(value) {
  const years = Number.parseInt(value, 10);
  if (!Number.isInteger(years) || years <= 0 || years > 100) {
    throwBadRequest("Niên hạn cấp phát không hợp lệ", "INVALID_SERVICE_LIFE_YEARS");
  }
  return years;
}

function parseAllocationRuleGender(value, fallback = "ANY") {
  const gender = String(value || fallback)
    .trim()
    .toUpperCase();
  if (!ALLOCATION_GENDERS.has(gender)) {
    throwBadRequest("gender không hợp lệ", "INVALID_ALLOCATION_RULE_GENDER");
  }
  return gender;
}

function parseAllocationRankGroup(value, fallback = "ANY") {
  const rankGroup = String(value || fallback)
    .trim()
    .toUpperCase();
  if (!ALLOCATION_RANK_GROUPS.has(rankGroup)) {
    throwBadRequest("rankGroup không hợp lệ", "INVALID_ALLOCATION_RANK_GROUP");
  }
  return rankGroup;
}

function parseDateTimeOrNow(value) {
  if (!value) return new Date();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throwBadRequest("Ngày giờ không hợp lệ", "INVALID_DATETIME");
  }
  return date;
}

function parseYearLike(value) {
  const year = Number.parseInt(value, 10);
  if (!Number.isInteger(year) || year < 1900 || year > 3000) {
    throwBadRequest("Năm không hợp lệ", "INVALID_YEAR");
  }
  return year;
}

function parseAsOfYear({ asOfYear, asOfDate }) {
  if (asOfYear !== undefined && asOfYear !== null && String(asOfYear).trim() !== "") {
    return parseYearLike(asOfYear);
  }
  if (asOfDate) {
    return parseDateTimeOrNow(asOfDate).getUTCFullYear();
  }
  return new Date().getUTCFullYear();
}

function parseStandardCondition(rawCondition) {
  if (rawCondition === undefined) return null;
  if (rawCondition === null) return null;
  if (typeof rawCondition !== "object" || Array.isArray(rawCondition)) {
    throwBadRequest("standardCondition không hợp lệ", "INVALID_STANDARD_CONDITION");
  }

  const field = String(rawCondition?.field || "")
    .trim()
    .toUpperCase();
  if (!Object.values(STANDARD_CONDITION_FIELD).includes(field)) {
    throwBadRequest("field của standardCondition không hợp lệ", "INVALID_STANDARD_CONDITION_FIELD");
  }

  const operator = String(rawCondition?.operator || "")
    .trim()
    .toUpperCase();
  if (!STANDARD_CONDITION_OPERATORS.has(operator)) {
    throwBadRequest(
      "operator của standardCondition không hợp lệ",
      "INVALID_STANDARD_CONDITION_OPERATOR",
    );
  }

  const issueYearOffset = normalizeNumber(rawCondition?.issueYearOffset, 0);
  if (issueYearOffset < -50 || issueYearOffset > 50) {
    throwBadRequest(
      "issueYearOffset của standardCondition phải trong khoảng -50..50",
      "INVALID_STANDARD_CONDITION_OFFSET",
    );
  }

  return {
    field,
    operator,
    issueYearOffset,
  };
}

function isStandardConditionMatched({ standardCondition, military, asOfYear }) {
  if (!standardCondition) return true;

  const field = String(standardCondition.field || "").toUpperCase();
  const operator = String(standardCondition.operator || "").toUpperCase();
  const issueYearOffset = normalizeNumber(standardCondition.issueYearOffset, 0);
  const rightValue = Number(asOfYear) + issueYearOffset;
  let leftValue = null;

  if (field === STANDARD_CONDITION_FIELD.INITIAL_COMMISSIONING_YEAR) {
    leftValue = normalizeNumber(military?.initialCommissioningYear, NaN);
  }

  if (!Number.isFinite(leftValue)) return false;

  if (operator === "GT") return leftValue > rightValue;
  if (operator === "GTE") return leftValue >= rightValue;
  if (operator === "LT") return leftValue < rightValue;
  if (operator === "LTE") return leftValue <= rightValue;
  if (operator === "EQ") return leftValue === rightValue;
  if (operator === "NEQ") return leftValue !== rightValue;
  return false;
}

function getYearFromDate(date) {
  return new Date(date).getUTCFullYear();
}

function resolveServiceLifeTimeline({
  issueYears = [],
  referenceYear,
  serviceLifeYears,
}) {
  const normalizedYears = [...new Set(
    (issueYears || [])
      .map((year) => Number(year))
      .filter((year) => Number.isInteger(year)),
  )].sort((left, right) => left - right);

  let previousIssuedYear = null;
  let nextIssuedYear = null;

  normalizedYears.forEach((year) => {
    if (year <= Number(referenceYear)) {
      previousIssuedYear = year;
      return;
    }
    if (nextIssuedYear === null) {
      nextIssuedYear = year;
    }
  });

  const normalizedServiceLifeYears = Number(serviceLifeYears || 0);
  const nextEligibleYear =
    previousIssuedYear !== null && normalizedServiceLifeYears > 0
      ? previousIssuedYear + normalizedServiceLifeYears
      : null;
  const windowCycleSpan =
    previousIssuedYear !== null &&
    nextIssuedYear !== null &&
    normalizedServiceLifeYears > 0
      ? (nextIssuedYear - previousIssuedYear) / normalizedServiceLifeYears
      : null;
  const overdueByHistoricalWindow =
    nextEligibleYear !== null &&
    Number(referenceYear) >= Number(nextEligibleYear) &&
    windowCycleSpan !== null &&
    windowCycleSpan > 2;
  const dueByServiceLife =
    previousIssuedYear === null ||
    normalizedServiceLifeYears <= 0 ||
    (nextEligibleYear !== null && Number(referenceYear) >= Number(nextEligibleYear)) ||
    overdueByHistoricalWindow;

  return {
    previousIssuedYear,
    nextIssuedYear,
    nextEligibleYear,
    windowCycleSpan,
    overdueByHistoricalWindow,
    dueByServiceLife,
  };
}

function isYearWithinRange({ year, transferInYear, transferOutYear }) {
  if (year < Number(transferInYear)) return false;
  if (transferOutYear !== null && transferOutYear !== undefined && year > Number(transferOutYear)) {
    return false;
  }
  return true;
}

function resolveRankGroup(rankRaw) {
  const rank = normalizeForCompare(rankRaw || "");
  if (!rank) return "HSQ_BS";
  if (rank.includes("tuong")) return "CAP_TUONG";
  if (rank.includes("ta")) return "CAP_TA";
  if (rank.includes("uy")) return "CAP_UY";
  return "HSQ_BS";
}

function buildVoucherNo(issuedAt) {
  const year = issuedAt.getUTCFullYear();
  const month = String(issuedAt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(issuedAt.getUTCDate()).padStart(2, "0");
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  return `PXK-${year}${month}${day}-${suffix}`;
}

function parseItemRules(itemRules) {
  if (!Array.isArray(itemRules)) return new Map();

  const rules = new Map();
  itemRules.forEach((entry, index) => {
    const itemId = Number.parseInt(entry?.itemId, 10);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      throwBadRequest(
        `itemId không hợp lệ tại itemRules[${index}]`,
        "INVALID_STANDARD_RULE_ITEM_ID",
      );
    }

    const modeRaw = String(entry?.mode || "").trim().toUpperCase();
    const requestedMode = modeRaw || null;
    if (
      requestedMode &&
      requestedMode !== ALLOCATION_RULE_MODE.OPEN &&
      requestedMode !== ALLOCATION_RULE_MODE.CONDITIONAL
    ) {
      throwBadRequest(
        `mode không hợp lệ tại itemRules[${index}]`,
        "INVALID_STANDARD_RULE_MODE",
      );
    }

    const gender = String(entry?.gender || "ANY")
      .trim()
      .toUpperCase();
    if (!ALLOCATION_GENDERS.has(gender)) {
      throwBadRequest(
        `gender không hợp lệ tại itemRules[${index}]`,
        "INVALID_STANDARD_RULE_GENDER",
      );
    }

    const rankGroup = String(entry?.rankGroup || "ANY")
      .trim()
      .toUpperCase();
    if (!ALLOCATION_RANK_GROUPS.has(rankGroup)) {
      throwBadRequest(
        `rankGroup không hợp lệ tại itemRules[${index}]`,
        "INVALID_STANDARD_RULE_RANK_GROUP",
      );
    }

    const inferredMode =
      requestedMode ||
      (gender !== "ANY" ||
      rankGroup !== "ANY"
        ? ALLOCATION_RULE_MODE.CONDITIONAL
        : ALLOCATION_RULE_MODE.OPEN);

    if (inferredMode === ALLOCATION_RULE_MODE.OPEN) {
      rules.set(itemId, {
        mode: ALLOCATION_RULE_MODE.OPEN,
        gender: "ANY",
        rankGroup: "ANY",
      });
      return;
    }

    rules.set(itemId, {
      mode: ALLOCATION_RULE_MODE.CONDITIONAL,
      gender,
      rankGroup,
    });
  });

  return rules;
}

async function assertSubjectAvailable({ subjectId, unitId }) {
  const subject = await prisma.supplyAllocationSubject.findFirst({
    where: {
      id: subjectId,
      unitId,
      deletedAt: null,
    },
  });

  if (!subject) {
    throwNotFound(
      "Đối tượng cấp phát không tồn tại hoặc không thuộc đơn vị",
      "ALLOCATION_SUBJECT_NOT_FOUND",
    );
  }

  return subject;
}

async function assertCategoryAvailable({ categoryId }) {
  const category = await prisma.category.findFirst({
    where: {
      id: categoryId,
      deletedAt: null,
    },
  });

  if (!category) {
    throwNotFound("Danh mục không tồn tại hoặc đã bị xoá", "CATEGORY_NOT_FOUND");
  }

  return category;
}

async function assertMilitaryTypeAvailable({ typeId, db = prisma }) {
  const type = await db.militaryTypeCatalog.findFirst({
    where: {
      id: typeId,
      deletedAt: null,
    },
    select: {
      id: true,
      code: true,
      name: true,
    },
  });

  if (!type) {
    throwNotFound("Loại quân nhân không tồn tại hoặc đã bị xoá", "MILITARY_TYPE_NOT_FOUND");
  }

  return type;
}

async function fetchMilitaryTypeAssignments({ militaryId, db = prisma }) {
  const assignments = await db.militaryTypeAssignment.findMany({
    where: {
      militaryId,
      type: {
        deletedAt: null,
      },
    },
    orderBy: [{ typeId: "asc" }],
    select: {
      typeId: true,
      type: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
    },
  });

  return assignments
    .map((entry) => ({
      typeId: Number(entry.typeId),
      type: entry.type,
    }))
    .filter((entry) => Number.isInteger(entry.typeId) && entry.type);
}

function parseQuantities(itemQuantities) {
  if (!Array.isArray(itemQuantities)) return new Map();

  const quantityMap = new Map();
  itemQuantities.forEach((entry, index) => {
    const itemId = Number.parseInt(entry?.itemId, 10);
    const quantity = Number.parseInt(entry?.quantity, 10);

    if (!Number.isInteger(itemId) || itemId <= 0) {
      throwBadRequest(
        `itemId không hợp lệ tại itemQuantities[${index}]`,
        "INVALID_STANDARD_ITEM_ID",
      );
    }

    if (!Number.isInteger(quantity) || quantity < 0) {
      throwBadRequest(
        `quantity không hợp lệ tại itemQuantities[${index}]`,
        "INVALID_STANDARD_ITEM_QUANTITY",
      );
    }

    quantityMap.set(itemId, quantity);
  });

  return quantityMap;
}

async function getCategoryActiveItems({ categoryId }) {
  return prisma.supplyItem.findMany({
    where: {
      categoryId,
      deletedAt: null,
      isActive: true,
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      code: true,
      unitOfMeasure: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
}

async function fetchRuleRowsByStandardIds({ standardIds }) {
  if (!Array.isArray(standardIds) || !standardIds.length) return [];
  const ids = standardIds
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) return [];

  const placeholders = ids.map(() => "?").join(", ");
  return prisma.$queryRawUnsafe(
    `
      SELECT standardId, itemId, gender, rankGroup
      FROM supply_allocation_standard_item_rules
      WHERE standardId IN (${placeholders})
    `,
    ...ids,
  );
}

async function fetchCampaignContentRowsByStandardIds({ standardIds }) {
  if (!Array.isArray(standardIds) || !standardIds.length) return [];
  const ids = standardIds
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) return [];

  const placeholders = ids.map(() => "?").join(", ");
  return prisma.$queryRawUnsafe(
    `
      SELECT standardId, content, conditionField, conditionOperator, conditionIssueYearOffset
      FROM supply_allocation_standard_campaign_contents
      WHERE standardId IN (${placeholders})
    `,
    ...ids,
  );
}

async function fetchRuleMapByStandardIds({ standardIds }) {
  const rows = await fetchRuleRowsByStandardIds({ standardIds });
  const byStandard = new Map();
  const ensureRule = (standardId, itemId) => {
    if (!byStandard.has(standardId)) byStandard.set(standardId, new Map());
    if (!byStandard.get(standardId).has(itemId)) {
      byStandard.get(standardId).set(itemId, {
        mode: ALLOCATION_RULE_MODE.CONDITIONAL,
        gender: "ANY",
        rankGroup: "ANY",
      });
    }
    return byStandard.get(standardId).get(itemId);
  };

  rows.forEach((row) => {
    const standardId = Number(row.standardId);
    const itemId = Number(row.itemId);
    if (!Number.isInteger(standardId) || !Number.isInteger(itemId)) return;
    const rule = ensureRule(standardId, itemId);
    rule.mode = ALLOCATION_RULE_MODE.CONDITIONAL;
    rule.gender = String(row.gender || "ANY");
    rule.rankGroup = String(row.rankGroup || "ANY");
  });
  return byStandard;
}

async function fetchCampaignContentMapByStandardIds({ standardIds }) {
  let rows = [];
  try {
    rows = await fetchCampaignContentRowsByStandardIds({ standardIds });
  } catch {
    rows = [];
  }
  return new Map(
    rows
      .map((row) => {
        const standardCondition =
          row?.conditionField && row?.conditionOperator
            ? {
                field: String(row.conditionField).toUpperCase(),
                operator: String(row.conditionOperator).toUpperCase(),
                issueYearOffset: normalizeNumber(row.conditionIssueYearOffset, 0),
              }
            : null;
        return [
          Number(row.standardId),
          {
            content: String(row.content || "").trim(),
            standardCondition,
          },
        ];
      })
      .filter(([standardId]) => Number.isInteger(standardId) && standardId > 0),
  );
}

async function replaceStandardRules({ tx, standardId, rulesByItemId }) {
  await tx.$executeRawUnsafe(
    "DELETE FROM supply_allocation_standard_item_rules WHERE standardId = ?",
    standardId,
  );

  const conditionalRules = Array.from(rulesByItemId.entries())
    .map(([itemId, rule]) => ({
      itemId: Number(itemId),
      gender: String(rule?.gender || "ANY"),
      rankGroup: String(rule?.rankGroup || "ANY"),
      mode: String(rule?.mode || ALLOCATION_RULE_MODE.OPEN),
    }))
    .filter(
      (entry) =>
        Number.isInteger(entry.itemId) &&
        entry.itemId > 0 &&
        entry.mode === ALLOCATION_RULE_MODE.CONDITIONAL,
    );

  if (!conditionalRules.length) return;

  const placeholders = conditionalRules.map(() => "(?, ?, ?, ?)").join(", ");
  const values = conditionalRules.flatMap((entry) => [
    standardId,
    entry.itemId,
    entry.gender,
    entry.rankGroup,
  ]);

  await tx.$executeRawUnsafe(
    `
      INSERT INTO supply_allocation_standard_item_rules
        (standardId, itemId, gender, rankGroup)
      VALUES ${placeholders}
    `,
    ...values,
  );
}

function mapStandard(standard, ruleMapByItemId = new Map(), campaignData = null) {
  const content = String(campaignData?.content || "").trim();
  const standardCondition = campaignData?.standardCondition || null;
  return {
    id: standard.id,
    unitId: standard.unitId,
    unit: standard.unit
      ? {
          id: standard.unit.id,
          name: standard.unit.name,
        }
      : null,
    serviceLifeYears: standard.serviceLifeYears,
    createdAt: standard.createdAt,
    updatedAt: standard.updatedAt,
    deletedAt: standard.deletedAt,
    campaignContent: content || null,
    standardCondition,
    subject: standard.subject
      ? {
          id: standard.subject.id,
          name: standard.subject.name,
        }
      : null,
    category: standard.category
      ? {
          id: standard.category.id,
          name: standard.category.name,
        }
      : null,
    items: (standard.items || []).map((entry) => ({
      itemId: entry.item?.id || entry.itemId,
      itemName: entry.item?.name || "",
      itemCode: entry.item?.code || null,
      unitOfMeasure: entry.item?.unitOfMeasure
        ? {
            id: entry.item.unitOfMeasure.id,
            name: entry.item.unitOfMeasure.name,
          }
        : null,
      quantity: entry.quantity,
      itemRule: ruleMapByItemId.get(entry.item?.id || entry.itemId) || {
        mode: ALLOCATION_RULE_MODE.OPEN,
        gender: "ANY",
        rankGroup: "ANY",
      },
    })),
  };
}

function resolveScopeUnitForRead({ actor, unitId }) {
  ensureAnyRole(actor, ["ADMIN"], {
    message: "Chỉ ADMIN đơn vị được thao tác tiêu chuẩn cấp phát",
    errorCode: "ALLOCATION_ADMIN_REQUIRED",
  });
  const actorUnitId = getActorUnitId(actor);
  const requestedUnitId = parseUnitIdOrNull(unitId);
  if (requestedUnitId && requestedUnitId !== actorUnitId) {
    throwForbidden(
      "Bạn chỉ được thao tác trong đơn vị của mình",
      "UNIT_SCOPE_FORBIDDEN",
    );
  }
  return actorUnitId;
}

function resolveScopeUnitForWrite({ actor, unitId }) {
  return resolveScopeUnitForRead({ actor, unitId });
}

function assertNoMembershipOverlap(parsedMemberships) {
  const bySubjectId = new Map();
  parsedMemberships.forEach((entry) => {
    if (!bySubjectId.has(entry.subjectId)) bySubjectId.set(entry.subjectId, []);
    bySubjectId.get(entry.subjectId).push(entry);
  });

  for (const [subjectId, periods] of bySubjectId.entries()) {
    const sorted = [...periods].sort((a, b) => {
      if (a.transferInYear !== b.transferInYear) {
        return a.transferInYear - b.transferInYear;
      }
      const endA = a.transferOutYear ?? Number.MAX_SAFE_INTEGER;
      const endB = b.transferOutYear ?? Number.MAX_SAFE_INTEGER;
      return endA - endB;
    });

    let prevEnd = null;
    sorted.forEach((entry) => {
      if (prevEnd !== null && entry.transferInYear <= prevEnd) {
        throwBadRequest(
          `Các giai đoạn của subjectId=${subjectId} đang bị chồng lấn`,
          "OVERLAPPED_SUBJECT_MEMBERSHIP_PERIOD",
        );
      }
      prevEnd = entry.transferOutYear ?? Number.MAX_SAFE_INTEGER;
    });
  }
}

async function assertAllocationStandardUnique({
  unitId,
  subjectId,
  categoryId,
  excludeStandardId = null,
  db = prisma,
}) {
  const existed = await db.supplyAllocationStandard.findFirst({
    where: {
      unitId,
      subjectId,
      categoryId,
      deletedAt: null,
      ...(excludeStandardId ? { id: { not: excludeStandardId } } : {}),
    },
    select: {
      id: true,
    },
  });

  if (existed) {
    throwConflict(
      "Đơn vị đã có tiêu chuẩn cho danh sách cấp phát và danh mục này",
      "ALLOCATION_STANDARD_DUPLICATE",
    );
  }
}

async function assertAllocationServiceLifeRuleUnique({
  unitId,
  typeId,
  categoryId,
  excludeRuleId = null,
  db = prisma,
}) {
  const existed = await db.supplyAllocationServiceLifeRule.findFirst({
    where: {
      unitId,
      typeId,
      categoryId,
      ...(excludeRuleId ? { id: { not: excludeRuleId } } : {}),
    },
    select: {
      id: true,
      deletedAt: true,
    },
  });

  if (!existed) return null;

  throwConflict(
    existed.deletedAt
      ? "Quy định niên hạn cho loại quân nhân và danh mục này đã tồn tại ở trạng thái đã xoá"
      : "Quy định niên hạn cho loại quân nhân và danh mục này đã tồn tại",
    "ALLOCATION_SERVICE_LIFE_RULE_DUPLICATE",
  );
}

function buildStandardTupleLockKey({ unitId, subjectId, categoryId }) {
  return `allocation_standard:${Number(unitId)}:${Number(subjectId)}:${Number(categoryId)}`;
}

function buildServiceLifeRuleLockKey({ unitId, typeId, categoryId }) {
  return `allocation_service_life:${Number(unitId)}:${Number(typeId)}:${Number(categoryId)}`;
}

async function withMySqlNamedLock({ db = prisma, key, task, timeoutSeconds = 5 }) {
  const rows = await db.$queryRawUnsafe(
    "SELECT GET_LOCK(?, ?) AS acquired",
    String(key),
    Number(timeoutSeconds),
  );
  const acquired = Number(rows?.[0]?.acquired || 0);
  if (acquired !== 1) {
    throwConflict(
      "Hệ thống đang xử lý tiêu chuẩn cùng bộ danh mục, vui lòng thử lại",
      "ALLOCATION_STANDARD_LOCK_TIMEOUT",
    );
  }

  try {
    return await task();
  } finally {
    try {
      await db.$queryRawUnsafe("SELECT RELEASE_LOCK(?) AS released", String(key));
    } catch {
      // Ignore release lock errors to avoid hiding the original error.
    }
  }
}

async function assertWarehouseInUnit({ unitId, warehouseId, db = prisma }) {
  const warehouse = await db.warehouse.findFirst({
    where: {
      id: warehouseId,
      unitId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!warehouse) {
    throwNotFound("Kho xuất không tồn tại trong đơn vị", "WAREHOUSE_NOT_FOUND");
  }

  return warehouse;
}

async function resolveItemVariantId({ itemId, db = prisma }) {
  const item = await db.supplyItem.findFirst({
    where: {
      id: itemId,
      deletedAt: null,
    },
    select: {
      id: true,
      categoryId: true,
      versionId: true,
      colorId: true,
      category: {
        select: {
          versionId: true,
          colorId: true,
        },
      },
    },
  });

  if (!item) {
    throwNotFound("Mặt hàng không tồn tại", "ITEM_NOT_FOUND");
  }

  const versionId = Number(item.versionId || item.category?.versionId || 0);
  const colorId = Number(item.colorId || item.category?.colorId || 0);
  if (!versionId || !colorId) {
    throwBadRequest(
      `Mặt hàng itemId=${itemId} chưa có category variant hợp lệ`,
      "ITEM_VARIANT_NOT_FOUND",
    );
  }

  const variant = await db.categoryVariant.findFirst({
    where: {
      categoryId: item.categoryId,
      versionId,
      colorId,
      category: { deletedAt: null },
      version: { deletedAt: null },
      color: { deletedAt: null },
    },
    select: {
      id: true,
    },
  });

  if (!variant) {
    throwBadRequest(
      `Mặt hàng itemId=${itemId} chưa có category variant hợp lệ`,
      "ITEM_VARIANT_NOT_FOUND",
    );
  }

  return variant.id;
}

async function ensureWarehouseVariantLinked({ warehouseId, variantId, db = prisma }) {
  const linked = await db.categoryWarehouseStock.findUnique({
    where: {
      warehouseId_variantId: {
        warehouseId,
        variantId,
      },
    },
    select: {
      warehouseId: true,
      variantId: true,
    },
  });

  if (!linked) {
    throwBadRequest(
      "Mặt hàng chưa được gán vào kho",
      "WAREHOUSE_ITEM_NOT_LINKED",
    );
  }
}

async function getActiveMembershipAtYear({
  militaryId,
  subjectId,
  asOfYear,
  db = prisma,
}) {
  return db.militaryAllocationSubjectMembership.findFirst({
    where: {
      militaryId,
      subjectId,
      transferInYear: {
        lte: asOfYear,
      },
      OR: [
        { transferOutYear: null },
        {
          transferOutYear: {
            gte: asOfYear,
          },
        },
      ],
    },
    orderBy: [{ transferInYear: "desc" }, { createdAt: "desc" }],
    include: {
      subject: {
        select: {
          id: true,
          unitId: true,
          name: true,
          nameNormalized: true,
          deletedAt: true,
        },
      },
    },
  });
}

async function resolveApplicableServiceLifeForCategory({
  unitId,
  militaryId,
  categoryId,
  fallbackServiceLifeYears,
  requestedTypeId,
  militaryRankGroup,
  militaryGender,
  militaryTypeAssignments = null,
  db = prisma,
}) {
  const assignments =
    militaryTypeAssignments || (await fetchMilitaryTypeAssignments({ militaryId, db }));
  const assignedTypeIds = assignments
    .map((entry) => Number(entry.typeId))
    .filter((typeId) => Number.isInteger(typeId) && typeId > 0);

  if (requestedTypeId !== undefined && requestedTypeId !== null) {
    const parsedTypeId = Number.parseInt(requestedTypeId, 10);
    if (!Number.isInteger(parsedTypeId) || parsedTypeId <= 0) {
      throwBadRequest("typeId không hợp lệ", "INVALID_MILITARY_TYPE_ID");
    }
    if (!assignedTypeIds.includes(parsedTypeId)) {
      throwBadRequest(
        "Quân nhân không thuộc loại được yêu cầu",
        "MILITARY_TYPE_NOT_ASSIGNED",
      );
    }
  }

  const candidateTypeIds = Number.isInteger(Number(requestedTypeId))
    ? [Number(requestedTypeId)]
    : assignedTypeIds;

  if (!candidateTypeIds.length) {
    return {
      source: "STANDARD_DEFAULT",
      serviceLifeYears: Number(fallbackServiceLifeYears || 0),
      appliedType: null,
      rule: null,
      militaryTypes: assignments.map((entry) => mapMilitaryType(entry.type)),
    };
  }

  const rules = await db.supplyAllocationServiceLifeRule.findMany({
    where: {
      unitId,
      categoryId,
      deletedAt: null,
      typeId: {
        in: candidateTypeIds,
      },
    },
    orderBy: [{ typeId: "asc" }, { id: "asc" }],
    include: {
      type: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
    },
  });

  if (!rules.length) {
    return {
      source: "STANDARD_DEFAULT",
      serviceLifeYears: Number(fallbackServiceLifeYears || 0),
      appliedType: null,
      rule: null,
      militaryTypes: assignments.map((entry) => mapMilitaryType(entry.type)),
    };
  }

  const matchedRules = rules.filter((rule) =>
    isRuleMatched({
      rule: {
        mode: ALLOCATION_RULE_MODE.CONDITIONAL,
        gender: String(rule.gender || "ANY"),
        rankGroup: String(rule.rankGroup || "ANY"),
      },
      rankGroup: militaryRankGroup,
      gender: militaryGender,
    }),
  );

  if (!matchedRules.length) {
    return {
      source: "TYPE_RULE_BLOCKED",
      serviceLifeYears: null,
      appliedType: null,
      rule: null,
      militaryTypes: assignments.map((entry) => mapMilitaryType(entry.type)),
    };
  }

  if (matchedRules.length > 1 && !Number.isInteger(Number(requestedTypeId))) {
    throwConflict(
      "Quân nhân có nhiều loại cùng khớp niên hạn cho danh mục này, vui lòng chỉ định typeId",
      "ALLOCATION_SERVICE_LIFE_RULE_AMBIGUOUS",
      {
        militaryId,
        categoryId,
        typeIds: matchedRules.map((rule) => rule.typeId),
      },
    );
  }

  const appliedRule = matchedRules[0];
  return {
    source: "TYPE_RULE",
    serviceLifeYears: Number(appliedRule.serviceLifeYears || 0),
    appliedType: mapMilitaryType(appliedRule.type),
    rule: {
      id: appliedRule.id,
      typeId: appliedRule.typeId,
      categoryId,
      gender: String(appliedRule.gender || "ANY"),
      rankGroup: String(appliedRule.rankGroup || "ANY"),
    },
    militaryTypes: assignments.map((entry) => mapMilitaryType(entry.type)),
  };
}

function mapIssueVoucher(voucher) {
  return {
    id: voucher.id,
    voucherNo: voucher.voucherNo,
    issuedAt: voucher.issuedAt ? voucher.issuedAt.toISOString() : null,
    issuedYear: voucher.issuedYear,
    note: voucher.note,
    createdAt: voucher.createdAt ? voucher.createdAt.toISOString() : null,
    unit: voucher.unit
      ? {
          id: voucher.unit.id,
          name: voucher.unit.name,
        }
      : null,
    warehouse: voucher.warehouse
      ? {
          id: voucher.warehouse.id,
          name: voucher.warehouse.name,
        }
      : null,
    subject: voucher.subject
      ? {
          id: voucher.subject.id,
          name: voucher.subject.name,
        }
      : null,
    military: voucher.military
      ? {
          id: voucher.military.id,
          fullname: voucher.military.fullname,
          militaryCode: voucher.military.militaryCode,
          rank: getMilitaryRankLabel(voucher.military.rank),
          rankCode: voucher.military.rank,
          gender: voucher.military.genderCatalog?.code || voucher.military.gender || null,
        }
      : null,
    createdBy: voucher.createdBy
      ? {
          id: voucher.createdBy.id,
          username: voucher.createdBy.username,
          email: voucher.createdBy.email,
        }
      : null,
    items: (voucher.items || []).map((entry) => ({
      id: entry.id,
      standardId: entry.standardId,
      itemId: entry.itemId,
      quantity: entry.quantity,
      itemName: entry.itemName,
      itemCode: entry.itemCode,
      unitOfMeasureName: entry.unitOfMeasureName,
      categoryName: entry.categoryName,
      serviceLifeYears: entry.serviceLifeYears,
      appliedType: entry.appliedTypeId
        ? {
            id: entry.appliedTypeId,
            code: entry.appliedTypeCode || null,
            name: entry.appliedTypeName || null,
          }
        : null,
    })),
  };
}

export async function listAllocationSubjects({ actor, status = "active", unitId } = {}) {
  const scopedUnitId = resolveScopeUnitForRead({ actor, unitId });
  await ensureDefaultAllocationSubjects({ unitId: scopedUnitId });
  const defaultSubjectOrder = new Map(
    DEFAULT_ALLOCATION_SUBJECTS.map((name, index) => [normalizeForCompare(name), index]),
  );

  const where = {
    unitId: scopedUnitId,
    nameNormalized: {
      in: DEFAULT_ALLOCATION_SUBJECT_NORMALIZED_ARRAY,
    },
  };
  if (status === "active") where.deletedAt = null;
  if (status === "deleted") where.deletedAt = { not: null };

  const subjects = await prisma.supplyAllocationSubject.findMany({
    where,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    include: {
      unit: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  const mappedSubjects = subjects
    .map((subject) => {
      const mapped = mapSubject(subject);
      const order = defaultSubjectOrder.has(normalizeForCompare(mapped.name))
        ? defaultSubjectOrder.get(normalizeForCompare(mapped.name))
        : Number.MAX_SAFE_INTEGER;
      return { mapped, order };
    })
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.mapped.name.localeCompare(b.mapped.name, "vi");
    })
    .map((entry) => entry.mapped);

  return {
    unitId: scopedUnitId,
    subjects: mappedSubjects,
  };
}

export async function createAllocationSubject({ actor, body }) {
  const scopedUnitId = resolveScopeUnitForWrite({ actor, unitId: body?.unitId });
  await ensureDefaultAllocationSubjects({ unitId: scopedUnitId });

  const name = normalizeName(body?.name);
  if (!name) {
    throwBadRequest("Tên đối tượng cấp phát là bắt buộc", "ALLOCATION_SUBJECT_NAME_REQUIRED");
  }

  const nameNormalized = normalizeForCompare(name);
  if (!DEFAULT_ALLOCATION_SUBJECT_NORMALIZED.has(nameNormalized)) {
    throwBadRequest(
      "Hệ thống chỉ sử dụng 4 danh sách cấp phát mặc định theo nghiệp vụ",
      "ALLOCATION_SUBJECT_CUSTOM_DISABLED",
    );
  }
  const existed = await prisma.supplyAllocationSubject.findFirst({
    where: {
      unitId: scopedUnitId,
      nameNormalized,
    },
  });

  if (existed && !existed.deletedAt) {
    throwConflict("Đối tượng cấp phát đã tồn tại", "ALLOCATION_SUBJECT_DUPLICATE");
  }

  if (existed?.deletedAt) {
    const restored = await prisma.supplyAllocationSubject.update({
      where: { id: existed.id },
      data: {
        name,
        deletedAt: null,
      },
      include: {
        unit: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return { subject: mapSubject(restored) };
  }

  const subject = await prisma.supplyAllocationSubject.create({
    data: {
      unitId: scopedUnitId,
      name,
      nameNormalized,
    },
    include: {
      unit: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return { subject: mapSubject(subject) };
}

export async function deleteAllocationSubject({ actor, subjectId, unitId }) {
  const scopedUnitId = resolveScopeUnitForWrite({ actor, unitId });
  await ensureDefaultAllocationSubjects({ unitId: scopedUnitId });

  const id = Number.parseInt(subjectId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throwBadRequest("subjectId không hợp lệ", "INVALID_ALLOCATION_SUBJECT_ID");
  }

  const subject = await prisma.supplyAllocationSubject.findFirst({
    where: { id },
  });

  if (!subject) {
    throwNotFound("Đối tượng cấp phát không tồn tại", "ALLOCATION_SUBJECT_NOT_FOUND");
  }

  if (subject.unitId !== scopedUnitId) {
    throwForbidden(
      "Bạn không có quyền thao tác đối tượng cấp phát của đơn vị khác",
      "ALLOCATION_SUBJECT_SCOPE_FORBIDDEN",
    );
  }

  if (DEFAULT_ALLOCATION_SUBJECT_NORMALIZED.has(normalizeForCompare(subject.name))) {
    throwForbidden(
      "Không được xóa danh sách cấp phát mặc định của hệ thống",
      "ALLOCATION_SUBJECT_DEFAULT_PROTECTED",
    );
  }

  if (subject.deletedAt) return { id };

  const inUse = await prisma.supplyAllocationStandard.findFirst({
    where: {
      subjectId: id,
      unitId: scopedUnitId,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (inUse) {
    throwConflict(
      "Đối tượng cấp phát đang được sử dụng trong tiêu chuẩn cấp phát của đơn vị",
      "ALLOCATION_SUBJECT_IN_USE",
    );
  }

  await prisma.supplyAllocationSubject.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return { id };
}

export async function listAllocationSubjectMemberships({
  actor,
  militaryId,
  unitId,
  asOfYear,
} = {}) {
  const scopedUnitId = resolveScopeUnitForRead({ actor, unitId });
  await ensureDefaultAllocationSubjects({ unitId: scopedUnitId });

  const normalizedMilitaryId = String(militaryId || "").trim();
  if (!normalizedMilitaryId) {
    throwBadRequest("militaryId là bắt buộc", "MILITARY_ID_REQUIRED");
  }

  const effectiveYear = asOfYear !== undefined ? parseYearLike(asOfYear) : new Date().getUTCFullYear();

  const military = await prisma.military.findFirst({
    where: { id: normalizedMilitaryId, deletedAt: null },
    select: {
      id: true,
      unitId: true,
      fullname: true,
      militaryCode: true,
      rank: true,
      rankGroup: true,
      gender: true,
      genderCatalog: { select: { code: true } },
    },
  });

  if (!military) {
    throwNotFound("Quân nhân không tồn tại", "MILITARY_NOT_FOUND");
  }
  if (Number(military.unitId) !== Number(scopedUnitId)) {
    throwForbidden(
      "Bạn chỉ được xem danh sách cấp phát của quân nhân thuộc đơn vị của mình",
      "MILITARY_SCOPE_FORBIDDEN",
    );
  }

  const subjects = await prisma.supplyAllocationSubject.findMany({
    where: {
      unitId: scopedUnitId,
      deletedAt: null,
      nameNormalized: {
        in: DEFAULT_ALLOCATION_SUBJECT_NORMALIZED_ARRAY,
      },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      unitId: true,
      name: true,
      nameNormalized: true,
      deletedAt: true,
    },
  });

  const memberships = await prisma.militaryAllocationSubjectMembership.findMany({
    where: {
      militaryId: military.id,
      subjectId: {
        in: subjects.map((subject) => subject.id),
      },
    },
    orderBy: [{ subjectId: "asc" }, { transferInYear: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      militaryId: true,
      subjectId: true,
      transferInYear: true,
      transferOutYear: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const membershipsBySubjectId = new Map();
  memberships.forEach((entry) => {
    if (!membershipsBySubjectId.has(entry.subjectId)) membershipsBySubjectId.set(entry.subjectId, []);
    membershipsBySubjectId.get(entry.subjectId).push({
      id: entry.id,
      transferInYear: entry.transferInYear,
      transferOutYear: entry.transferOutYear,
      isActiveAtAsOfYear: isYearWithinRange({
        year: effectiveYear,
        transferInYear: entry.transferInYear,
        transferOutYear: entry.transferOutYear,
      }),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    });
  });

  const defaultSubjectOrder = new Map(
    DEFAULT_ALLOCATION_SUBJECTS.map((name, index) => [normalizeForCompare(name), index]),
  );

  const subjectMemberships = subjects
    .map((subject) => {
      const mappedSubject = mapSubject(subject);
      const periods = membershipsBySubjectId.get(subject.id) || [];
      return {
        subject: mappedSubject,
        periods,
        isActiveAtAsOfYear: periods.some((period) => period.isActiveAtAsOfYear),
      };
    })
    .sort((a, b) => {
      const orderA = defaultSubjectOrder.has(normalizeForCompare(a.subject.name))
        ? defaultSubjectOrder.get(normalizeForCompare(a.subject.name))
        : Number.MAX_SAFE_INTEGER;
      const orderB = defaultSubjectOrder.has(normalizeForCompare(b.subject.name))
        ? defaultSubjectOrder.get(normalizeForCompare(b.subject.name))
        : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return a.subject.name.localeCompare(b.subject.name, "vi");
    });

  return {
    unitId: scopedUnitId,
    asOfYear: effectiveYear,
    military: {
      id: military.id,
      fullname: military.fullname,
      militaryCode: military.militaryCode,
      rank: getMilitaryRankLabel(military.rank),
      rankCode: military.rank,
      rankGroup: military.rankGroup,
      gender: military.genderCatalog?.code || military.gender || null,
    },
    subjectMemberships,
  };
}

export async function setAllocationSubjectMemberships({ actor, body } = {}) {
  const scopedUnitId = resolveScopeUnitForWrite({ actor, unitId: body?.unitId });
  await ensureDefaultAllocationSubjects({ unitId: scopedUnitId });

  const militaryId = String(body?.militaryId || "").trim();
  if (!militaryId) {
    throwBadRequest("militaryId là bắt buộc", "MILITARY_ID_REQUIRED");
  }
  const requestedTypeId =
    body?.typeId === undefined || body?.typeId === null || body?.typeId === ""
      ? null
      : Number.parseInt(body.typeId, 10);
  if (requestedTypeId !== null && (!Number.isInteger(requestedTypeId) || requestedTypeId <= 0)) {
    throwBadRequest("typeId không hợp lệ", "INVALID_MILITARY_TYPE_ID");
  }

  const military = await prisma.military.findFirst({
    where: { id: militaryId, deletedAt: null },
    select: {
      id: true,
      unitId: true,
    },
  });
  if (!military) {
    throwNotFound("Quân nhân không tồn tại", "MILITARY_NOT_FOUND");
  }
  if (Number(military.unitId) !== Number(scopedUnitId)) {
    throwForbidden(
      "Bạn chỉ được cập nhật danh sách cấp phát của quân nhân thuộc đơn vị của mình",
      "MILITARY_SCOPE_FORBIDDEN",
    );
  }

  const payloadMemberships = Array.isArray(body?.memberships) ? body.memberships : [];
  const parsedMemberships = payloadMemberships.map((entry, index) => {
    const subjectId = Number.parseInt(entry?.subjectId, 10);
    if (!Number.isInteger(subjectId) || subjectId <= 0) {
      throwBadRequest(
        `subjectId không hợp lệ tại memberships[${index}]`,
        "INVALID_ALLOCATION_SUBJECT_ID",
      );
    }
    const transferInYear = parseYearLike(entry?.transferInYear);
    const transferOutYear =
      entry?.transferOutYear === undefined || entry?.transferOutYear === null || entry?.transferOutYear === ""
        ? null
        : parseYearLike(entry.transferOutYear);

    if (transferOutYear !== null && transferOutYear < transferInYear) {
      throwBadRequest(
        `transferOutYear phải lớn hơn hoặc bằng transferInYear tại memberships[${index}]`,
        "INVALID_MEMBERSHIP_YEAR_RANGE",
      );
    }

    return {
      subjectId,
      transferInYear,
      transferOutYear,
    };
  });

  const dedupeSet = new Set();
  parsedMemberships.forEach((entry) => {
    const key = `${entry.subjectId}:${entry.transferInYear}`;
    if (dedupeSet.has(key)) {
      throwBadRequest(
        "Không được trùng subjectId + transferInYear trong cùng một lần cập nhật",
        "DUPLICATED_SUBJECT_MEMBERSHIP_PERIOD",
      );
    }
    dedupeSet.add(key);
  });
  assertNoMembershipOverlap(parsedMemberships);

  const subjects = await prisma.supplyAllocationSubject.findMany({
    where: {
      unitId: scopedUnitId,
      deletedAt: null,
      nameNormalized: {
        in: DEFAULT_ALLOCATION_SUBJECT_NORMALIZED_ARRAY,
      },
    },
    select: {
      id: true,
      name: true,
    },
  });
  const subjectIdSet = new Set(subjects.map((subject) => subject.id));
  parsedMemberships.forEach((entry, index) => {
    if (!subjectIdSet.has(entry.subjectId)) {
      throwBadRequest(
        `subjectId tại memberships[${index}] không thuộc đơn vị hiện tại`,
        "ALLOCATION_SUBJECT_SCOPE_FORBIDDEN",
      );
    }
  });

  await prisma.$transaction(async (tx) => {
    await tx.militaryAllocationSubjectMembership.deleteMany({
      where: {
        militaryId,
        subjectId: {
          in: subjects.map((subject) => subject.id),
        },
      },
    });

    if (parsedMemberships.length) {
      await tx.militaryAllocationSubjectMembership.createMany({
        data: parsedMemberships.map((entry) => ({
          id: randomUUID(),
          militaryId,
          subjectId: entry.subjectId,
          transferInYear: entry.transferInYear,
          transferOutYear: entry.transferOutYear,
        })),
      });
    }
  });

  return listAllocationSubjectMemberships({
    actor,
    militaryId,
    unitId: scopedUnitId,
  });
}

export async function listAllocationServiceLifeRules({
  actor,
  typeId,
  categoryId,
  page,
  limit,
  status = "active",
  unitId,
}) {
  const scopedUnitId = resolveScopeUnitForRead({ actor, unitId });
  const currentPage = parsePositiveInt(page, 1);
  const pageSize = Math.min(parsePositiveInt(limit, 20), 100);

  const where = {
    unitId: scopedUnitId,
  };
  if (status === "active") where.deletedAt = null;
  if (status === "deleted") where.deletedAt = { not: null };

  if (typeId !== undefined) {
    const parsedTypeId = Number.parseInt(typeId, 10);
    if (!Number.isInteger(parsedTypeId) || parsedTypeId <= 0) {
      throwBadRequest("typeId không hợp lệ", "INVALID_MILITARY_TYPE_ID");
    }
    where.typeId = parsedTypeId;
  }

  if (categoryId !== undefined) {
    const parsedCategoryId = Number.parseInt(categoryId, 10);
    if (!Number.isInteger(parsedCategoryId) || parsedCategoryId <= 0) {
      throwBadRequest("categoryId không hợp lệ", "INVALID_CATEGORY_ID");
    }
    where.categoryId = parsedCategoryId;
  }

  const [total, rules] = await Promise.all([
    prisma.supplyAllocationServiceLifeRule.count({ where }),
    prisma.supplyAllocationServiceLifeRule.findMany({
      where,
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      include: {
        unit: {
          select: {
            id: true,
            name: true,
          },
        },
        type: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
  ]);

  return {
    unitId: scopedUnitId,
    rules: rules.map(mapServiceLifeRule),
    pagination: {
      page: currentPage,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 1,
    },
  };
}

export async function createAllocationServiceLifeRule({ actor, body }) {
  const scopedUnitId = resolveScopeUnitForWrite({ actor, unitId: body?.unitId });
  const typeId = Number.parseInt(body?.typeId, 10);
  const categoryId = Number.parseInt(body?.categoryId, 10);
  const serviceLifeYears = parseServiceLifeYears(body?.serviceLifeYears);
  const gender = parseAllocationRuleGender(body?.gender);
  const rankGroup = parseAllocationRankGroup(body?.rankGroup);

  if (!Number.isInteger(typeId) || typeId <= 0) {
    throwBadRequest("typeId không hợp lệ", "INVALID_MILITARY_TYPE_ID");
  }
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    throwBadRequest("categoryId không hợp lệ", "INVALID_CATEGORY_ID");
  }

  const rule = await withMySqlNamedLock({
    key: buildServiceLifeRuleLockKey({
      unitId: scopedUnitId,
      typeId,
      categoryId,
    }),
    task: async () => {
      await Promise.all([
        assertMilitaryTypeAvailable({ typeId }),
        assertCategoryAvailable({ categoryId }),
      ]);

      const existed = await prisma.supplyAllocationServiceLifeRule.findFirst({
        where: {
          unitId: scopedUnitId,
          typeId,
          categoryId,
        },
        include: {
          unit: {
            select: {
              id: true,
              name: true,
            },
          },
          type: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (existed?.deletedAt) {
        return prisma.supplyAllocationServiceLifeRule.update({
          where: {
            id: existed.id,
          },
          data: {
            serviceLifeYears,
            gender,
            rankGroup,
            deletedAt: null,
          },
          include: {
            unit: {
              select: {
                id: true,
                name: true,
              },
            },
            type: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
            category: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });
      }

      await assertAllocationServiceLifeRuleUnique({
        unitId: scopedUnitId,
        typeId,
        categoryId,
      });

      return prisma.supplyAllocationServiceLifeRule.create({
        data: {
          unitId: scopedUnitId,
          typeId,
          categoryId,
          serviceLifeYears,
          gender,
          rankGroup,
        },
        include: {
          unit: {
            select: {
              id: true,
              name: true,
            },
          },
          type: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
    },
  });

  return {
    rule: mapServiceLifeRule(rule),
  };
}

export async function updateAllocationServiceLifeRule({ actor, ruleId, body }) {
  const id = Number.parseInt(ruleId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throwBadRequest("ruleId không hợp lệ", "INVALID_ALLOCATION_SERVICE_LIFE_RULE_ID");
  }

  const current = await prisma.supplyAllocationServiceLifeRule.findFirst({
    where: {
      id,
    },
  });

  if (!current) {
    throwNotFound("Quy định niên hạn không tồn tại", "ALLOCATION_SERVICE_LIFE_RULE_NOT_FOUND");
  }

  const scopedUnitId = resolveScopeUnitForWrite({
    actor,
    unitId: body?.unitId ?? current.unitId,
  });

  if (Number(current.unitId) !== Number(scopedUnitId)) {
    throwForbidden(
      "Bạn không có quyền cập nhật quy định niên hạn của đơn vị khác",
      "ALLOCATION_SERVICE_LIFE_RULE_SCOPE_FORBIDDEN",
    );
  }

  const nextTypeId =
    body?.typeId !== undefined ? Number.parseInt(body.typeId, 10) : Number(current.typeId);
  const nextCategoryId =
    body?.categoryId !== undefined
      ? Number.parseInt(body.categoryId, 10)
      : Number(current.categoryId);

  if (!Number.isInteger(nextTypeId) || nextTypeId <= 0) {
    throwBadRequest("typeId không hợp lệ", "INVALID_MILITARY_TYPE_ID");
  }
  if (!Number.isInteger(nextCategoryId) || nextCategoryId <= 0) {
    throwBadRequest("categoryId không hợp lệ", "INVALID_CATEGORY_ID");
  }

  const patch = {};
  if (body?.typeId !== undefined) patch.typeId = nextTypeId;
  if (body?.categoryId !== undefined) patch.categoryId = nextCategoryId;
  if (body?.serviceLifeYears !== undefined) {
    patch.serviceLifeYears = parseServiceLifeYears(body.serviceLifeYears);
  }
  if (body?.gender !== undefined) {
    patch.gender = parseAllocationRuleGender(body.gender);
  }
  if (body?.rankGroup !== undefined) {
    patch.rankGroup = parseAllocationRankGroup(body.rankGroup);
  }

  const rule = await withMySqlNamedLock({
    key: buildServiceLifeRuleLockKey({
      unitId: scopedUnitId,
      typeId: nextTypeId,
      categoryId: nextCategoryId,
    }),
    task: async () => {
      await Promise.all([
        assertMilitaryTypeAvailable({ typeId: nextTypeId }),
        assertCategoryAvailable({ categoryId: nextCategoryId }),
        assertAllocationServiceLifeRuleUnique({
          unitId: scopedUnitId,
          typeId: nextTypeId,
          categoryId: nextCategoryId,
          excludeRuleId: id,
        }),
      ]);

      return prisma.supplyAllocationServiceLifeRule.update({
        where: {
          id,
        },
        data: patch,
        include: {
          unit: {
            select: {
              id: true,
              name: true,
            },
          },
          type: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
    },
  });

  return {
    rule: mapServiceLifeRule(rule),
  };
}

export async function deleteAllocationServiceLifeRule({ actor, ruleId, unitId }) {
  const scopedUnitId = resolveScopeUnitForWrite({ actor, unitId });
  const id = Number.parseInt(ruleId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throwBadRequest("ruleId không hợp lệ", "INVALID_ALLOCATION_SERVICE_LIFE_RULE_ID");
  }

  const rule = await prisma.supplyAllocationServiceLifeRule.findFirst({
    where: {
      id,
    },
    select: {
      id: true,
      unitId: true,
      deletedAt: true,
    },
  });

  if (!rule) {
    throwNotFound("Quy định niên hạn không tồn tại", "ALLOCATION_SERVICE_LIFE_RULE_NOT_FOUND");
  }

  if (Number(rule.unitId) !== Number(scopedUnitId)) {
    throwForbidden(
      "Bạn không có quyền xoá quy định niên hạn của đơn vị khác",
      "ALLOCATION_SERVICE_LIFE_RULE_SCOPE_FORBIDDEN",
    );
  }

  if (rule.deletedAt) return { id };

  await prisma.supplyAllocationServiceLifeRule.update({
    where: {
      id,
    },
    data: {
      deletedAt: new Date(),
    },
  });

  return { id };
}

export async function getAllocationServiceLifeEditor({ actor, typeId, unitId }) {
  const scopedUnitId = resolveScopeUnitForRead({ actor, unitId });
  const parsedTypeId = Number.parseInt(typeId, 10);
  if (!Number.isInteger(parsedTypeId) || parsedTypeId <= 0) {
    throwBadRequest("typeId không hợp lệ", "INVALID_MILITARY_TYPE_ID");
  }

  const [type, categories, rules] = await Promise.all([
    assertMilitaryTypeAvailable({ typeId: parsedTypeId }),
    prisma.category.findMany({
      where: {
        deletedAt: null,
        isActive: true,
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        code: true,
        unitOfMeasure: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    prisma.supplyAllocationServiceLifeRule.findMany({
      where: {
        unitId: scopedUnitId,
        typeId: parsedTypeId,
        deletedAt: null,
      },
      orderBy: [{ category: { name: "asc" } }, { id: "asc" }],
      include: {
        category: {
          select: {
            id: true,
            name: true,
            code: true,
            unitOfMeasure: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        type: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
    }),
  ]);

  const ruleByCategoryId = new Map(rules.map((rule) => [Number(rule.categoryId), rule]));

  return {
    unitId: scopedUnitId,
    type: mapMilitaryType(type),
    availableCategories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      code: category.code || null,
      unitOfMeasure: category.unitOfMeasure
        ? {
            id: category.unitOfMeasure.id,
            name: category.unitOfMeasure.name,
          }
        : null,
      selected: ruleByCategoryId.has(Number(category.id)),
    })),
    selectedRules: rules.map(mapServiceLifeRule),
  };
}

export async function saveAllocationServiceLifeEditor({ actor, body }) {
  const scopedUnitId = resolveScopeUnitForWrite({ actor, unitId: body?.unitId });
  const typeId = Number.parseInt(body?.typeId, 10);
  if (!Number.isInteger(typeId) || typeId <= 0) {
    throwBadRequest("typeId không hợp lệ", "INVALID_MILITARY_TYPE_ID");
  }

  const assignmentsRaw = Array.isArray(body?.assignments) ? body.assignments : [];
  const assignments = assignmentsRaw.map((entry, index) => {
    const categoryId = Number.parseInt(entry?.categoryId, 10);
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      throwBadRequest(
        `categoryId không hợp lệ tại assignments[${index}]`,
        "INVALID_CATEGORY_ID",
      );
    }
    return {
      categoryId,
      serviceLifeYears: parseServiceLifeYears(entry?.serviceLifeYears),
      gender: parseAllocationRuleGender(entry?.gender),
      rankGroup: parseAllocationRankGroup(entry?.rankGroup),
    };
  });

  const dedupeCategoryIds = new Set();
  assignments.forEach((entry) => {
    if (dedupeCategoryIds.has(entry.categoryId)) {
      throwBadRequest(
        "Không được chọn trùng categoryId trong cùng một lần lưu",
        "DUPLICATED_SERVICE_LIFE_CATEGORY",
      );
    }
    dedupeCategoryIds.add(entry.categoryId);
  });

  await assertMilitaryTypeAvailable({ typeId });
  await Promise.all(assignments.map((entry) => assertCategoryAvailable({ categoryId: entry.categoryId })));

  await prisma.$transaction(async (tx) => {
    const existing = await tx.supplyAllocationServiceLifeRule.findMany({
      where: {
        unitId: scopedUnitId,
        typeId,
      },
      select: {
        id: true,
        categoryId: true,
        deletedAt: true,
      },
    });

    const existingByCategoryId = new Map(existing.map((row) => [Number(row.categoryId), row]));
    const selectedCategoryIds = new Set(assignments.map((entry) => entry.categoryId));

    const deactivatedIds = existing
      .filter((row) => !row.deletedAt && !selectedCategoryIds.has(Number(row.categoryId)))
      .map((row) => row.id);

    if (deactivatedIds.length) {
      await tx.supplyAllocationServiceLifeRule.updateMany({
        where: {
          id: {
            in: deactivatedIds,
          },
        },
        data: {
          deletedAt: new Date(),
        },
      });
    }

    for (const entry of assignments) {
      const existed = existingByCategoryId.get(entry.categoryId);
      if (existed) {
        await tx.supplyAllocationServiceLifeRule.update({
          where: {
            id: existed.id,
          },
          data: {
            serviceLifeYears: entry.serviceLifeYears,
            gender: entry.gender,
            rankGroup: entry.rankGroup,
            deletedAt: null,
          },
        });
        continue;
      }

      await tx.supplyAllocationServiceLifeRule.create({
        data: {
          unitId: scopedUnitId,
          typeId,
          categoryId: entry.categoryId,
          serviceLifeYears: entry.serviceLifeYears,
          gender: entry.gender,
          rankGroup: entry.rankGroup,
        },
      });
    }
  });

  return getAllocationServiceLifeEditor({
    actor,
    typeId,
    unitId: scopedUnitId,
  });
}

export async function listAllocationStandards({
  actor,
  search,
  subjectId,
  categoryId,
  page,
  limit,
  status = "active",
  unitId,
}) {
  const scopedUnitId = resolveScopeUnitForRead({ actor, unitId });
  const currentPage = parsePositiveInt(page, 1);
  const pageSize = Math.min(parsePositiveInt(limit, 20), 100);

  const where = {
    unitId: scopedUnitId,
  };
  if (status === "active") where.deletedAt = null;
  if (status === "deleted") where.deletedAt = { not: null };

  if (search) {
    const q = normalizeForCompare(search);
    where.OR = [
      { subject: { nameNormalized: { contains: q } } },
      { category: { nameNormalized: { contains: q } } },
    ];
  }

  if (subjectId !== undefined) {
    const id = Number.parseInt(subjectId, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throwBadRequest("subjectId không hợp lệ", "INVALID_ALLOCATION_SUBJECT_ID");
    }
    where.subjectId = id;
  }

  if (categoryId !== undefined) {
    const id = Number.parseInt(categoryId, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throwBadRequest("categoryId không hợp lệ", "INVALID_CATEGORY_ID");
    }
    where.categoryId = id;
  }

  const [total, standards] = await Promise.all([
    prisma.supplyAllocationStandard.count({ where }),
    prisma.supplyAllocationStandard.findMany({
      where,
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      include: {
        unit: {
          select: {
            id: true,
            name: true,
          },
        },
        subject: {
          select: {
            id: true,
            name: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        items: {
          orderBy: [{ item: { name: "asc" } }, { itemId: "asc" }],
          include: {
            item: {
              select: {
                id: true,
                name: true,
                code: true,
                unitOfMeasure: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const standardIds = standards.map((standard) => standard.id);
  const ruleMapByStandardId = await fetchRuleMapByStandardIds({ standardIds });
  const campaignContentMap = await fetchCampaignContentMapByStandardIds({ standardIds });

  return {
    unitId: scopedUnitId,
    standards: standards.map((standard) =>
      mapStandard(
        standard,
        ruleMapByStandardId.get(standard.id) || new Map(),
        campaignContentMap.get(standard.id) || null,
      ),
    ),
    pagination: {
      page: currentPage,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 1,
    },
  };
}

export async function createAllocationStandard({ actor, body }) {
  const scopedUnitId = resolveScopeUnitForWrite({ actor, unitId: body?.unitId });

  const subjectId = Number.parseInt(body?.subjectId, 10);
  const categoryId = Number.parseInt(body?.categoryId, 10);
  const serviceLifeYears = parseServiceLifeYears(body?.serviceLifeYears);

  if (!Number.isInteger(subjectId) || subjectId <= 0) {
    throwBadRequest("subjectId không hợp lệ", "INVALID_ALLOCATION_SUBJECT_ID");
  }
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    throwBadRequest("categoryId không hợp lệ", "INVALID_CATEGORY_ID");
  }

  const itemQuantities = parseQuantities(body?.itemQuantities);
  const inputRules = parseItemRules(body?.itemRules);
  const campaignContent = String(body?.campaignContent || "").trim();
  const standardCondition = parseStandardCondition(body?.standardCondition);

  const standard = await withMySqlNamedLock({
    key: buildStandardTupleLockKey({
      unitId: scopedUnitId,
      subjectId,
      categoryId,
    }),
    task: async () => {
      await Promise.all([
        assertSubjectAvailable({ subjectId, unitId: scopedUnitId }),
        assertCategoryAvailable({ categoryId }),
        assertAllocationStandardUnique({
          unitId: scopedUnitId,
          subjectId,
          categoryId,
        }),
      ]);

      const categoryItems = await getCategoryActiveItems({ categoryId });

      return prisma.$transaction(async (tx) => {
        const created = await tx.supplyAllocationStandard.create({
          data: {
            unitId: scopedUnitId,
            subjectId,
            categoryId,
            serviceLifeYears,
          },
          select: { id: true },
        });

        if (categoryItems.length) {
          await tx.supplyAllocationStandardItem.createMany({
            data: categoryItems.map((item) => ({
              standardId: created.id,
              itemId: item.id,
              quantity: itemQuantities.get(item.id) || 0,
            })),
            skipDuplicates: true,
          });
        }

        const finalRules = new Map();
        categoryItems.forEach((item) => {
          const itemId = Number(item.id);
          if (!inputRules.has(itemId)) {
            finalRules.set(itemId, {
              mode: ALLOCATION_RULE_MODE.OPEN,
              gender: "ANY",
              rankGroup: "ANY",
            });
            return;
          }
          finalRules.set(itemId, inputRules.get(itemId));
        });
        await replaceStandardRules({ tx, standardId: created.id, rulesByItemId: finalRules });
        await tx.$executeRawUnsafe(
          `
            INSERT INTO supply_allocation_standard_campaign_contents
              (standardId, content, conditionField, conditionOperator, conditionIssueYearOffset, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
              content = VALUES(content),
              conditionField = VALUES(conditionField),
              conditionOperator = VALUES(conditionOperator),
              conditionIssueYearOffset = VALUES(conditionIssueYearOffset),
              updatedAt = NOW()
          `,
          created.id,
          campaignContent,
          standardCondition?.field || null,
          standardCondition?.operator || null,
          standardCondition?.issueYearOffset ?? null,
        );

        return tx.supplyAllocationStandard.findUnique({
          where: { id: created.id },
          include: {
            unit: {
              select: {
                id: true,
                name: true,
              },
            },
            subject: {
              select: {
                id: true,
                name: true,
              },
            },
            category: {
              select: {
                id: true,
                name: true,
              },
            },
            items: {
              orderBy: [{ item: { name: "asc" } }, { itemId: "asc" }],
              include: {
                item: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                    unitOfMeasure: {
                      select: {
                        id: true,
                        name: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });
      });
    },
  });

  const ruleMapByStandardId = await fetchRuleMapByStandardIds({ standardIds: [standard.id] });
  const campaignContentMap = await fetchCampaignContentMapByStandardIds({
    standardIds: [standard.id],
  });

  return {
    standard: mapStandard(
      standard,
      ruleMapByStandardId.get(standard.id) || new Map(),
      campaignContentMap.get(standard.id) || {
        content: campaignContent,
        standardCondition,
      },
    ),
  };
}

export async function updateAllocationStandard({ actor, standardId, body }) {
  const id = Number.parseInt(standardId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throwBadRequest("standardId không hợp lệ", "INVALID_ALLOCATION_STANDARD_ID");
  }

  const current = await prisma.supplyAllocationStandard.findFirst({
    where: {
      id,
      deletedAt: null,
    },
    include: {
      items: {
        select: {
          itemId: true,
          quantity: true,
        },
      },
    },
  });

  if (!current) {
    throwNotFound("Tiêu chuẩn cấp phát không tồn tại", "ALLOCATION_STANDARD_NOT_FOUND");
  }

  const scopedUnitId = resolveScopeUnitForWrite({
    actor,
    unitId: body?.unitId ?? current.unitId,
  });

  if (current.unitId !== scopedUnitId) {
    throwForbidden(
      "Bạn không có quyền cập nhật tiêu chuẩn của đơn vị khác",
      "ALLOCATION_STANDARD_SCOPE_FORBIDDEN",
    );
  }

  const patch = {};

  if (body?.subjectId !== undefined) {
    const subjectId = Number.parseInt(body.subjectId, 10);
    if (!Number.isInteger(subjectId) || subjectId <= 0) {
      throwBadRequest("subjectId không hợp lệ", "INVALID_ALLOCATION_SUBJECT_ID");
    }
    await assertSubjectAvailable({ subjectId, unitId: scopedUnitId });
    patch.subjectId = subjectId;
  }

  if (body?.categoryId !== undefined) {
    const categoryId = Number.parseInt(body.categoryId, 10);
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      throwBadRequest("categoryId không hợp lệ", "INVALID_CATEGORY_ID");
    }
    await assertCategoryAvailable({ categoryId });
    patch.categoryId = categoryId;
  }

  if (body?.serviceLifeYears !== undefined) {
    patch.serviceLifeYears = parseServiceLifeYears(body.serviceLifeYears);
  }
  const hasCampaignContent = body?.campaignContent !== undefined;
  const campaignContent = hasCampaignContent
    ? String(body?.campaignContent || "").trim()
    : null;
  const hasStandardCondition = body?.standardCondition !== undefined;
  const standardCondition = hasStandardCondition
    ? parseStandardCondition(body?.standardCondition)
    : null;

  const categoryIdForRows = patch.categoryId || current.categoryId;
  const subjectIdForRows = patch.subjectId || current.subjectId;
  const inputQuantities = parseQuantities(body?.itemQuantities);
  const hasInputRules = body?.itemRules !== undefined;
  const inputRules = parseItemRules(body?.itemRules);
  const existingRuleMapByStandardId = await fetchRuleMapByStandardIds({ standardIds: [id] });
  const existingRuleMap = existingRuleMapByStandardId.get(id) || new Map();
  const currentQuantityMap = new Map(current.items.map((entry) => [entry.itemId, entry.quantity]));

  const standard = await withMySqlNamedLock({
    key: buildStandardTupleLockKey({
      unitId: scopedUnitId,
      subjectId: subjectIdForRows,
      categoryId: categoryIdForRows,
    }),
    task: async () => {
      const categoryItems = await getCategoryActiveItems({ categoryId: categoryIdForRows });
      await assertAllocationStandardUnique({
        unitId: scopedUnitId,
        subjectId: subjectIdForRows,
        categoryId: categoryIdForRows,
        excludeStandardId: id,
      });
      const currentCampaignDataMap = await fetchCampaignContentMapByStandardIds({ standardIds: [id] });
      const currentCampaignData = currentCampaignDataMap.get(id) || {
        content: "",
        standardCondition: null,
      };
      const finalCampaignContent = hasCampaignContent
        ? campaignContent
        : String(currentCampaignData.content || "");
      const finalStandardCondition = hasStandardCondition
        ? standardCondition
        : currentCampaignData.standardCondition;

      return prisma.$transaction(async (tx) => {
        await tx.supplyAllocationStandard.update({
          where: { id },
          data: patch,
        });

        await tx.supplyAllocationStandardItem.deleteMany({
          where: { standardId: id },
        });

        if (categoryItems.length) {
          await tx.supplyAllocationStandardItem.createMany({
            data: categoryItems.map((item) => ({
              standardId: id,
              itemId: item.id,
              quantity: inputQuantities.has(item.id)
                ? inputQuantities.get(item.id)
                : (currentQuantityMap.get(item.id) || 0),
            })),
            skipDuplicates: true,
          });
        }

        const finalRules = new Map();
        categoryItems.forEach((item) => {
          const itemId = Number(item.id);
          if (hasInputRules && inputRules.has(itemId)) {
            finalRules.set(itemId, inputRules.get(itemId));
            return;
          }
          if (existingRuleMap.has(itemId)) {
            finalRules.set(itemId, existingRuleMap.get(itemId));
            return;
          }
          finalRules.set(itemId, {
            mode: ALLOCATION_RULE_MODE.OPEN,
            gender: "ANY",
            rankGroup: "ANY",
          });
        });
        await replaceStandardRules({ tx, standardId: id, rulesByItemId: finalRules });
        if (hasCampaignContent || hasStandardCondition) {
          await tx.$executeRawUnsafe(
            `
              INSERT INTO supply_allocation_standard_campaign_contents
                (standardId, content, conditionField, conditionOperator, conditionIssueYearOffset, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, NOW(), NOW())
              ON DUPLICATE KEY UPDATE
                content = VALUES(content),
                conditionField = VALUES(conditionField),
                conditionOperator = VALUES(conditionOperator),
                conditionIssueYearOffset = VALUES(conditionIssueYearOffset),
                updatedAt = NOW()
            `,
            id,
            finalCampaignContent,
            finalStandardCondition?.field || null,
            finalStandardCondition?.operator || null,
            finalStandardCondition?.issueYearOffset ?? null,
          );
        }

        return tx.supplyAllocationStandard.findUnique({
          where: { id },
          include: {
            unit: {
              select: {
                id: true,
                name: true,
              },
            },
            subject: {
              select: {
                id: true,
                name: true,
              },
            },
            category: {
              select: {
                id: true,
                name: true,
              },
            },
            items: {
              orderBy: [{ item: { name: "asc" } }, { itemId: "asc" }],
              include: {
                item: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                    unitOfMeasure: {
                      select: {
                        id: true,
                        name: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });
      });
    },
  });

  const ruleMapByStandardId = await fetchRuleMapByStandardIds({ standardIds: [standard.id] });
  const campaignContentMap = await fetchCampaignContentMapByStandardIds({
    standardIds: [standard.id],
  });

  return {
    standard: mapStandard(
      standard,
      ruleMapByStandardId.get(standard.id) || new Map(),
      campaignContentMap.get(standard.id) || null,
    ),
  };
}

export async function deleteAllocationStandard({ actor, standardId, unitId }) {
  const scopedUnitId = resolveScopeUnitForWrite({ actor, unitId });

  const id = Number.parseInt(standardId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throwBadRequest("standardId không hợp lệ", "INVALID_ALLOCATION_STANDARD_ID");
  }

  const standard = await prisma.supplyAllocationStandard.findFirst({
    where: { id },
    select: {
      id: true,
      unitId: true,
      deletedAt: true,
    },
  });

  if (!standard) {
    throwNotFound("Tiêu chuẩn cấp phát không tồn tại", "ALLOCATION_STANDARD_NOT_FOUND");
  }

  if (standard.unitId !== scopedUnitId) {
    throwForbidden(
      "Bạn không có quyền xóa tiêu chuẩn của đơn vị khác",
      "ALLOCATION_STANDARD_SCOPE_FORBIDDEN",
    );
  }

  if (standard.deletedAt) return { id };

  await prisma.supplyAllocationStandard.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return { id };
}

function isRuleMatched({ rule, rankGroup, gender }) {
  if (!rule || rule.mode === ALLOCATION_RULE_MODE.OPEN) return true;

  const expectedGender = String(rule.gender || "ANY");
  if (expectedGender !== "ANY" && expectedGender !== String(gender || "").toUpperCase()) {
    return false;
  }

  const expectedRankGroup = String(rule.rankGroup || "ANY");
  if (expectedRankGroup !== "ANY" && expectedRankGroup !== rankGroup) {
    return false;
  }

  return true;
}

export async function getAllocationEligibleItems({
  actor,
  subjectId,
  militaryId,
  categoryId,
  typeId,
  asOfDate,
  asOfYear,
  gender,
  unitId,
}) {
  const parsedSubjectId = Number.parseInt(subjectId, 10);
  if (!Number.isInteger(parsedSubjectId) || parsedSubjectId <= 0) {
    throwBadRequest("subjectId không hợp lệ", "INVALID_ALLOCATION_SUBJECT_ID");
  }

  const parsedCategoryId =
    categoryId !== undefined ? Number.parseInt(categoryId, 10) : undefined;
  if (
    parsedCategoryId !== undefined &&
    (!Number.isInteger(parsedCategoryId) || parsedCategoryId <= 0)
  ) {
    throwBadRequest("categoryId không hợp lệ", "INVALID_CATEGORY_ID");
  }
  const requestedTypeId =
    typeId === undefined || typeId === null || typeId === ""
      ? null
      : Number.parseInt(typeId, 10);
  if (requestedTypeId !== null && (!Number.isInteger(requestedTypeId) || requestedTypeId <= 0)) {
    throwBadRequest("typeId không hợp lệ", "INVALID_MILITARY_TYPE_ID");
  }

  const effectiveAsOfYear = parseAsOfYear({ asOfYear, asOfDate });
  const military = await prisma.military.findFirst({
    where: {
      id: String(militaryId || ""),
      deletedAt: null,
    },
    select: {
      id: true,
      unitId: true,
      initialCommissioningYear: true,
      rank: true,
      rankGroup: true,
      gender: true,
      genderCatalog: {
        select: {
          code: true,
        },
      },
      typeAssignments: {
        where: {
          type: {
            deletedAt: null,
          },
        },
        orderBy: [{ typeId: "asc" }],
        select: {
          typeId: true,
          type: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      },
    },
  });
  if (!military) {
    throwNotFound("Quân nhân không tồn tại", "MILITARY_NOT_FOUND");
  }

  if (
    requestedTypeId !== null &&
    !(military.typeAssignments || []).some((entry) => Number(entry.typeId) === Number(requestedTypeId))
  ) {
    throwBadRequest("Quân nhân không thuộc loại được yêu cầu", "MILITARY_TYPE_NOT_ASSIGNED");
  }

  const scopeUnitId = resolveScopeUnitForRead({ actor, unitId });
  if (Number(military.unitId) !== Number(scopeUnitId)) {
    throwForbidden(
      "Bạn chỉ được xem cấp phát cho quân nhân thuộc đơn vị của mình",
      "MILITARY_SCOPE_FORBIDDEN",
    );
  }

  const activeMembership = await getActiveMembershipAtYear({
    militaryId: military.id,
    subjectId: parsedSubjectId,
    asOfYear: effectiveAsOfYear,
  });
  if (!activeMembership || Number(activeMembership.subject?.unitId) !== Number(scopeUnitId)) {
    throwBadRequest(
      "Quân nhân không thuộc danh sách cấp phát này tại năm đang xét",
      "MILITARY_SUBJECT_MEMBERSHIP_NOT_ACTIVE",
    );
  }

  const normalizedGender = gender
    ? String(gender).toUpperCase()
    : String(military.genderCatalog?.code || military.gender || "").toUpperCase() || null;
  if (normalizedGender && !["MALE", "FEMALE"].includes(normalizedGender)) {
    throwBadRequest("gender không hợp lệ", "INVALID_GENDER");
  }

  const where = {
    deletedAt: null,
    unitId: scopeUnitId,
    subjectId: parsedSubjectId,
  };
  if (parsedCategoryId) where.categoryId = parsedCategoryId;

  const standards = await prisma.supplyAllocationStandard.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    include: {
      category: {
        select: {
          id: true,
          name: true,
        },
      },
      items: {
        orderBy: [{ item: { name: "asc" } }, { itemId: "asc" }],
        include: {
          item: {
            select: {
              id: true,
              name: true,
              code: true,
              unitOfMeasure: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const standardIds = standards.map((entry) => entry.id);
  const ruleMapByStandardId = await fetchRuleMapByStandardIds({ standardIds });
  const campaignContentMap = await fetchCampaignContentMapByStandardIds({ standardIds });
  const standardIssueRows = standardIds.length
    ? await prisma.$queryRawUnsafe(
        `
        SELECT standardId, MAX(issuedAt) AS lastIssuedAt
        FROM supply_allocation_issue_logs
        WHERE militaryId = ?
          AND issuedYear <= ?
          AND standardId IN (${standardIds.map(() => "?").join(", ")})
        GROUP BY standardId
      `,
        military.id,
        effectiveAsOfYear,
        ...standardIds,
      )
    : [];
  const issueRows = standardIds.length
    ? await prisma.$queryRawUnsafe(
        `
        SELECT standardId, itemId, MAX(issuedAt) AS lastIssuedAt
        FROM supply_allocation_issue_logs
        WHERE militaryId = ?
          AND issuedYear <= ?
          AND standardId IN (${standardIds.map(() => "?").join(", ")})
        GROUP BY standardId, itemId
      `,
        military.id,
        effectiveAsOfYear,
        ...standardIds,
      )
    : [];
  const standardIssueYearRows = standardIds.length
    ? await prisma.$queryRawUnsafe(
        `
        SELECT standardId, issuedYear
        FROM supply_allocation_issue_logs
        WHERE militaryId = ?
          AND standardId IN (${standardIds.map(() => "?").join(", ")})
        GROUP BY standardId, issuedYear
        ORDER BY issuedYear ASC
      `,
        military.id,
        ...standardIds,
      )
    : [];
  const itemIssueYearRows = standardIds.length
    ? await prisma.$queryRawUnsafe(
        `
        SELECT standardId, itemId, issuedYear
        FROM supply_allocation_issue_logs
        WHERE militaryId = ?
          AND standardId IN (${standardIds.map(() => "?").join(", ")})
        GROUP BY standardId, itemId, issuedYear
        ORDER BY issuedYear ASC
      `,
        military.id,
        ...standardIds,
      )
    : [];
  const issuedInYearRows = standardIds.length
    ? await prisma.$queryRawUnsafe(
        `
        SELECT standardId, itemId, SUM(quantity) AS issuedQuantityInYear
        FROM supply_allocation_issue_logs
        WHERE militaryId = ?
          AND issuedYear = ?
          AND standardId IN (${standardIds.map(() => "?").join(", ")})
        GROUP BY standardId, itemId
      `,
        military.id,
        effectiveAsOfYear,
        ...standardIds,
      )
    : [];

  const lastIssueMap = new Map();
  const standardLastIssueMap = new Map();
  standardIssueRows.forEach((row) => {
    const standardId = Number(row.standardId);
    if (!row.lastIssuedAt) return;
    standardLastIssueMap.set(standardId, new Date(row.lastIssuedAt));
  });
  const standardIssueYearMap = standardIssueYearRows.reduce((map, row) => {
    const standardId = Number(row.standardId);
    if (!map.has(standardId)) map.set(standardId, []);
    map.get(standardId).push(Number(row.issuedYear));
    return map;
  }, new Map());
  issueRows.forEach((row) => {
    const key = `${Number(row.standardId)}:${Number(row.itemId)}`;
    if (!row.lastIssuedAt) return;
    lastIssueMap.set(key, new Date(row.lastIssuedAt));
  });
  const itemIssueYearMap = itemIssueYearRows.reduce((map, row) => {
    const key = `${Number(row.standardId)}:${Number(row.itemId)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(Number(row.issuedYear));
    return map;
  }, new Map());
  const issuedInYearMap = new Map();
  issuedInYearRows.forEach((row) => {
    const key = `${Number(row.standardId)}:${Number(row.itemId)}`;
    issuedInYearMap.set(key, Number(row.issuedQuantityInYear || 0));
  });

  const militaryRank = String(military.rank || "");
  const militaryRankGroup = String(military.rankGroup || resolveRankGroup(militaryRank));
  const militaryTypes = (military.typeAssignments || []).map((entry) => mapMilitaryType(entry.type));
  const resolvedStandards = (
    await Promise.all(
      standards.map(async (standard) => {
      const campaignData = campaignContentMap.get(standard.id) || null;
      const standardCondition = campaignData?.standardCondition || null;
      const matchedStandardCondition = isStandardConditionMatched({
        standardCondition,
        military,
        asOfYear: effectiveAsOfYear,
      });
      if (!matchedStandardCondition) return null;

      const serviceLifeData = await resolveApplicableServiceLifeForCategory({
        unitId: scopeUnitId,
        militaryId: military.id,
        categoryId: standard.category?.id || standard.categoryId,
        fallbackServiceLifeYears: standard.serviceLifeYears,
        requestedTypeId,
        militaryRankGroup,
        militaryGender: normalizedGender,
        militaryTypeAssignments: (military.typeAssignments || []).map((entry) => ({
          typeId: entry.typeId,
          type: entry.type,
        })),
      });
      if (serviceLifeData.source === "TYPE_RULE_BLOCKED") return null;
      const standardTimeline = resolveServiceLifeTimeline({
        issueYears: standardIssueYearMap.get(Number(standard.id)) || [],
        referenceYear: effectiveAsOfYear,
        serviceLifeYears: Number(serviceLifeData.serviceLifeYears || 0),
      });
      const standardLastIssuedYear = standardTimeline.previousIssuedYear;
      const standardLastIssuedAt = standardLastIssueMap.get(standard.id) || null;
      const standardNextEligibleYear = standardTimeline.nextEligibleYear;
      const dueByCategoryCycle = standardTimeline.dueByServiceLife;
      if (!dueByCategoryCycle) return null;

      const itemRuleMap = ruleMapByStandardId.get(standard.id) || new Map();
      const eligibleItems = (standard.items || [])
        .filter((entry) => normalizeNumber(entry.quantity, 0) > 0)
        .map((entry) => {
          const rule = itemRuleMap.get(entry.itemId) || {
            mode: ALLOCATION_RULE_MODE.OPEN,
            gender: "ANY",
            rankGroup: "ANY",
          };
          const matched = isRuleMatched({
            rule,
            rankGroup: militaryRankGroup,
            gender: normalizedGender,
          });

          const key = `${standard.id}:${entry.itemId}`;
          const itemLastIssuedAt = lastIssueMap.get(key) || null;
          const itemTimeline = resolveServiceLifeTimeline({
            issueYears: itemIssueYearMap.get(key) || [],
            referenceYear: effectiveAsOfYear,
            serviceLifeYears: Number(serviceLifeData.serviceLifeYears || 0),
          });
          const itemLastIssuedYear = itemTimeline.previousIssuedYear;
          const annualQuota = Number(entry.quantity || 0);
          const issuedQuantityInYear = Number(issuedInYearMap.get(key) || 0);
          const remainingQuantityInYear = Math.max(annualQuota - issuedQuantityInYear, 0);
          const dueByAnnualQuota = remainingQuantityInYear > 0;

          if (
            !matched ||
            !dueByAnnualQuota
          ) {
            return null;
          }

          return {
            itemId: entry.itemId,
            itemName: entry.item?.name || "",
            itemCode: entry.item?.code || null,
            unitOfMeasure: entry.item?.unitOfMeasure
              ? {
                  id: entry.item.unitOfMeasure.id,
                  name: entry.item.unitOfMeasure.name,
                }
              : null,
            quantity: remainingQuantityInYear,
            annualQuota,
            issuedQuantityInYear,
            remainingQuantityInYear,
            itemRule: rule,
            // Keep item-level history for diagnostics, while eligibility cycle is by category.
            itemLastIssuedAt: itemLastIssuedAt ? itemLastIssuedAt.toISOString() : null,
            itemLastIssuedYear,
            lastIssuedAt: standardLastIssuedAt ? standardLastIssuedAt.toISOString() : null,
            lastIssuedYear: standardLastIssuedYear,
            nextEligibleYear: standardNextEligibleYear,
          };
        })
        .filter(Boolean);

      if (!eligibleItems.length) return null;

      return {
        standardId: standard.id,
        serviceLifeYears: Number(serviceLifeData.serviceLifeYears || 0),
        defaultServiceLifeYears: Number(standard.serviceLifeYears || 0),
        serviceLifeSource: serviceLifeData.source,
        appliedType: serviceLifeData.appliedType,
        campaignContent: String(campaignData?.content || "").trim() || null,
        standardCondition,
        lastIssuedAt: standardLastIssuedAt ? standardLastIssuedAt.toISOString() : null,
        lastIssuedYear: standardLastIssuedYear,
        nextEligibleYear: standardNextEligibleYear,
        category: standard.category
          ? {
              id: standard.category.id,
              name: standard.category.name,
            }
          : null,
        items: eligibleItems,
      };
      }),
    )
  ).filter(Boolean);

  const totalEligibleItems = resolvedStandards.reduce(
    (acc, standard) => acc + (standard.items?.length || 0),
    0,
  );

  return {
    asOfYear: effectiveAsOfYear,
    unitId: scopeUnitId,
    subjectId: parsedSubjectId,
    military: {
      id: military.id,
      initialCommissioningYear: military.initialCommissioningYear,
      rank: getMilitaryRankLabel(militaryRank),
      rankCode: militaryRank,
      rankGroup: militaryRankGroup,
      gender: normalizedGender,
      types: militaryTypes,
    },
    requestedTypeId,
    standards: resolvedStandards,
    summary: {
      totalCategories: resolvedStandards.length,
      totalEligibleItems,
    },
  };
}

export async function listAllocationIssueVouchers({
  actor,
  militaryId,
  warehouseId,
  page,
  limit,
  unitId,
}) {
  const scopedUnitId = resolveScopeUnitForRead({ actor, unitId });
  const currentPage = parsePositiveInt(page, 1);
  const pageSize = Math.min(parsePositiveInt(limit, 20), 100);

  const where = {
    unitId: scopedUnitId,
  };
  if (militaryId) {
    where.militaryId = String(militaryId).trim();
  }
  if (warehouseId !== undefined) {
    const parsedWarehouseId = Number.parseInt(warehouseId, 10);
    if (!Number.isInteger(parsedWarehouseId) || parsedWarehouseId <= 0) {
      throwBadRequest("warehouseId không hợp lệ", "INVALID_WAREHOUSE_ID");
    }
    where.warehouseId = parsedWarehouseId;
  }

  const [total, vouchers] = await Promise.all([
    prisma.supplyAllocationIssueVoucher.count({ where }),
    prisma.supplyAllocationIssueVoucher.findMany({
      where,
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
      orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
      include: {
        unit: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true } },
        subject: { select: { id: true, name: true } },
        military: {
          select: {
            id: true,
            fullname: true,
            militaryCode: true,
            rank: true,
            gender: true,
            genderCatalog: { select: { code: true } },
          },
        },
        createdBy: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
        items: {
          select: {
            id: true,
            standardId: true,
            itemId: true,
            appliedTypeId: true,
            appliedTypeCode: true,
            appliedTypeName: true,
            quantity: true,
            itemName: true,
            itemCode: true,
            unitOfMeasureName: true,
            categoryName: true,
            serviceLifeYears: true,
          },
        },
      },
    }),
  ]);

  return {
    unitId: scopedUnitId,
    vouchers: vouchers.map(mapIssueVoucher),
    pagination: {
      page: currentPage,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 1,
    },
  };
}

export async function listAllocationIssueHistory({
  actor,
  militaryId,
  categoryId,
  itemId,
  yearFrom,
  yearTo,
  page,
  limit,
  unitId,
}) {
  const scopedUnitId = resolveScopeUnitForRead({ actor, unitId });
  const normalizedMilitaryId = String(militaryId || "").trim();
  if (!normalizedMilitaryId) {
    throwBadRequest("militaryId là bắt buộc", "MILITARY_ID_REQUIRED");
  }

  const military = await prisma.military.findFirst({
    where: {
      id: normalizedMilitaryId,
      deletedAt: null,
    },
    select: {
      id: true,
      unitId: true,
      fullname: true,
      militaryCode: true,
      rank: true,
      gender: true,
      genderCatalog: {
        select: {
          code: true,
        },
      },
      typeAssignments: {
        where: {
          type: {
            deletedAt: null,
          },
        },
        orderBy: [{ typeId: "asc" }],
        select: {
          type: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      },
    },
  });

  if (!military) {
    throwNotFound("Quân nhân không tồn tại", "MILITARY_NOT_FOUND");
  }

  if (Number(military.unitId) !== Number(scopedUnitId)) {
    throwForbidden(
      "Bạn chỉ được xem lịch sử cấp phát của quân nhân thuộc đơn vị mình",
      "MILITARY_SCOPE_FORBIDDEN",
    );
  }

  const parsedCategoryId =
    categoryId === undefined ? null : Number.parseInt(categoryId, 10);
  if (parsedCategoryId !== null && (!Number.isInteger(parsedCategoryId) || parsedCategoryId <= 0)) {
    throwBadRequest("categoryId không hợp lệ", "INVALID_CATEGORY_ID");
  }

  const parsedItemId = itemId === undefined ? null : Number.parseInt(itemId, 10);
  if (parsedItemId !== null && (!Number.isInteger(parsedItemId) || parsedItemId <= 0)) {
    throwBadRequest("itemId không hợp lệ", "INVALID_ITEM_ID");
  }

  const parsedYearFrom = yearFrom === undefined ? null : parseYearLike(yearFrom);
  const parsedYearTo = yearTo === undefined ? null : parseYearLike(yearTo);
  if (parsedYearFrom !== null && parsedYearTo !== null && parsedYearTo < parsedYearFrom) {
    throwBadRequest("yearTo phải lớn hơn hoặc bằng yearFrom", "INVALID_YEAR_RANGE");
  }

  const currentPage = parsePositiveInt(page, 1);
  const pageSize = Math.min(parsePositiveInt(limit, 20), 100);

  const where = {
    voucher: {
      unitId: scopedUnitId,
      militaryId: normalizedMilitaryId,
      ...(parsedYearFrom !== null || parsedYearTo !== null
        ? {
            issuedYear: {
              ...(parsedYearFrom !== null ? { gte: parsedYearFrom } : {}),
              ...(parsedYearTo !== null ? { lte: parsedYearTo } : {}),
            },
          }
        : {}),
    },
    ...(parsedItemId !== null ? { itemId: parsedItemId } : {}),
    ...(parsedCategoryId !== null
      ? {
          standardItem: {
            standard: {
              categoryId: parsedCategoryId,
            },
          },
        }
      : {}),
  };

  const [total, aggregate, entries] = await Promise.all([
    prisma.supplyAllocationIssueVoucherItem.count({ where }),
    prisma.supplyAllocationIssueVoucherItem.aggregate({
      where,
      _sum: {
        quantity: true,
      },
    }),
    prisma.supplyAllocationIssueVoucherItem.findMany({
      where,
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
      orderBy: [
        {
          voucher: {
            issuedAt: "desc",
          },
        },
        { createdAt: "desc" },
      ],
      include: {
        voucher: {
          select: {
            id: true,
            voucherNo: true,
            issuedAt: true,
            issuedYear: true,
            note: true,
            warehouse: {
              select: {
                id: true,
                name: true,
              },
            },
            subject: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        standardItem: {
          select: {
            standardId: true,
            itemId: true,
            item: {
              select: {
                id: true,
                code: true,
              },
            },
            standard: {
              select: {
                categoryId: true,
                category: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
        appliedType: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
    }),
  ]);

  return {
    unitId: scopedUnitId,
    military: {
      id: military.id,
      fullname: military.fullname,
      militaryCode: military.militaryCode,
      rank: getMilitaryRankLabel(military.rank),
      rankCode: military.rank,
      gender: military.genderCatalog?.code || military.gender || null,
      types: (military.typeAssignments || []).map((entry) => mapMilitaryType(entry.type)),
    },
    histories: entries.map((entry) => ({
      id: entry.id,
      voucherId: entry.voucherId,
      voucherNo: entry.voucher?.voucherNo || null,
      standardId: entry.standardId,
      itemId: entry.itemId,
      quantity: entry.quantity,
      issuedAt: entry.voucher?.issuedAt ? entry.voucher.issuedAt.toISOString() : null,
      issuedYear: entry.voucher?.issuedYear ?? null,
      note: entry.voucher?.note || null,
      subject: entry.voucher?.subject
        ? {
            id: entry.voucher.subject.id,
            name: entry.voucher.subject.name,
          }
        : null,
      warehouse: entry.voucher?.warehouse
        ? {
            id: entry.voucher.warehouse.id,
            name: entry.voucher.warehouse.name,
          }
        : null,
      category: {
        id: entry.standardItem?.standard?.category?.id || entry.standardItem?.standard?.categoryId,
        name: entry.categoryName || entry.standardItem?.standard?.category?.name || null,
      },
      item: {
        id: entry.standardItem?.item?.id || entry.itemId,
        name: entry.itemName,
        code: entry.itemCode || entry.standardItem?.item?.code || null,
        unitOfMeasureName: entry.unitOfMeasureName || null,
      },
      serviceLifeYears: entry.serviceLifeYears,
      appliedType: entry.appliedType
        ? mapMilitaryType(entry.appliedType)
        : entry.appliedTypeId
          ? {
              id: entry.appliedTypeId,
              code: entry.appliedTypeCode || null,
              name: entry.appliedTypeName || null,
            }
          : null,
    })),
    summary: {
      totalRecords: total,
      totalQuantity: Number(aggregate._sum.quantity || 0),
    },
    pagination: {
      page: currentPage,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 1,
    },
  };
}

export async function getAllocationIssueVoucherById({ actor, voucherId, unitId }) {
  const scopedUnitId = resolveScopeUnitForRead({ actor, unitId });
  const id = String(voucherId || "").trim();
  if (!id) {
    throwBadRequest("voucherId không hợp lệ", "INVALID_VOUCHER_ID");
  }

  const voucher = await prisma.supplyAllocationIssueVoucher.findFirst({
    where: {
      id,
      unitId: scopedUnitId,
    },
    include: {
      unit: { select: { id: true, name: true } },
      warehouse: { select: { id: true, name: true } },
      subject: { select: { id: true, name: true } },
      military: {
        select: {
          id: true,
          fullname: true,
          militaryCode: true,
          rank: true,
          gender: true,
          genderCatalog: { select: { code: true } },
        },
      },
      createdBy: {
        select: {
          id: true,
          username: true,
          email: true,
        },
      },
      items: {
        orderBy: [{ categoryName: "asc" }, { itemName: "asc" }, { itemId: "asc" }],
      },
    },
  });

  if (!voucher) {
    throwNotFound("Phiếu xuất không tồn tại", "ALLOCATION_ISSUE_VOUCHER_NOT_FOUND");
  }

  return {
    unitId: scopedUnitId,
    voucher: mapIssueVoucher(voucher),
  };
}

export async function createAllocationIssueLog({ actor, body }) {
  const standardId = Number.parseInt(body?.standardId, 10);
  if (!Number.isInteger(standardId) || standardId <= 0) {
    throwBadRequest("standardId không hợp lệ", "INVALID_ALLOCATION_STANDARD_ID");
  }

  const requestedTypeId =
    body?.typeId === undefined || body?.typeId === null || body?.typeId === ""
      ? null
      : Number.parseInt(body.typeId, 10);
  if (requestedTypeId !== null && (!Number.isInteger(requestedTypeId) || requestedTypeId <= 0)) {
    throwBadRequest("typeId không hợp lệ", "INVALID_MILITARY_TYPE_ID");
  }

  const warehouseId = Number.parseInt(body?.warehouseId, 10);
  if (!Number.isInteger(warehouseId) || warehouseId <= 0) {
    throwBadRequest("warehouseId không hợp lệ", "INVALID_WAREHOUSE_ID");
  }

  const militaryId = String(body?.militaryId || "").trim();
  if (!militaryId) {
    throwBadRequest("militaryId là bắt buộc", "MILITARY_ID_REQUIRED");
  }

  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) {
    throwBadRequest("Phải có ít nhất một mặt hàng được cấp", "ALLOCATION_ISSUE_ITEMS_REQUIRED");
  }

  const issueItems = items.map((entry, index) => {
    const itemId = Number.parseInt(entry?.itemId, 10);
    const quantity = Number.parseInt(entry?.quantity, 10);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      throwBadRequest(`itemId không hợp lệ tại items[${index}]`, "INVALID_STANDARD_ITEM_ID");
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throwBadRequest(
        `quantity không hợp lệ tại items[${index}]`,
        "INVALID_STANDARD_ITEM_QUANTITY",
      );
    }
    return { itemId, quantity };
  });
  const uniqueItemCount = new Set(issueItems.map((entry) => entry.itemId)).size;
  if (uniqueItemCount !== issueItems.length) {
    throwBadRequest("Không được gửi trùng itemId trong cùng một lần cấp phát", "DUPLICATED_ITEM_ID");
  }

  const issuedAt = parseDateTimeOrNow(body?.issuedAt);
  const issuedYear = getYearFromDate(issuedAt);
  const note = String(body?.note || "").trim() || null;

  const [military, standard] = await Promise.all([
    prisma.military.findFirst({
      where: { id: militaryId, deletedAt: null },
      select: { id: true, unitId: true, fullname: true, militaryCode: true },
    }),
    prisma.supplyAllocationStandard.findFirst({
      where: { id: standardId, deletedAt: null },
      select: { id: true, unitId: true, subjectId: true, categoryId: true },
    }),
  ]);
  if (!military) throwNotFound("Quân nhân không tồn tại", "MILITARY_NOT_FOUND");
  if (!standard) {
    throwNotFound("Tiêu chuẩn cấp phát không tồn tại", "ALLOCATION_STANDARD_NOT_FOUND");
  }

  const actorScopeUnitId = resolveScopeUnitForWrite({ actor, unitId: body?.unitId ?? standard.unitId });
  if (Number(standard.unitId) !== Number(actorScopeUnitId)) {
    throwForbidden("Bạn không có quyền cấp phát theo tiêu chuẩn của đơn vị khác", "STANDARD_SCOPE_FORBIDDEN");
  }
  if (Number(military.unitId) !== Number(actorScopeUnitId)) {
    throwForbidden("Bạn chỉ được cấp phát cho quân nhân thuộc đơn vị của mình", "MILITARY_SCOPE_FORBIDDEN");
  }

  await assertWarehouseInUnit({ unitId: actorScopeUnitId, warehouseId });

  const standardItems = await prisma.supplyAllocationStandardItem.findMany({
    where: { standardId },
    include: {
      item: {
        select: {
          id: true,
          name: true,
          code: true,
          unitOfMeasure: {
            select: {
              name: true,
            },
          },
        },
      },
      standard: {
        select: {
          category: {
            select: {
              name: true,
            },
          },
          serviceLifeYears: true,
        },
      },
    },
  });
  const standardQuantityByItemId = new Map();
  const standardItemByItemId = new Map();
  standardItems.forEach((entry) => {
    const itemId = Number(entry.itemId);
    standardQuantityByItemId.set(itemId, Number(entry.quantity || 0));
    standardItemByItemId.set(itemId, entry);
  });
  const validItemIds = new Set([...standardQuantityByItemId.keys()]);
  issueItems.forEach((entry, index) => {
    if (!validItemIds.has(entry.itemId)) {
      throwBadRequest(
        `itemId tại items[${index}] không thuộc tiêu chuẩn`,
        "STANDARD_ITEM_NOT_FOUND",
      );
    }
  });

  const eligibility = await getAllocationEligibleItems({
    actor,
    subjectId: standard.subjectId,
    militaryId,
    categoryId: standard.categoryId,
    typeId: requestedTypeId,
    asOfYear: issuedYear,
    unitId: actorScopeUnitId,
  });
  const eligibleStandard = (eligibility.standards || []).find(
    (entry) => Number(entry.standardId) === Number(standardId),
  );
  if (!eligibleStandard) {
    throwBadRequest(
      "Tiêu chuẩn này chưa đến niên cấp phát hoặc quân nhân không đủ điều kiện",
      "STANDARD_NOT_ELIGIBLE_FOR_ISSUE",
    );
  }

  const eligibleItemQuantityById = new Map(
    (eligibleStandard.items || []).map((entry) => [Number(entry.itemId), Number(entry.quantity || 0)]),
  );
  issueItems.forEach((entry, index) => {
    if (!eligibleItemQuantityById.has(entry.itemId)) {
      throwBadRequest(
        `items[${index}] không đủ điều kiện cấp phát theo tiêu chuẩn hiện tại`,
        "ITEM_NOT_ELIGIBLE_FOR_ISSUE",
      );
    }

    const annualRemainingQuantity = eligibleItemQuantityById.get(entry.itemId) || 0;
    if (entry.quantity > annualRemainingQuantity) {
      throwBadRequest(
        `quantity tại items[${index}] vượt quá hạn mức còn lại trong năm`,
        "ISSUE_QUANTITY_EXCEEDS_ANNUAL_QUOTA",
      );
    }

    const standardQuantity = standardQuantityByItemId.get(entry.itemId) || 0;
    if (entry.quantity > standardQuantity) {
      throwBadRequest(
        `quantity tại items[${index}] vượt quá số lượng chuẩn của mặt hàng`,
        "ISSUE_QUANTITY_EXCEEDS_STANDARD",
      );
    }
  });

  const effectiveServiceLifeYears = Number(eligibleStandard.serviceLifeYears || 0);
  const appliedType = eligibleStandard.appliedType || null;
  const variantIdByItemId = new Map(
    await Promise.all(
      issueItems.map(async (entry) => [
        entry.itemId,
        await resolveItemVariantId({ itemId: entry.itemId }),
      ]),
    ),
  );

  const createdById = actor?.id || null;
  const voucherId = randomUUID();
  const voucherNo = buildVoucherNo(issuedAt);

  await prisma.$transaction(async (tx) => {
    await tx.supplyAllocationIssueVoucher.create({
      data: {
        id: voucherId,
        voucherNo,
        unitId: actorScopeUnitId,
        warehouseId,
        militaryId,
        subjectId: standard.subjectId,
        issuedAt,
        issuedYear,
        note,
        createdById,
      },
    });

    for (const entry of issueItems) {
      const variantId = variantIdByItemId.get(entry.itemId);
      await ensureWarehouseVariantLinked({
        warehouseId,
        variantId,
        db: tx,
      });

      const decremented = await tx.categoryWarehouseStock.updateMany({
        where: {
          warehouseId,
          variantId,
          quantity: {
            gte: entry.quantity,
          },
        },
        data: {
          quantity: {
            decrement: entry.quantity,
          },
        },
      });

      if (decremented.count !== 1) {
        const currentStock = await tx.categoryWarehouseStock.findUnique({
          where: {
            warehouseId_variantId: {
              warehouseId,
              variantId,
            },
          },
          select: {
            quantity: true,
          },
        });
        throwBadRequest(
          `Tồn kho không đủ cho itemId=${entry.itemId}. Tồn: ${Number(currentStock?.quantity || 0)}, yêu cầu: ${entry.quantity}`,
          "INSUFFICIENT_STOCK",
        );
      }

      const stock = await tx.categoryWarehouseStock.findUnique({
        where: {
          warehouseId_variantId: {
            warehouseId,
            variantId,
          },
        },
        select: {
          quantity: true,
        },
      });
      const quantityAfter = Number(stock?.quantity || 0);
      const quantityBefore = quantityAfter + entry.quantity;

      await tx.stockAdjustmentLog.create({
        data: {
          warehouseId,
          itemId: entry.itemId,
          quantityBefore,
          delta: -entry.quantity,
          quantityAfter,
          note: `Xuất cấp phát ${voucherNo}`,
          createdById,
        },
      });
    }

    await tx.supplyAllocationIssueLog.createMany({
      data: issueItems.map((entry) => ({
        id: randomUUID(),
        militaryId,
        standardId,
        itemId: entry.itemId,
        warehouseId,
        voucherId,
        appliedTypeId: appliedType?.id || null,
        quantity: entry.quantity,
        issuedAt,
        issuedYear,
        createdById,
        note,
      })),
    });

    await tx.supplyAllocationIssueVoucherItem.createMany({
      data: issueItems.map((entry) => {
        const standardItem = standardItemByItemId.get(entry.itemId);
        return {
          id: randomUUID(),
          voucherId,
          standardId,
          itemId: entry.itemId,
          appliedTypeId: appliedType?.id || null,
          appliedTypeCode: appliedType?.code || null,
          appliedTypeName: appliedType?.name || null,
          quantity: entry.quantity,
          itemName: standardItem?.item?.name || "",
          itemCode: standardItem?.item?.code || null,
          unitOfMeasureName: standardItem?.item?.unitOfMeasure?.name || null,
          categoryName: standardItem?.standard?.category?.name || null,
          serviceLifeYears: effectiveServiceLifeYears,
        };
      }),
    });
  });

  const voucher = await prisma.supplyAllocationIssueVoucher.findFirst({
    where: {
      id: voucherId,
      unitId: actorScopeUnitId,
    },
    include: {
      unit: {
        select: {
          id: true,
          name: true,
        },
      },
      warehouse: {
        select: {
          id: true,
          name: true,
        },
      },
      subject: {
        select: {
          id: true,
          name: true,
        },
      },
      military: {
        select: {
          id: true,
          fullname: true,
          militaryCode: true,
          rank: true,
          gender: true,
          genderCatalog: {
            select: {
              code: true,
            },
          },
        },
      },
      createdBy: {
        select: {
          id: true,
          username: true,
          email: true,
        },
      },
      items: {
        orderBy: [{ categoryName: "asc" }, { itemName: "asc" }, { itemId: "asc" }],
      },
    },
  });

  return {
    unitId: actorScopeUnitId,
    militaryId,
    standardId,
    warehouseId,
    appliedType,
    issuedAt: issuedAt.toISOString(),
    issuedYear,
    itemCount: issueItems.length,
    voucher: voucher ? mapIssueVoucher(voucher) : null,
  };
}
