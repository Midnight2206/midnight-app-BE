import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import { normalizeVietnameseSearchText } from "#utils/searchNormalizer.js";
import { normalizeMilitaryGender } from "#services/militaries/common.js";

const MILITARY_RANK_DEFINITIONS = [
  { code: "THIEU_UY", label: "Thiếu úy", group: "CAP_UY" },
  { code: "TRUNG_UY", label: "Trung úy", group: "CAP_UY" },
  { code: "THUONG_UY", label: "Thượng úy", group: "CAP_UY" },
  { code: "DAI_UY", label: "Đại úy", group: "CAP_UY" },
  { code: "THIEU_TA", label: "Thiếu tá", group: "CAP_TA" },
  { code: "TRUNG_TA", label: "Trung tá", group: "CAP_TA" },
  { code: "THUONG_TA", label: "Thượng tá", group: "CAP_TA" },
  { code: "DAI_TA", label: "Đại tá", group: "CAP_TA" },
  { code: "THIEU_TUONG", label: "Thiếu tướng", group: "CAP_TUONG" },
  { code: "TRUNG_TUONG", label: "Trung tướng", group: "CAP_TUONG" },
  { code: "THUONG_TUONG", label: "Thượng tướng", group: "CAP_TUONG" },
  { code: "DAI_TUONG", label: "Đại tướng", group: "CAP_TUONG" },
  { code: "BINH_NHI", label: "Binh nhì", group: "HSQ_BS" },
  { code: "BINH_NHAT", label: "Binh nhất", group: "HSQ_BS" },
  { code: "HA_SI", label: "Hạ sĩ", group: "HSQ_BS" },
  { code: "TRUNG_SI", label: "Trung sĩ", group: "HSQ_BS" },
  { code: "THUONG_SI", label: "Thượng sĩ", group: "HSQ_BS" },
];

const RANK_BY_CODE = new Map(MILITARY_RANK_DEFINITIONS.map((item) => [item.code, item]));
const RANK_BY_TEXT_KEY = new Map();
for (const rank of MILITARY_RANK_DEFINITIONS) {
  const normalizedLabel = normalizeRankText(rank.label);
  RANK_BY_TEXT_KEY.set(normalizedLabel, rank);
  RANK_BY_TEXT_KEY.set(rank.code, rank);
}

function normalizeRankText(value) {
  return normalizeVietnameseSearchText(value || "")
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function normalizeMilitaryRankCode(
  value,
  { required = false, fieldName = "rank" } = {},
) {
  const raw = String(value || "").trim();
  if (!raw) {
    if (required) {
      throw new AppError({
        message: `${fieldName} is required`,
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "RANK_REQUIRED",
      });
    }
    return null;
  }

  const normalized = normalizeRankText(raw);
  const rank = RANK_BY_TEXT_KEY.get(normalized);

  if (!rank) {
    throw new AppError({
      message: `${fieldName} is invalid. Allowed values: ${MILITARY_RANK_DEFINITIONS.map((item) => item.code).join(", ")}`,
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "INVALID_RANK",
    });
  }

  return rank.code;
}

export function resolveMilitaryRankGroupFromCode(rankCode) {
  return RANK_BY_CODE.get(String(rankCode || ""))?.group || "HSQ_BS";
}

export function getMilitaryRankLabel(rankCode) {
  return RANK_BY_CODE.get(String(rankCode || ""))?.label || String(rankCode || "");
}

export function resolveMilitaryRankSearchCandidates(keyword) {
  const q = normalizeVietnameseSearchText(keyword || "");
  if (!q) return { rankCodes: [], rankGroups: [] };

  const rankCodes = MILITARY_RANK_DEFINITIONS.filter((item) => {
    const code = item.code.toLowerCase();
    const label = normalizeVietnameseSearchText(item.label);
    return code.includes(q) || label.includes(q);
  }).map((item) => item.code);

  const rankGroups = [...new Set(rankCodes.map((code) => resolveMilitaryRankGroupFromCode(code)))];
  return { rankCodes, rankGroups };
}

export async function resolveMilitaryGenderCatalogRecord({
  tx = prisma,
  value,
  required = false,
  fieldName = "gender",
}) {
  const code = normalizeMilitaryGender(value, { required, fieldName });
  if (!code) return null;

  const existing = await tx.militaryGenderCatalog.findFirst({
    where: {
      codeNormalized: code,
      deletedAt: null,
    },
    select: {
      id: true,
      code: true,
      codeNormalized: true,
    },
  });

  if (!existing) {
    throw new AppError({
      message: `Unknown gender code: ${code}`,
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "UNKNOWN_MILITARY_GENDER",
    });
  }

  return existing;
}
