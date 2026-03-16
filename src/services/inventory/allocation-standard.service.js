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

function buildStandardTupleLockKey({ unitId, subjectId, categoryId }) {
  return `allocation_standard:${Number(unitId)}:${Number(subjectId)}:${Number(categoryId)}`;
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

  const variantIdByItemId = new Map(
    await Promise.all(
      issueItems.map(async (entry) => [entry.itemId, await resolveItemVariantId({ itemId: entry.itemId })]),
    ),
  );

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
    },
  });
  if (!military) {
    throwNotFound("Quân nhân không tồn tại", "MILITARY_NOT_FOUND");
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
          AND standardId IN (${standardIds.map(() => "?").join(", ")})
        GROUP BY standardId
      `,
        military.id,
        ...standardIds,
      )
    : [];
  const issueRows = standardIds.length
    ? await prisma.$queryRawUnsafe(
        `
        SELECT standardId, itemId, MAX(issuedAt) AS lastIssuedAt
        FROM supply_allocation_issue_logs
        WHERE militaryId = ?
          AND standardId IN (${standardIds.map(() => "?").join(", ")})
        GROUP BY standardId, itemId
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
  issueRows.forEach((row) => {
    const key = `${Number(row.standardId)}:${Number(row.itemId)}`;
    if (!row.lastIssuedAt) return;
    lastIssueMap.set(key, new Date(row.lastIssuedAt));
  });
  const issuedInYearMap = new Map();
  issuedInYearRows.forEach((row) => {
    const key = `${Number(row.standardId)}:${Number(row.itemId)}`;
    issuedInYearMap.set(key, Number(row.issuedQuantityInYear || 0));
  });

  const militaryRank = String(military.rank || "");
  const militaryRankGroup = String(military.rankGroup || resolveRankGroup(militaryRank));
  const eligibleStandards = standards
    .map((standard) => {
      const campaignData = campaignContentMap.get(standard.id) || null;
      const standardCondition = campaignData?.standardCondition || null;
      const matchedStandardCondition = isStandardConditionMatched({
        standardCondition,
        military,
        asOfYear: effectiveAsOfYear,
      });
      if (!matchedStandardCondition) return null;

      const standardLastIssuedAt = standardLastIssueMap.get(standard.id) || null;
      const standardLastIssuedYear = standardLastIssuedAt
        ? getYearFromDate(standardLastIssuedAt)
        : null;
      const standardNextEligibleYear =
        standardLastIssuedYear !== null
          ? standardLastIssuedYear + Number(standard.serviceLifeYears || 0)
          : null;
      const dueByCategoryCycle =
        standardNextEligibleYear === null || standardNextEligibleYear <= effectiveAsOfYear;
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
          const itemLastIssuedYear = itemLastIssuedAt ? getYearFromDate(itemLastIssuedAt) : null;
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
        serviceLifeYears: standard.serviceLifeYears,
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
    })
    .filter(Boolean);

  const totalEligibleItems = eligibleStandards.reduce(
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
    },
    standards: eligibleStandards,
    summary: {
      totalCategories: eligibleStandards.length,
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
          quantity: entry.quantity,
          itemName: standardItem?.item?.name || "",
          itemCode: standardItem?.item?.code || null,
          unitOfMeasureName: standardItem?.item?.unitOfMeasure?.name || null,
          categoryName: standardItem?.standard?.category?.name || null,
          serviceLifeYears: Number(standardItem?.standard?.serviceLifeYears || 0),
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
    issuedAt: issuedAt.toISOString(),
    issuedYear,
    itemCount: issueItems.length,
    voucher: voucher ? mapIssueVoucher(voucher) : null,
  };
}
