import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import { prisma } from "#configs/prisma.config.js";
import {
  mapPrintTemplateUsage,
  printTemplateService,
} from "#services/print-template.service.js";
import { readWorkbookFromBuffer, writeWorkbookToBuffer } from "#services/spreadsheet/excel.util.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import { ensureAnyRole, hasAnyRole } from "#utils/roleGuards.js";

function normalizeName(value) {
  return String(value || "").normalize("NFC").trim();
}

function normalizeForCompare(value) {
  return normalizeName(value).toLowerCase();
}

function getActorUnitId(actor) {
  const unitId = Number.parseInt(actor?.unitId, 10);
  if (!Number.isInteger(unitId) || unitId <= 0) {
    throw new AppError({
      statusCode: HTTP_CODES.BAD_REQUEST,
      message: "Không xác định được đơn vị người dùng",
      errorCode: "INVALID_ACTOR_UNIT",
    });
  }
  return unitId;
}

function parseOptionalUnitId(value) {
  if (value === undefined || value === null || value === "") return null;
  const unitId = Number.parseInt(value, 10);
  if (!Number.isInteger(unitId) || unitId <= 0) {
    throw new AppError({
      statusCode: HTTP_CODES.BAD_REQUEST,
      message: "unitId không hợp lệ",
      errorCode: "INVALID_UNIT_ID",
    });
  }
  return unitId;
}

function assertAllocationModeManager(actor) {
  ensureAnyRole(actor, ["SUPER_ADMIN", "ADMIN"], {
    message: "Chỉ SUPER_ADMIN hoặc ADMIN mới được quản lý chế độ cấp phát",
    errorCode: "ALLOCATION_MODE_MANAGER_REQUIRED",
  });
}

function normalizeIssueVoucherPurpose(value) {
  return String(value || "MODE").trim().toUpperCase() === "OTHER"
    ? "OTHER"
    : "MODE";
}

function buildVoucherReasonText(voucher) {
  const explicitReason = normalizeName(voucher?.reason || "");
  if (explicitReason) return explicitReason;

  const parts = [];
  if (voucher?.military?.fullname) {
    parts.push(`Cấp phát cho ${voucher.military.fullname}`);
  }
  if (voucher?.military?.militaryCode) {
    parts.push(`Số quân nhân: ${voucher.military.militaryCode}`);
  }
  if (voucher?.mode?.name) {
    parts.push(`Theo chế độ ${voucher.mode.name}`);
  }
  if (voucher?.note) {
    parts.push(voucher.note);
  }

  return parts.join(" - ");
}

function buildOwnerKey({ scope, unitId }) {
  return scope === "SYSTEM" ? "SYSTEM" : `UNIT:${unitId}`;
}

function mapRuleConfig(config) {
  if (!config?.clauses?.length) return null;
  return {
    clauses: config.clauses.map((clause) => ({
      field: String(clause.field),
      operator: String(clause.operator),
      valueSource: String(clause.valueSource || "STATIC"),
      ...(clause.value !== undefined ? { value: clause.value } : {}),
    })),
  };
}

function mapMode(mode) {
  const mappedMilitaryTypes = (mode.militaryTypes || []).map((row) => ({
    id: row.type.id,
    code: row.type.code,
    name: row.type.name || null,
  }));

  return {
    id: mode.id,
    scope: mode.scope,
    code: mode.code,
    name: mode.name,
    description: mode.description,
    isActive: mode.isActive,
    ruleCombinator: mode.ruleCombinator,
    ruleConfig: mode.ruleConfig,
    createdAt: mode.createdAt,
    updatedAt: mode.updatedAt,
    unit: mode.unit
      ? {
          id: mode.unit.id,
          name: mode.unit.name,
        }
      : null,
    createdBy: mode.createdBy
      ? {
          id: mode.createdBy.id,
          username: mode.createdBy.username,
          email: mode.createdBy.email,
        }
      : null,
    type: mappedMilitaryTypes[0] || null,
    militaryTypes: mappedMilitaryTypes,
    includedMilitaries: (mode.includedMilitaries || []).map((row) => ({
      id: row.military.id,
      fullname: row.military.fullname,
      militaryCode: row.military.militaryCode,
    })),
    excludedMilitaries: (mode.excludedMilitaries || []).map((row) => ({
      id: row.military.id,
      fullname: row.military.fullname,
      militaryCode: row.military.militaryCode,
    })),
    categories: (mode.categories || []).map((row) => ({
      id: row.id,
      quantity: row.quantity,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
      category: row.category
        ? {
            id: row.category.id,
            name: row.category.name,
            code: row.category.code || null,
            unitOfMeasure: row.category.unitOfMeasure
              ? {
                  id: row.category.unitOfMeasure.id,
                  name: row.category.unitOfMeasure.name,
                }
              : null,
          }
        : null,
    })),
  };
}

async function assertUnitExists(unitId) {
  if (!unitId) return;
  const unit = await prisma.unit.findFirst({
    where: {
      id: unitId,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!unit) {
    throw new AppError({
      statusCode: HTTP_CODES.NOT_FOUND,
      message: "Đơn vị không tồn tại",
      errorCode: "UNIT_NOT_FOUND",
    });
  }
}

async function resolveModeScope({ actor, scope, unitId }) {
  assertAllocationModeManager(actor);
  const isSuperAdmin = hasAnyRole(actor, ["SUPER_ADMIN"]);
  const normalizedScope = scope === "SYSTEM" ? "SYSTEM" : "UNIT";

  if (normalizedScope === "SYSTEM") {
    if (!isSuperAdmin) {
      throw new AppError({
        statusCode: HTTP_CODES.FORBIDDEN,
        message: "Chỉ SUPER_ADMIN được tạo chế độ hệ thống",
        errorCode: "SYSTEM_ALLOCATION_MODE_FORBIDDEN",
      });
    }
    return {
      scope: "SYSTEM",
      unitId: null,
      ownerKey: buildOwnerKey({ scope: "SYSTEM" }),
    };
  }

  const actorUnitId = getActorUnitId(actor);
  const requestedUnitId = parseOptionalUnitId(unitId);
  const resolvedUnitId = isSuperAdmin
    ? requestedUnitId || actorUnitId
    : actorUnitId;

  if (!isSuperAdmin && requestedUnitId && requestedUnitId !== actorUnitId) {
    throw new AppError({
      statusCode: HTTP_CODES.FORBIDDEN,
      message: "Bạn chỉ được tạo chế độ riêng cho đơn vị của mình",
      errorCode: "UNIT_SCOPE_FORBIDDEN",
    });
  }

  await assertUnitExists(resolvedUnitId);
  return {
    scope: "UNIT",
    unitId: resolvedUnitId,
    ownerKey: buildOwnerKey({ scope: "UNIT", unitId: resolvedUnitId }),
  };
}

function assertUniqueIds(ids, errorCode, message) {
  if (!ids?.length) return;
  const uniqueSize = new Set(ids.map((id) => String(id))).size;
  if (uniqueSize !== ids.length) {
    throw new AppError({
      statusCode: HTTP_CODES.BAD_REQUEST,
      message,
      errorCode,
    });
  }
}

async function validateModeAssociations({
  categories = [],
  militaryTypeIds = [],
  includedMilitaryIds = [],
  excludedMilitaryIds = [],
  scope,
  unitId,
  actorUnitId,
}) {
  const categoryIds = [...new Set(categories.map((row) => Number(row.categoryId)))];
  const typeIds = [...new Set((militaryTypeIds || []).map((id) => Number(id)))];
  const targetedMilitaryIds = [
    ...new Set(
      [...(includedMilitaryIds || []), ...(excludedMilitaryIds || [])].map((id) =>
        String(id),
      ),
    ),
  ];

  assertUniqueIds(
    categories.map((row) => Number(row.categoryId)),
    "ALLOCATION_MODE_CATEGORY_DUPLICATE",
    "Danh mục bị trùng trong chế độ cấp phát",
  );
  assertUniqueIds(
    militaryTypeIds,
    "ALLOCATION_MODE_TYPE_DUPLICATE",
    "Loại quân nhân bị trùng trong chế độ cấp phát",
  );

  if (typeIds.length !== 1) {
    throw new AppError({
      statusCode: HTTP_CODES.BAD_REQUEST,
      message: "Mỗi chế độ cấp phát phải áp dụng cho đúng 1 loại quân nhân",
      errorCode: "ALLOCATION_MODE_SINGLE_TYPE_REQUIRED",
    });
  }
  assertUniqueIds(
    includedMilitaryIds,
    "ALLOCATION_MODE_INCLUDED_MILITARY_DUPLICATE",
    "Quân nhân bao gồm bị trùng",
  );
  assertUniqueIds(
    excludedMilitaryIds,
    "ALLOCATION_MODE_EXCLUDED_MILITARY_DUPLICATE",
    "Quân nhân loại trừ bị trùng",
  );

  const serviceLifeUnitId = scope === "UNIT" ? unitId : actorUnitId;

  const [existingCategories, existingTypes, militaries, serviceLifeRules] = await Promise.all([
    prisma.category.findMany({
      where: {
        id: { in: categoryIds },
        deletedAt: null,
      },
      select: { id: true },
    }),
    prisma.militaryTypeCatalog.findMany({
      where: {
        id: { in: typeIds },
        deletedAt: null,
      },
      select: { id: true },
    }),
    prisma.military.findMany({
      where: {
        id: { in: targetedMilitaryIds },
        deletedAt: null,
      },
      select: {
        id: true,
        unitId: true,
      },
    }),
    prisma.supplyAllocationServiceLifeRule.findMany({
      where: {
        unitId: serviceLifeUnitId,
        typeId: typeIds[0],
        deletedAt: null,
      },
      select: {
        categoryId: true,
      },
      orderBy: [{ categoryId: "asc" }],
    }),
  ]);

  if (existingCategories.length !== categoryIds.length) {
    throw new AppError({
      statusCode: HTTP_CODES.NOT_FOUND,
      message: "Có category không tồn tại hoặc đã bị xoá",
      errorCode: "ALLOCATION_MODE_CATEGORY_NOT_FOUND",
    });
  }

  if (existingTypes.length !== typeIds.length) {
    throw new AppError({
      statusCode: HTTP_CODES.NOT_FOUND,
      message: "Có loại quân nhân không tồn tại hoặc đã bị xoá",
      errorCode: "ALLOCATION_MODE_TYPE_NOT_FOUND",
    });
  }

  if (militaries.length !== targetedMilitaryIds.length) {
    throw new AppError({
      statusCode: HTTP_CODES.NOT_FOUND,
      message: "Có quân nhân chỉ định không tồn tại hoặc đã bị xoá",
      errorCode: "ALLOCATION_MODE_MILITARY_NOT_FOUND",
    });
  }

  const serviceLifeCategoryIds = [
    ...new Set(serviceLifeRules.map((rule) => Number(rule.categoryId))),
  ];

  if (!serviceLifeCategoryIds.length) {
    throw new AppError({
      statusCode: HTTP_CODES.BAD_REQUEST,
      message:
        "Loại quân nhân này chưa có cấu hình niên hạn quân trang nên chưa thể tạo chế độ cấp phát",
      errorCode: "ALLOCATION_MODE_SERVICE_LIFE_REQUIRED",
    });
  }

  const unexpectedCategoryIds = categoryIds.filter(
    (categoryId) => !serviceLifeCategoryIds.includes(categoryId),
  );
  if (unexpectedCategoryIds.length) {
    throw new AppError({
      statusCode: HTTP_CODES.BAD_REQUEST,
      message:
        "Danh sách quân trang của chế độ phải lấy từ cấu hình niên hạn của loại quân nhân đã chọn",
      errorCode: "ALLOCATION_MODE_CATEGORY_NOT_IN_SERVICE_LIFE",
      metadata: { unexpectedCategoryIds },
    });
  }

  const missingCategoryIds = serviceLifeCategoryIds.filter(
    (categoryId) => !categoryIds.includes(categoryId),
  );
  if (missingCategoryIds.length) {
    throw new AppError({
      statusCode: HTTP_CODES.BAD_REQUEST,
      message:
        "Phải khai báo số lượng cho toàn bộ quân trang đã có trong cấu hình niên hạn của loại quân nhân này",
      errorCode: "ALLOCATION_MODE_CATEGORY_QUANTITY_INCOMPLETE",
      metadata: { missingCategoryIds },
    });
  }

  if (
    (includedMilitaryIds || []).some((id) =>
      (excludedMilitaryIds || []).includes(id),
    )
  ) {
    throw new AppError({
      statusCode: HTTP_CODES.BAD_REQUEST,
      message: "Một quân nhân không thể vừa bao gồm vừa loại trừ",
      errorCode: "ALLOCATION_MODE_MILITARY_INCLUDE_EXCLUDE_CONFLICT",
    });
  }

  if (
    scope === "SYSTEM" &&
    ((includedMilitaryIds || []).length || (excludedMilitaryIds || []).length)
  ) {
    throw new AppError({
      statusCode: HTTP_CODES.BAD_REQUEST,
      message: "Chế độ hệ thống không được gắn quân nhân chỉ định",
      errorCode: "SYSTEM_ALLOCATION_MODE_TARGET_MILITARY_FORBIDDEN",
    });
  }

  if (scope === "UNIT") {
    const invalidMilitary = militaries.find(
      (military) => Number(military.unitId) !== Number(unitId),
    );
    if (invalidMilitary) {
      throw new AppError({
        statusCode: HTTP_CODES.BAD_REQUEST,
        message: "Có quân nhân chỉ định không thuộc đơn vị của chế độ cấp phát",
        errorCode: "ALLOCATION_MODE_MILITARY_SCOPE_MISMATCH",
      });
    }
  }
}

async function ensureModeEditable({ actor, modeId }) {
  assertAllocationModeManager(actor);
  const mode = await prisma.allocationMode.findFirst({
    where: {
      id: modeId,
      deletedAt: null,
    },
  });

  if (!mode) {
    throw new AppError({
      statusCode: HTTP_CODES.NOT_FOUND,
      message: "Chế độ cấp phát không tồn tại",
      errorCode: "ALLOCATION_MODE_NOT_FOUND",
    });
  }

  const isSuperAdmin = hasAnyRole(actor, ["SUPER_ADMIN"]);
  const actorUnitId = getActorUnitId(actor);

  if (mode.scope === "SYSTEM" && !isSuperAdmin) {
    throw new AppError({
      statusCode: HTTP_CODES.FORBIDDEN,
      message: "ADMIN đơn vị không được sửa chế độ hệ thống",
      errorCode: "SYSTEM_ALLOCATION_MODE_EDIT_FORBIDDEN",
    });
  }

  if (mode.scope === "UNIT" && !isSuperAdmin && Number(mode.unitId) !== Number(actorUnitId)) {
    throw new AppError({
      statusCode: HTTP_CODES.FORBIDDEN,
      message: "Bạn chỉ được sửa chế độ của đơn vị mình",
      errorCode: "UNIT_ALLOCATION_MODE_EDIT_FORBIDDEN",
    });
  }

  return mode;
}

async function writeModeRelations(tx, modeId, body) {
  const categories = body.categories || [];
  const militaryTypeIds = [...new Set((body.militaryTypeIds || []).map(Number))];
  const includedMilitaryIds = [...new Set((body.includedMilitaryIds || []).map(String))];
  const excludedMilitaryIds = [...new Set((body.excludedMilitaryIds || []).map(String))];

  if (body.categories) {
    const existingCategories = await tx.allocationModeCategory.findMany({
      where: {
        modeId,
      },
      select: {
        id: true,
        categoryId: true,
      },
    });

    const existingByCategoryId = new Map(
      existingCategories.map((row) => [Number(row.categoryId), row]),
    );
    const nextCategoryIds = new Set(categories.map((row) => Number(row.categoryId)));
    const archivedAt = new Date();

    for (const [index, row] of categories.entries()) {
      const categoryId = Number(row.categoryId);
      const existingRow = existingByCategoryId.get(categoryId);
      const data = {
        quantity: Math.max(0, Number(row.quantity) || 0),
        isActive: row.isActive ?? true,
        sortOrder: Number(row.sortOrder ?? index),
        deletedAt: null,
      };

      if (existingRow) {
        await tx.allocationModeCategory.update({
          where: {
            id: existingRow.id,
          },
          data,
        });
        continue;
      }

      await tx.allocationModeCategory.create({
        data: {
          modeId,
          categoryId,
          ...data,
        },
      });
    }

    const removedCategoryIds = existingCategories
      .map((row) => Number(row.categoryId))
      .filter((categoryId) => !nextCategoryIds.has(categoryId));

    if (removedCategoryIds.length) {
      await tx.allocationModeCategory.updateMany({
        where: {
          modeId,
          categoryId: {
            in: removedCategoryIds,
          },
        },
        data: {
          isActive: false,
          deletedAt: archivedAt,
        },
      });
    }
  }

  if (militaryTypeIds.length) {
    await tx.allocationModeMilitaryType.createMany({
      data: militaryTypeIds.map((typeId) => ({
        modeId,
        typeId,
      })),
      skipDuplicates: true,
    });
  }

  if (includedMilitaryIds.length) {
    await tx.allocationModeMilitaryInclude.createMany({
      data: includedMilitaryIds.map((militaryId) => ({
        modeId,
        militaryId,
      })),
      skipDuplicates: true,
    });
  }

  if (excludedMilitaryIds.length) {
    await tx.allocationModeMilitaryExclude.createMany({
      data: excludedMilitaryIds.map((militaryId) => ({
        modeId,
        militaryId,
      })),
      skipDuplicates: true,
    });
  }
}

async function fetchModeById(modeId) {
  const mode = await prisma.allocationMode.findFirst({
    where: {
      id: modeId,
      deletedAt: null,
    },
    include: {
      unit: {
        select: { id: true, name: true },
      },
      createdBy: {
        select: {
          id: true,
          username: true,
          email: true,
        },
      },
      categories: {
        where: {
          deletedAt: null,
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
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
        },
      },
      militaryTypes: {
        orderBy: [{ typeId: "asc" }],
        include: {
          type: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      },
      includedMilitaries: {
        orderBy: [{ military: { fullname: "asc" } }, { militaryId: "asc" }],
        include: {
          military: {
            select: {
              id: true,
              fullname: true,
              militaryCode: true,
            },
          },
        },
      },
      excludedMilitaries: {
        orderBy: [{ military: { fullname: "asc" } }, { militaryId: "asc" }],
        include: {
          military: {
            select: {
              id: true,
              fullname: true,
              militaryCode: true,
            },
          },
        },
      },
    },
  });

  if (!mode) {
    throw new AppError({
      statusCode: HTTP_CODES.NOT_FOUND,
      message: "Chế độ cấp phát không tồn tại",
      errorCode: "ALLOCATION_MODE_NOT_FOUND",
    });
  }

  return mode;
}

async function assertCodeUnique({ ownerKey, code, excludeId = null }) {
  if (!code) return;
  const duplicated = await prisma.allocationMode.findFirst({
    where: {
      ownerKey,
      code,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      deletedAt: null,
    },
    select: { id: true },
  });

  if (duplicated) {
    throw new AppError({
      statusCode: HTTP_CODES.CONFLICT,
      message: "Mã chế độ cấp phát đã tồn tại",
      errorCode: "ALLOCATION_MODE_CODE_DUPLICATE",
    });
  }
}

const VOUCHER_TEMPLATE_PATH = path.resolve(
  process.cwd(),
  "templates",
  "phieu-xuat-kho-template.xlsx",
);

function getVoucherTemplateConfig(voucher) {
  const config =
    voucher?.printTemplate?.config &&
    typeof voucher.printTemplate.config === "object" &&
    !Array.isArray(voucher.printTemplate.config)
      ? voucher.printTemplate.config
      : {};

  return {
    headerLine1: String(config.headerLine1 || "").trim(),
    headerLine2: String(config.headerLine2 || "").trim(),
    formCode: String(config.formCode || "Mẫu số: PXK").trim(),
    title: String(config.title || "PHIẾU XUẤT KHO").trim(),
    receiverLabel: String(config.receiverLabel || "Họ và tên người nhận hàng").trim(),
    unitLabel: String(config.unitLabel || "Đơn vị").trim(),
    reasonLabel: String(config.reasonLabel || "Lý do xuất kho").trim(),
    signatures: Array.isArray(config.signatures) ? config.signatures : [],
  };
}

function setCellIfPresent(worksheet, cellRef, value) {
  if (value === undefined || value === null || value === "") return;
  worksheet.getCell(cellRef).value = value;
}

function applyIssueVoucherTemplateConfig({ worksheet, voucher, tableEndRow }) {
  const config = getVoucherTemplateConfig(voucher);

  setCellIfPresent(
    worksheet,
    "B1",
    config.headerLine1 || String(voucher.unit?.name || "").toUpperCase(),
  );
  setCellIfPresent(
    worksheet,
    "B2",
    config.headerLine2 || String(voucher.warehouse?.name || ""),
  );
  setCellIfPresent(
    worksheet,
    "E2",
    [config.formCode, `Số: ${voucher.voucherNo}`].filter(Boolean).join(" - "),
  );
  setCellIfPresent(worksheet, "A3", config.title);
  setCellIfPresent(
    worksheet,
    "B6",
    `${config.receiverLabel}: ${voucher.receiverName || voucher.military?.fullname || ""}`,
  );
  setCellIfPresent(
    worksheet,
    "E6",
    `${config.unitLabel}: ${voucher.military?.unit?.name || voucher.unit?.name || ""}`,
  );
  setCellIfPresent(
    worksheet,
    "B7",
    `${config.reasonLabel}: ${buildVoucherReasonText(voucher)}`,
  );

  const signatureStartRow = Math.max(tableEndRow + 3, 18);
  config.signatures.slice(0, 4).forEach((signature, index) => {
    const columnStart = 1 + index * 2;
    const titleCell = worksheet.getRow(signatureStartRow).getCell(columnStart);
    const subtitleCell = worksheet.getRow(signatureStartRow + 1).getCell(columnStart);
    const signerCell = worksheet.getRow(signatureStartRow + 6).getCell(columnStart);

    titleCell.value = String(signature?.title || "").trim();
    subtitleCell.value = String(signature?.subtitle || "").trim();
    signerCell.value = String(signature?.signerName || "").trim();

    [titleCell, subtitleCell, signerCell].forEach((cell) => {
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
    });
  });
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseIssueYear(value) {
  const year = Number.parseInt(value, 10);
  if (!Number.isInteger(year) || year < 1900 || year > 3000) {
    throw new AppError({
      statusCode: HTTP_CODES.BAD_REQUEST,
      message: "Năm cấp phát không hợp lệ",
      errorCode: "INVALID_ISSUE_YEAR",
    });
  }
  return year;
}

function parseIssueDate(value, issueYear) {
  if (!value) {
    return new Date();
  }
  const issuedAt = new Date(value);
  if (Number.isNaN(issuedAt.getTime())) {
    throw new AppError({
      statusCode: HTTP_CODES.BAD_REQUEST,
      message: "issuedAt không hợp lệ",
      errorCode: "INVALID_ISSUED_AT",
    });
  }
  return issuedAt;
}

async function buildNextVoucherNo(tx) {
  const [latestVoucher] = await tx.$queryRaw`
    SELECT voucherNo
    FROM allocation_mode_issue_vouchers
    WHERE voucherNo REGEXP '^PXK-[0-9]+$'
    ORDER BY CAST(SUBSTRING(voucherNo, 5) AS UNSIGNED) DESC
    LIMIT 1
  `;

  const latestNumber = Number.parseInt(
    String(latestVoucher?.voucherNo || "").replace(/^PXK-/, ""),
    10,
  );

  return `PXK-${String(Number.isInteger(latestNumber) ? latestNumber + 1 : 1).padStart(6, "0")}`;
}

function formatIssueDateLine(date) {
  return `Ngày ${String(date.getDate()).padStart(2, "0")} tháng ${String(
    date.getMonth() + 1,
  ).padStart(2, "0")} năm ${date.getFullYear()}`;
}

function formatQuantity(value) {
  return Number(value || 0).toLocaleString("vi-VN");
}

function isNoneLike(value) {
  return String(value || "").trim().toLowerCase() === "none";
}

function compareVariantPriority(left, right) {
  const leftNoneScore =
    (isNoneLike(left.variant?.version?.name) ? 1 : 0) +
    (isNoneLike(left.variant?.color?.name) ? 1 : 0);
  const rightNoneScore =
    (isNoneLike(right.variant?.version?.name) ? 1 : 0) +
    (isNoneLike(right.variant?.color?.name) ? 1 : 0);

  if (leftNoneScore !== rightNoneScore) return rightNoneScore - leftNoneScore;
  if (Number(left.quantity || 0) !== Number(right.quantity || 0)) {
    return Number(right.quantity || 0) - Number(left.quantity || 0);
  }

  return String(left.variant?.id || "").localeCompare(String(right.variant?.id || ""));
}

function mapMilitarySummary(military) {
  const types = (military.typeAssignments || []).map((row) => ({
    id: row.type.id,
    code: row.type.code,
    name: row.type.name || null,
  }));

  return {
    id: military.id,
    fullname: military.fullname,
    militaryCode: military.militaryCode,
    rank: military.rank,
    rankGroup: military.rankGroup,
    position: military.position,
    gender: military.genderCatalog?.code || military.gender,
    initialCommissioningYear: military.initialCommissioningYear,
    unit: military.unit
      ? {
          id: military.unit.id,
          name: military.unit.name,
        }
      : null,
    assignedUnit: military.assignedUnit || null,
    types,
  };
}

function mapUserSummary(user) {
  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName:
      user.profile?.fullName ||
      user.military?.fullname ||
      user.username,
  };
}

function mapVoucher(voucher) {
  return {
    id: voucher.id,
    voucherNo: voucher.voucherNo,
    purpose: normalizeIssueVoucherPurpose(voucher.purpose),
    receiverName: voucher.receiverName || null,
    issuedAt: voucher.issuedAt,
    issuedYear: voucher.issuedYear,
    reason: voucher.reason || null,
    note: voucher.note,
    createdAt: voucher.createdAt,
    updatedAt: voucher.updatedAt,
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
    printTemplate: mapPrintTemplateUsage({
      templateType: voucher.printTemplateType,
      templateId: voucher.printTemplateId,
      templateVersionId: voucher.printTemplateVersionId,
      templateVersionNo: voucher.printTemplateVersionNo,
      templateSnapshot: voucher.printTemplateSnapshot,
      template: voucher.printTemplate,
      templateVersion: voucher.printTemplateVersion,
    }),
    mode: voucher.mode ? mapMode(voucher.mode) : null,
    military: voucher.military ? mapMilitarySummary(voucher.military) : null,
    createdBy: mapUserSummary(voucher.createdBy),
    items: (voucher.items || []).map((item) => ({
      id: item.id,
      versionId: item.versionId || null,
      colorId: item.colorId || null,
      versionName: item.versionName || null,
      colorName: item.colorName || null,
      quantity: item.quantity,
      serviceLifeYears: item.serviceLifeYears,
      lastIssuedYear: item.lastIssuedYear,
      nextEligibleYear: item.nextEligibleYear,
      wasDue: item.wasDue,
      categoryName: item.categoryName,
      unitOfMeasureName: item.unitOfMeasureName,
      appliedType: item.appliedType
        ? {
            id: item.appliedType.id,
            code: item.appliedType.code,
            name: item.appliedType.name || null,
          }
        : null,
      category: item.category
        ? {
            id: item.category.id,
            name: item.category.name,
            code: item.category.code || null,
          }
        : null,
      modeCategory: item.modeCategory
        ? {
            id: item.modeCategory.id,
            quantity: item.modeCategory.quantity,
          }
        : null,
    })),
  };
}

async function fetchMilitaryForAllocation({ actor, militaryId }) {
  assertAllocationModeManager(actor);
  const isSuperAdmin = hasAnyRole(actor, ["SUPER_ADMIN"]);
  const actorUnitId = getActorUnitId(actor);

  const military = await prisma.military.findFirst({
    where: {
      id: militaryId,
      deletedAt: null,
      ...(!isSuperAdmin ? { unitId: actorUnitId } : {}),
    },
    include: {
      unit: {
        select: { id: true, name: true },
      },
      genderCatalog: {
        select: { code: true, name: true },
      },
      typeAssignments: {
        where: {
          type: {
            deletedAt: null,
          },
        },
        orderBy: [{ typeId: "asc" }],
        include: {
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
    throw new AppError({
      statusCode: HTTP_CODES.NOT_FOUND,
      message: "Quân nhân không tồn tại hoặc không thuộc phạm vi quản lý",
      errorCode: "MILITARY_NOT_FOUND",
    });
  }

  return military;
}

async function fetchWarehouseInUnit({ warehouseId, unitId }) {
  const warehouse = await prisma.warehouse.findFirst({
    where: {
      id: warehouseId,
      unitId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      unitId: true,
    },
  });

  if (!warehouse) {
    throw new AppError({
      statusCode: HTTP_CODES.NOT_FOUND,
      message: "Kho không tồn tại trong đơn vị của quân nhân",
      errorCode: "WAREHOUSE_NOT_FOUND",
    });
  }

  return warehouse;
}

async function fetchWarehouseForActor({ actor, warehouseId }) {
  assertAllocationModeManager(actor);
  const parsedWarehouseId = Number.parseInt(warehouseId, 10);

  if (!Number.isInteger(parsedWarehouseId) || parsedWarehouseId <= 0) {
    throw new AppError({
      statusCode: HTTP_CODES.BAD_REQUEST,
      message: "warehouseId không hợp lệ",
      errorCode: "INVALID_WAREHOUSE_ID",
    });
  }

  if (!hasAnyRole(actor, ["SUPER_ADMIN"])) {
    return fetchWarehouseInUnit({
      warehouseId: parsedWarehouseId,
      unitId: getActorUnitId(actor),
    });
  }

  const warehouse = await prisma.warehouse.findFirst({
    where: {
      id: parsedWarehouseId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      unitId: true,
    },
  });

  if (!warehouse) {
    throw new AppError({
      statusCode: HTTP_CODES.NOT_FOUND,
      message: "Kho không tồn tại hoặc không thuộc phạm vi quản lý",
      errorCode: "WAREHOUSE_NOT_FOUND",
    });
  }

  return warehouse;
}

async function fetchModeForIssue(modeId) {
  const mode = await prisma.allocationMode.findFirst({
    where: {
      id: modeId,
      deletedAt: null,
      isActive: true,
    },
    include: {
      unit: {
        select: { id: true, name: true },
      },
      createdBy: {
        select: {
          id: true,
          username: true,
          email: true,
          profile: {
            select: { fullName: true },
          },
          military: {
            select: { fullname: true },
          },
        },
      },
      categories: {
        where: {
          deletedAt: null,
          isActive: true,
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
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
        },
      },
      militaryTypes: {
        include: {
          type: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      },
      includedMilitaries: {
        include: {
          military: {
            select: {
              id: true,
              fullname: true,
              militaryCode: true,
            },
          },
        },
      },
      excludedMilitaries: {
        include: {
          military: {
            select: {
              id: true,
              fullname: true,
              militaryCode: true,
            },
          },
        },
      },
    },
  });

  if (!mode) {
    throw new AppError({
      statusCode: HTTP_CODES.NOT_FOUND,
      message: "Chế độ cấp phát không tồn tại hoặc đã ngừng sử dụng",
      errorCode: "ALLOCATION_MODE_NOT_FOUND",
    });
  }

  return mode;
}

function getModeType(mode) {
  const row = mode.militaryTypes?.[0];
  return row?.type
    ? {
        id: row.type.id,
        code: row.type.code,
        name: row.type.name || null,
      }
    : null;
}

function getComparableMilitaryFieldValue(military, field) {
  switch (field) {
    case "initialCommissioningYear":
      return Number(military.initialCommissioningYear || 0);
    case "gender":
      return String(military.genderCatalog?.code || military.gender || "");
    case "rank":
      return String(military.rank || "");
    case "rankGroup":
      return String(military.rankGroup || "");
    case "position":
      return String(military.position || "");
    case "assignedUnitId":
      return Number(military.assignedUnitId || 0);
    case "assignedUnit":
      return String(military.assignedUnit || "");
    case "militaryCode":
      return String(military.militaryCode || "");
    case "unitId":
      return Number(military.unitId || 0);
    default:
      return null;
  }
}

function resolveRuleValue(clause, issueYear) {
  if (clause.valueSource === "ISSUE_YEAR") return issueYear;
  if (clause.valueSource === "CURRENT_YEAR") return new Date().getFullYear();
  return clause.value;
}

function compareClause(fieldValue, operator, expectedValue) {
  switch (operator) {
    case "EQ":
      return fieldValue === expectedValue;
    case "NEQ":
      return fieldValue !== expectedValue;
    case "GT":
      return Number(fieldValue) > Number(expectedValue);
    case "GTE":
      return Number(fieldValue) >= Number(expectedValue);
    case "LT":
      return Number(fieldValue) < Number(expectedValue);
    case "LTE":
      return Number(fieldValue) <= Number(expectedValue);
    case "IN":
      return Array.isArray(expectedValue) && expectedValue.includes(fieldValue);
    case "NOT_IN":
      return Array.isArray(expectedValue) && !expectedValue.includes(fieldValue);
    case "CONTAINS":
      return String(fieldValue || "").includes(String(expectedValue || ""));
    case "STARTS_WITH":
      return String(fieldValue || "").startsWith(String(expectedValue || ""));
    case "ENDS_WITH":
      return String(fieldValue || "").endsWith(String(expectedValue || ""));
    case "IS_TRUE":
      return Boolean(fieldValue) === true;
    case "IS_FALSE":
      return Boolean(fieldValue) === false;
    default:
      return false;
  }
}

function evaluateModeRuleConfig({ mode, military, issueYear }) {
  const clauses = mode.ruleConfig?.clauses || [];
  if (!clauses.length) {
    return {
      matched: true,
      matchedClauseCount: 0,
      totalClauseCount: 0,
    };
  }

  const clauseResults = clauses.map((clause) =>
    compareClause(
      getComparableMilitaryFieldValue(military, clause.field),
      String(clause.operator || "EQ"),
      resolveRuleValue(clause, issueYear),
    ),
  );

  const matched =
    String(mode.ruleCombinator || "ALL") === "ANY"
      ? clauseResults.some(Boolean)
      : clauseResults.every(Boolean);

  return {
    matched,
    matchedClauseCount: clauseResults.filter(Boolean).length,
    totalClauseCount: clauseResults.length,
  };
}

function evaluateModeForMilitary({ mode, military, issueYear }) {
  const typeIds = new Set(
    (military.typeAssignments || []).map((row) => Number(row.typeId || row.type?.id || 0)),
  );
  const modeType = getModeType(mode);
  const hasType = modeType ? typeIds.has(Number(modeType.id)) : false;
  const includedMilitaryIds = new Set(
    (mode.includedMilitaries || []).map((row) => String(row.militaryId)),
  );
  const excludedMilitaryIds = new Set(
    (mode.excludedMilitaries || []).map((row) => String(row.militaryId)),
  );
  const isIncluded = includedMilitaryIds.has(String(military.id));
  const isExcluded = excludedMilitaryIds.has(String(military.id));
  const ruleEvaluation = evaluateModeRuleConfig({ mode, military, issueYear });

  let reason = "Đủ điều kiện theo loại quân nhân và quy tắc";
  let applicable = hasType && !isExcluded && (ruleEvaluation.matched || isIncluded);

  if (!hasType) {
    reason = "Không thuộc loại quân nhân áp dụng của chế độ";
    applicable = false;
  } else if (isExcluded) {
    reason = "Quân nhân nằm trong danh sách loại trừ của chế độ";
    applicable = false;
  } else if (!ruleEvaluation.matched && !isIncluded) {
    reason = "Quân nhân không thoả quy tắc chung của chế độ";
    applicable = false;
  } else if (isIncluded && !ruleEvaluation.matched) {
    reason = "Quân nhân được chỉ định áp dụng trực tiếp trong chế độ";
  }

  return {
    applicable,
    reason,
    isIncluded,
    isExcluded,
    ruleMatched: ruleEvaluation.matched,
    matchedClauseCount: ruleEvaluation.matchedClauseCount,
    totalClauseCount: ruleEvaluation.totalClauseCount,
    modeType,
  };
}

async function getCategoryStockSnapshot({ warehouseId, categoryIds }) {
  if (!warehouseId || !categoryIds.length) return new Map();

  const rows = await prisma.categoryWarehouseStock.findMany({
    where: {
      warehouseId,
      variant: {
        categoryId: {
          in: categoryIds,
        },
      },
    },
    include: {
      variant: {
        include: {
          version: {
            select: {
              id: true,
              name: true,
            },
          },
          color: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
    orderBy: [{ quantity: "desc" }, { variantId: "asc" }],
  });

  const stockByCategoryId = new Map();
  rows.forEach((row) => {
    const categoryId = Number(row.variant?.categoryId || 0);
    if (!stockByCategoryId.has(categoryId)) {
      stockByCategoryId.set(categoryId, {
        total: 0,
        variants: [],
      });
    }
    const entry = stockByCategoryId.get(categoryId);
    entry.total += Number(row.quantity || 0);
    entry.variants.push(row);
  });

  return stockByCategoryId;
}

function sortStockVariantRows(rows = []) {
  return [...rows].sort((left, right) => {
    if (Number(left.quantity || 0) !== Number(right.quantity || 0)) {
      return Number(right.quantity || 0) - Number(left.quantity || 0);
    }
    return Number(left.variantId || 0) - Number(right.variantId || 0);
  });
}

function cloneStockEntry(entry) {
  return {
    total: Number(entry?.total || 0),
    variants: (entry?.variants || []).map((row) => ({
      ...row,
      quantity: Number(row.quantity || 0),
      variant: row.variant
        ? {
            ...row.variant,
            version: row.variant.version
              ? { ...row.variant.version }
              : null,
            color: row.variant.color
              ? { ...row.variant.color }
              : null,
          }
        : null,
    })),
  };
}

function applyStockAdjustmentsToSnapshot(stockByCategoryId, adjustments = []) {
  if (!adjustments.length) return stockByCategoryId;

  const adjustedSnapshot = new Map(
    [...stockByCategoryId.entries()].map(([categoryId, entry]) => [
      categoryId,
      cloneStockEntry(entry),
    ]),
  );

  adjustments.forEach((adjustment) => {
    const categoryId = Number(adjustment.categoryId);
    if (!adjustedSnapshot.has(categoryId)) {
      adjustedSnapshot.set(categoryId, {
        total: 0,
        variants: [],
      });
    }

    const entry = adjustedSnapshot.get(categoryId);
    entry.total += Number(adjustment.quantity || 0);

    const existingVariant = entry.variants.find(
      (variantRow) => Number(variantRow.variantId) === Number(adjustment.variantId),
    );

    if (existingVariant) {
      existingVariant.quantity = Number(existingVariant.quantity || 0) + Number(adjustment.quantity || 0);
    } else {
      entry.variants.push({
        warehouseId: adjustment.warehouseId || null,
        variantId: Number(adjustment.variantId),
        quantity: Number(adjustment.quantity || 0),
        variant: {
          id: Number(adjustment.variantId),
          categoryId,
          version: adjustment.versionId
            ? {
                id: Number(adjustment.versionId),
                name: adjustment.versionName || null,
              }
            : null,
          color: adjustment.colorId
            ? {
                id: Number(adjustment.colorId),
                name: adjustment.colorName || null,
              }
            : null,
        },
      });
    }

    entry.variants = sortStockVariantRows(entry.variants);
  });

  return adjustedSnapshot;
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

async function resolveVoucherItemStockAdjustments({ tx = prisma, items = [], warehouseId = null }) {
  const normalizedItems = items
    .map((item) => ({
      categoryId: Number(item.categoryId),
      versionId: Number(item.versionId),
      colorId: Number(item.colorId),
      quantity: Number(item.quantity || 0),
    }))
    .filter(
      (item) =>
        item.categoryId > 0 &&
        item.versionId > 0 &&
        item.colorId > 0 &&
        item.quantity > 0,
    );

  if (!normalizedItems.length) return [];

  const uniqueVariantKeys = [
    ...new Map(
      normalizedItems.map((item) => [
        `${item.categoryId}:${item.versionId}:${item.colorId}`,
        item,
      ]),
    ).values(),
  ];

  const variants = await tx.categoryVariant.findMany({
    where: {
      OR: uniqueVariantKeys.map((item) => ({
        categoryId: item.categoryId,
        versionId: item.versionId,
        colorId: item.colorId,
      })),
    },
    include: {
      version: {
        select: { id: true, name: true },
      },
      color: {
        select: { id: true, name: true },
      },
    },
  });

  const variantByKey = new Map(
    variants.map((variant) => [
      `${variant.categoryId}:${variant.versionId}:${variant.colorId}`,
      variant,
    ]),
  );

  return normalizedItems.map((item) => {
    const matchedVariant = variantByKey.get(
      `${item.categoryId}:${item.versionId}:${item.colorId}`,
    );

    if (!matchedVariant) {
      throw new AppError({
        statusCode: HTTP_CODES.BAD_REQUEST,
        message: `Phiên bản hoặc màu sắc không hợp lệ cho quân trang ${item.categoryId}`,
        errorCode: "ALLOCATION_MODE_ISSUE_VARIANT_NOT_FOUND",
      });
    }

    return {
      warehouseId,
      categoryId: item.categoryId,
      variantId: matchedVariant.id,
      versionId: matchedVariant.versionId,
      versionName: matchedVariant.version?.name || null,
      colorId: matchedVariant.colorId,
      colorName: matchedVariant.color?.name || null,
      quantity: item.quantity,
    };
  });
}

function buildRequestedIssueMap(requestedItems = []) {
  return new Map(
    requestedItems.map((item) => [
      Number(item.categoryId),
      {
        quantity: Math.max(0, Number.parseInt(item.quantity, 10) || 0),
        versionId: Number.parseInt(item.versionId, 10) || null,
        colorId: Number.parseInt(item.colorId, 10) || null,
      },
    ]),
  );
}

function buildPositiveIssueRows({ snapshot, requestedItems = [] }) {
  const requestedByCategoryId = buildRequestedIssueMap(requestedItems);

  return snapshot.rows
    .map((row) => ({
      ...row,
      request: requestedByCategoryId.get(Number(row.categoryId)) || {
        quantity: 0,
        versionId: null,
        colorId: null,
      },
    }))
    .map((row) => ({
      ...row,
      issueQuantity: Number(row.request.quantity || 0),
    }))
    .filter((row) => row.issueQuantity > 0);
}

function buildIssueDeductions(positiveRows, warehouseId) {
  return positiveRows.map((row) => {
    const selectedVariant = (row.availableVariants || []).find(
      (variant) =>
        Number(variant.versionId) === Number(row.request.versionId) &&
        Number(variant.colorId) === Number(row.request.colorId),
    );

    return {
      warehouseId,
      variantId: Number(selectedVariant.variantId),
      quantity: Number(row.issueQuantity || 0),
      versionId: Number(selectedVariant.versionId),
      versionName: selectedVariant.versionName || null,
      colorId: Number(selectedVariant.colorId),
      colorName: selectedVariant.colorName || null,
      categoryId: Number(row.categoryId),
    };
  });
}

async function buildOtherIssueRows({ warehouseId, requestedItems = [] }) {
  const requestedByCategoryId = buildRequestedIssueMap(requestedItems);
  const categoryIds = [...requestedByCategoryId.keys()].filter((categoryId) => categoryId > 0);

  if (!categoryIds.length) {
    return [];
  }

  const stockSnapshot = await getCategoryStockSnapshot({ warehouseId, categoryIds });
  const categories = await prisma.category.findMany({
    where: {
      id: { in: categoryIds },
      deletedAt: null,
    },
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

  const categoryById = new Map(categories.map((category) => [Number(category.id), category]));

  return categoryIds.map((categoryId) => {
    const category = categoryById.get(Number(categoryId));
    const stockEntry = stockSnapshot.get(Number(categoryId));
    const request = requestedByCategoryId.get(Number(categoryId)) || {
      quantity: 0,
      versionId: null,
      colorId: null,
    };
    const availableVariants = (stockEntry?.variants || [])
      .map((variantRow) => ({
        variantId: variantRow.variantId,
        versionId: variantRow.variant?.version?.id || null,
        versionName: variantRow.variant?.version?.name || null,
        colorId: variantRow.variant?.color?.id || null,
        colorName: variantRow.variant?.color?.name || null,
        quantity: Number(variantRow.quantity || 0),
      }))
      .sort((left, right) => {
        if (Number(left.quantity || 0) !== Number(right.quantity || 0)) {
          return Number(right.quantity || 0) - Number(left.quantity || 0);
        }

        return `${left.versionName || ""}-${left.colorName || ""}`.localeCompare(
          `${right.versionName || ""}-${right.colorName || ""}`,
          "vi",
        );
      });

    return {
      modeCategoryId: null,
      categoryId: Number(categoryId),
      quantity: Number(stockEntry?.total || 0),
      modeQuantity: 0,
      issuedQuantityInYear: 0,
      remainingQuantity: Number(stockEntry?.total || 0),
      serviceLifeYears: 0,
      lastIssuedYear: null,
      nextEligibleYear: null,
      eligible: true,
      canIssueMore: true,
      reason: category
        ? "Xuất kho ngoài chế độ, kiểm tra trực tiếp theo tồn kho hiện có"
        : "Quân trang không tồn tại hoặc đã bị xóa",
      warehouseStock: Number(stockEntry?.total || 0),
      availableVariants,
      category: category
        ? {
            id: category.id,
            name: category.name,
            code: category.code || null,
            unitOfMeasure: category.unitOfMeasure
              ? {
                  id: category.unitOfMeasure.id,
                  name: category.unitOfMeasure.name,
                }
              : null,
          }
        : null,
      request,
      issueQuantity: Number(request.quantity || 0),
    };
  });
}

async function applyWarehouseStockAdjustments({
  tx,
  adjustments = [],
  operation = "decrement",
}) {
  for (const adjustment of adjustments) {
    if (operation === "increment") {
      await tx.categoryWarehouseStock.upsert({
        where: {
          warehouseId_variantId: {
            warehouseId: adjustment.warehouseId,
            variantId: adjustment.variantId,
          },
        },
        update: {
          quantity: {
            increment: adjustment.quantity,
          },
        },
        create: {
          warehouseId: adjustment.warehouseId,
          variantId: adjustment.variantId,
          quantity: adjustment.quantity,
        },
      });
      continue;
    }

    const decremented = await tx.categoryWarehouseStock.updateMany({
      where: {
        warehouseId: adjustment.warehouseId,
        variantId: adjustment.variantId,
        quantity: {
          gte: adjustment.quantity,
        },
      },
      data: {
        quantity: {
          decrement: adjustment.quantity,
        },
      },
    });

    if (decremented.count !== 1) {
      throw new AppError({
        statusCode: HTTP_CODES.BAD_REQUEST,
        message: "Tồn kho thay đổi trong lúc tạo phiếu, vui lòng tải lại và thử lại",
        errorCode: "ALLOCATION_MODE_ISSUE_STOCK_CHANGED",
      });
    }
  }
}

function buildVoucherBeforeFilter(referenceVoucher) {
  if (!referenceVoucher?.issuedAt) return null;

  return {
    OR: [
      {
        issuedAt: {
          lt: referenceVoucher.issuedAt,
        },
      },
      {
        issuedAt: referenceVoucher.issuedAt,
        createdAt: {
          lt: referenceVoucher.createdAt,
        },
      },
    ],
  };
}

async function syncMilitaryCategoryStatuses({ tx, militaryId, categoryIds = [] }) {
  const normalizedCategoryIds = [...new Set(categoryIds.map(Number).filter((value) => value > 0))];
  if (!normalizedCategoryIds.length) return;

  const items = await tx.allocationModeIssueVoucherItem.findMany({
    where: {
      categoryId: {
        in: normalizedCategoryIds,
      },
      voucher: {
        militaryId,
      },
    },
    orderBy: [
      {
        voucher: {
          issuedAt: "asc",
        },
      },
      {
        voucher: {
          createdAt: "asc",
        },
      },
      { createdAt: "asc" },
    ],
    include: {
      voucher: {
        select: {
          id: true,
          modeId: true,
          issuedAt: true,
          issuedYear: true,
          createdAt: true,
        },
      },
    },
  });

  const latestByTupleKey = new Map();
  const lastIssuedYearByTupleKey = new Map();

  for (const item of items) {
    const categoryId = Number(item.categoryId);
    const typeId = item.appliedTypeId ? Number(item.appliedTypeId) : null;
    const tupleKey = `${categoryId}:${typeId || "none"}`;
    const previousIssuedYear = lastIssuedYearByTupleKey.has(tupleKey)
      ? Number(lastIssuedYearByTupleKey.get(tupleKey))
      : null;
    const nextEligibleYear =
      previousIssuedYear !== null && Number(item.serviceLifeYears || 0) > 0
        ? previousIssuedYear + Number(item.serviceLifeYears || 0)
        : null;
    const wasDue =
      previousIssuedYear === null ||
      (nextEligibleYear !== null && Number(item.voucher.issuedYear) >= Number(nextEligibleYear));

    await tx.allocationModeIssueVoucherItem.update({
      where: { id: item.id },
      data: {
        lastIssuedYear: previousIssuedYear,
        nextEligibleYear,
        wasDue,
      },
    });

    lastIssuedYearByTupleKey.set(tupleKey, Number(item.voucher.issuedYear));
    latestByTupleKey.set(tupleKey, {
      categoryId,
      typeId,
      latestIssuedYear: item.voucher.issuedYear,
      latestIssuedAt: item.voucher.issuedAt,
      lastVoucherId: item.voucher.id,
      lastModeId: item.voucher.modeId,
      lastQuantity: Number(item.quantity || 0),
    });
  }

  await tx.allocationModeMilitaryCategoryStatus.deleteMany({
    where: {
      militaryId,
      categoryId: {
        in: normalizedCategoryIds,
      },
    },
  });

  if (!latestByTupleKey.size) return;

  await tx.allocationModeMilitaryCategoryStatus.createMany({
    data: [...latestByTupleKey.values()].map((latest) => ({
      id: randomUUID(),
      militaryId,
      categoryId: latest.categoryId,
      typeId: latest.typeId,
      latestIssuedYear: latest.latestIssuedYear,
      latestIssuedAt: latest.latestIssuedAt,
      lastVoucherId: latest.lastVoucherId,
      lastModeId: latest.lastModeId,
      lastQuantity: latest.lastQuantity,
    })),
  });
}

async function buildModeEligibilitySnapshot({
  mode,
  military,
  issueYear,
  warehouseId = null,
  excludeVoucherId = null,
  restoredStockAdjustments = [],
  referenceVoucher = null,
}) {
  const applicable = evaluateModeForMilitary({ mode, military, issueYear });
  const modeType = applicable.modeType;
  const modeTypeId = Number(modeType?.id || 0) || null;
  const categoryIds = (mode.categories || []).map((row) => Number(row.categoryId));
  const [serviceLifeRules, stockByCategoryId, issuedItemsInYear, issueHistoryItems, importedBaselines] =
    await Promise.all([
    prisma.supplyAllocationServiceLifeRule.findMany({
      where: {
        unitId: Number(military.unitId),
        typeId: Number(modeTypeId || 0),
        categoryId: { in: categoryIds },
        deletedAt: null,
      },
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
      },
    }),
    getCategoryStockSnapshot({ warehouseId, categoryIds }),
    prisma.allocationModeIssueVoucherItem.findMany({
      where: {
        categoryId: { in: categoryIds },
        ...(modeTypeId ? { appliedTypeId: modeTypeId } : {}),
        voucher: {
          modeId: mode.id,
          militaryId: military.id,
          issuedYear: Number(issueYear),
          ...(excludeVoucherId ? { id: { not: excludeVoucherId } } : {}),
        },
      },
      select: {
        categoryId: true,
        quantity: true,
      },
    }),
    prisma.allocationModeIssueVoucherItem.findMany({
      where: {
        categoryId: { in: categoryIds },
        ...(modeTypeId ? { appliedTypeId: modeTypeId } : {}),
        voucher: {
          militaryId: military.id,
          ...(excludeVoucherId ? { id: { not: excludeVoucherId } } : {}),
        },
      },
      select: {
        categoryId: true,
        voucher: {
          select: {
            issuedYear: true,
          },
        },
      },
      orderBy: [
        {
          voucher: {
            issuedYear: "asc",
          },
        },
        { createdAt: "asc" },
      ],
    }),
    prisma.allocationModeMilitaryCategoryBaseline.findMany({
      where: {
        militaryId: military.id,
        typeId: Number(modeTypeId || -1),
        categoryId: {
          in: categoryIds,
        },
      },
      select: {
        categoryId: true,
        latestIssuedYear: true,
      },
    }),
    ]);

  const serviceLifeRuleByCategoryId = new Map(
    serviceLifeRules.map((rule) => [Number(rule.categoryId), rule]),
  );
  const issuedQuantityByCategoryId = issuedItemsInYear.reduce((map, item) => {
    const categoryId = Number(item.categoryId);
    map.set(categoryId, Number(map.get(categoryId) || 0) + Number(item.quantity || 0));
    return map;
  }, new Map());
  const issueYearsByCategoryId = issueHistoryItems.reduce((map, item) => {
    const categoryId = Number(item.categoryId);
    if (!map.has(categoryId)) map.set(categoryId, []);
    map.get(categoryId).push(Number(item.voucher?.issuedYear));
    return map;
  }, new Map());
  importedBaselines.forEach((baseline) => {
    const categoryId = Number(baseline.categoryId);
    if (!issueYearsByCategoryId.has(categoryId)) {
      issueYearsByCategoryId.set(categoryId, []);
    }
    issueYearsByCategoryId.get(categoryId).push(Number(baseline.latestIssuedYear));
  });
  const effectiveStockByCategoryId = applyStockAdjustmentsToSnapshot(
    stockByCategoryId,
    restoredStockAdjustments,
  );

  const rows = (mode.categories || []).map((modeCategory) => {
    const categoryId = Number(modeCategory.categoryId);
    const rule = serviceLifeRuleByCategoryId.get(categoryId);
    const stockEntry = effectiveStockByCategoryId.get(categoryId) || null;
    const modeQuantity = Number(modeCategory.quantity || 0);
    const issuedQuantityInYear = Number(issuedQuantityByCategoryId.get(categoryId) || 0);
    const remainingQuantity = Math.max(0, modeQuantity - issuedQuantityInYear);
    const serviceLifeYears = Number(rule?.serviceLifeYears || 0);
    const timeline = resolveServiceLifeTimeline({
      issueYears: issueYearsByCategoryId.get(categoryId) || [],
      referenceYear: issueYear,
      serviceLifeYears,
    });
    const lastIssuedYear = timeline.previousIssuedYear;
    const nextEligibleYear = timeline.nextEligibleYear;

    const genderMatches =
      !rule ||
      String(rule.gender || "ANY") === "ANY" ||
      String(rule.gender || "ANY") === String(military.gender || "");
    const rankGroupMatches =
      !rule ||
      String(rule.rankGroup || "ANY") === "ANY" ||
      String(rule.rankGroup || "ANY") === String(military.rankGroup || "");

    const serviceLifeMatchesMilitary = Boolean(rule) && genderMatches && rankGroupMatches;
    const dueByServiceLife =
      applicable.applicable &&
      serviceLifeMatchesMilitary &&
      timeline.dueByServiceLife;
    const canContinuePartialIssue =
      applicable.applicable &&
      serviceLifeMatchesMilitary &&
      issuedQuantityInYear > 0 &&
      remainingQuantity > 0 &&
      Number(lastIssuedYear) === Number(issueYear);
    const due = remainingQuantity > 0 && (dueByServiceLife || canContinuePartialIssue);

    const reason = !applicable.applicable
      ? applicable.reason
      : !rule
        ? "Loại quân nhân này chưa có niên hạn cho quân trang"
        : !serviceLifeMatchesMilitary
          ? "Niên hạn của quân trang không áp dụng cho quân nhân này"
          : issuedQuantityInYear > 0 && remainingQuantity <= 0
            ? `Đã cấp đủ ${issuedQuantityInYear}/${modeQuantity} trong năm ${issueYear}`
            : issuedQuantityInYear > 0 && remainingQuantity > 0
              ? `Đã cấp ${issuedQuantityInYear}/${modeQuantity} trong năm ${issueYear}, còn ${remainingQuantity} để cấp tiếp`
              : lastIssuedYear === null
                ? "Chưa từng cấp phát quân trang này"
                : dueByServiceLife
                  ? timeline.overdueByHistoricalWindow
                    ? "Đã vượt hơn 2 chu kỳ niên hạn, đủ điều kiện cấp phát"
                    : "Đã đến niên hạn cấp phát lại"
                  : `Chưa đến niên hạn, sớm nhất từ năm ${nextEligibleYear}`;

    const availableVariants = (stockEntry?.variants || [])
      .map((variantRow) => ({
        variantId: variantRow.variantId,
        versionId: variantRow.variant?.version?.id || null,
        versionName: variantRow.variant?.version?.name || null,
        colorId: variantRow.variant?.color?.id || null,
        colorName: variantRow.variant?.color?.name || null,
        quantity: Number(variantRow.quantity || 0),
      }))
      .sort((left, right) => {
        if (Number(left.quantity || 0) !== Number(right.quantity || 0)) {
          return Number(right.quantity || 0) - Number(left.quantity || 0);
        }
        return `${left.versionName || ""}-${left.colorName || ""}`.localeCompare(
          `${right.versionName || ""}-${right.colorName || ""}`,
          "vi",
        );
      });

    return {
      modeCategoryId: modeCategory.id,
      categoryId,
      quantity: remainingQuantity,
      modeQuantity,
      issuedQuantityInYear,
      remainingQuantity,
      serviceLifeYears,
      lastIssuedYear,
      nextEligibleYear,
      eligible: due,
      canIssueMore: due,
      reason,
      warehouseStock: Number(stockEntry?.total || 0),
      availableVariants,
      category: modeCategory.category
        ? {
            id: modeCategory.category.id,
            name: modeCategory.category.name,
            code: modeCategory.category.code || null,
            unitOfMeasure: modeCategory.category.unitOfMeasure
              ? {
                  id: modeCategory.category.unitOfMeasure.id,
                  name: modeCategory.category.unitOfMeasure.name,
                }
              : null,
          }
        : rule?.category
          ? {
              id: rule.category.id,
              name: rule.category.name,
              code: rule.category.code || null,
              unitOfMeasure: rule.category.unitOfMeasure
                ? {
                    id: rule.category.unitOfMeasure.id,
                    name: rule.category.unitOfMeasure.name,
                  }
                : null,
            }
          : null,
    };
  });

  return {
    applicableMode: {
      applicable: applicable.applicable,
      reason: applicable.reason,
      ruleMatched: applicable.ruleMatched,
      matchedClauseCount: applicable.matchedClauseCount,
      totalClauseCount: applicable.totalClauseCount,
      type: applicable.modeType,
    },
    rows,
    summary: {
      totalCategories: rows.length,
      eligibleCategories: rows.filter((row) => row.eligible).length,
      totalSuggestedQuantity: rows.reduce((sum, row) => sum + Number(row.modeQuantity || 0), 0),
      totalIssuedQuantityInYear: rows.reduce(
        (sum, row) => sum + Number(row.issuedQuantityInYear || 0),
        0,
      ),
      totalEligibleQuantity: rows
        .filter((row) => row.eligible)
        .reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    },
  };
}

async function fetchIssueVoucherForScope({ actor, voucherId }) {
  assertAllocationModeManager(actor);
  const isSuperAdmin = hasAnyRole(actor, ["SUPER_ADMIN"]);
  const actorUnitId = getActorUnitId(actor);

  const voucher = await prisma.allocationModeIssueVoucher.findFirst({
    where: {
      id: voucherId,
      ...(!isSuperAdmin ? { unitId: actorUnitId } : {}),
    },
    include: {
      unit: {
        select: { id: true, name: true },
      },
      warehouse: {
        select: { id: true, name: true },
      },
      printTemplate: {
        select: { id: true, type: true, name: true },
      },
      printTemplateVersion: {
        select: { id: true, versionNo: true, config: true },
      },
      mode: {
        include: {
          unit: {
            select: { id: true, name: true },
          },
          createdBy: {
            select: {
              id: true,
              username: true,
              email: true,
              profile: {
                select: { fullName: true },
              },
              military: {
                select: { fullname: true },
              },
            },
          },
          categories: {
            where: { deletedAt: null },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
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
            },
          },
          militaryTypes: {
            include: {
              type: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                },
              },
            },
          },
          includedMilitaries: {
            include: {
              military: {
                select: {
                  id: true,
                  fullname: true,
                  militaryCode: true,
                },
              },
            },
          },
          excludedMilitaries: {
            include: {
              military: {
                select: {
                  id: true,
                  fullname: true,
                  militaryCode: true,
                },
              },
            },
          },
        },
      },
      military: {
        include: {
          unit: {
            select: { id: true, name: true },
          },
          genderCatalog: {
            select: { code: true, name: true },
          },
          typeAssignments: {
            where: {
              type: {
                deletedAt: null,
              },
            },
            include: {
              type: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                },
              },
            },
            orderBy: [{ typeId: "asc" }],
          },
        },
      },
      createdBy: {
        select: {
          id: true,
          username: true,
          email: true,
          profile: {
            select: { fullName: true },
          },
          military: {
            select: { fullname: true },
          },
        },
      },
      items: {
        orderBy: [{ categoryName: "asc" }, { createdAt: "asc" }],
        include: {
          category: {
            select: { id: true, name: true, code: true },
          },
          modeCategory: {
            select: { id: true, quantity: true },
          },
          appliedType: {
            select: { id: true, code: true, name: true },
          },
        },
      },
    },
  });

  if (!voucher) {
    throw new AppError({
      statusCode: HTTP_CODES.NOT_FOUND,
      message: "Phiếu xuất kho không tồn tại",
      errorCode: "ALLOCATION_MODE_ISSUE_VOUCHER_NOT_FOUND",
    });
  }

  return voucher;
}

function isVoucherNoConflict(error) {
  if (error?.code !== "P2002") return false;
  const target = Array.isArray(error?.meta?.target)
    ? error.meta.target.join(",")
    : String(error?.meta?.target || "");
  return target.includes("voucherNo");
}

async function buildIssueVoucherWorkbook(voucher) {
  const buffer = await fsp.readFile(VOUCHER_TEMPLATE_PATH);
  const workbook = await readWorkbookFromBuffer(buffer);
  const worksheet = workbook.worksheets[0] || workbook.addWorksheet("Phiếu xuất kho");
  worksheet.getCell("A5").value = formatIssueDateLine(new Date(voucher.issuedAt));

  const startRow = 11;
  voucher.items.forEach((item, index) => {
    const rowNumber = startRow + index;
    const row = worksheet.getRow(rowNumber);
    row.getCell(1).value = index + 1;
    row.getCell(2).value = [
      item.categoryName || item.category?.name || "",
      item.versionName && !isNoneLike(item.versionName) ? item.versionName : null,
      item.colorName && !isNoneLike(item.colorName) ? item.colorName : null,
    ]
      .filter(Boolean)
      .join(" - ");
    row.getCell(3).value = item.unitOfMeasureName || "";
    row.getCell(4).value = item.quantity;
    row.getCell(5).value = item.quantity;
    row.getCell(6).value = item.wasDue
      ? "Đã đến niên hạn"
      : item.nextEligibleYear
        ? `Chưa đến niên hạn (${item.nextEligibleYear})`
        : "";

    for (let cellIndex = 1; cellIndex <= 6; cellIndex += 1) {
      const cell = row.getCell(cellIndex);
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: cellIndex === 2 ? "left" : "center",
        wrapText: true,
      };
    }
  });

  worksheet.getColumn(1).width = Math.max(worksheet.getColumn(1).width || 10, 8);
  worksheet.getColumn(2).width = Math.max(worksheet.getColumn(2).width || 20, 40);
  worksheet.getColumn(3).width = Math.max(worksheet.getColumn(3).width || 10, 12);
  worksheet.getColumn(4).width = Math.max(worksheet.getColumn(4).width || 10, 12);
  worksheet.getColumn(5).width = Math.max(worksheet.getColumn(5).width || 10, 12);
  worksheet.getColumn(6).width = Math.max(worksheet.getColumn(6).width || 10, 24);
  applyIssueVoucherTemplateConfig({
    worksheet,
    voucher,
    tableEndRow: startRow + voucher.items.length - 1,
  });

  return writeWorkbookToBuffer(workbook);
}

class AllocationModeService {
  listModes = async ({ actor, query }) => {
    assertAllocationModeManager(actor);
    const isSuperAdmin = hasAnyRole(actor, ["SUPER_ADMIN"]);
    const actorUnitId = getActorUnitId(actor);
    const requestedUnitId = parseOptionalUnitId(query?.unitId);
    const scope = String(query?.scope || "all");
    const status = String(query?.status || "active");

    const where = {
      deletedAt: null,
      ...(status === "active" ? { isActive: true } : {}),
    };

    if (scope === "system") {
      where.scope = "SYSTEM";
    } else if (scope === "unit") {
      where.scope = "UNIT";
      where.unitId = isSuperAdmin ? requestedUnitId || actorUnitId : actorUnitId;
    } else if (isSuperAdmin && requestedUnitId) {
      where.OR = [
        { scope: "SYSTEM" },
        { scope: "UNIT", unitId: requestedUnitId },
      ];
    } else if (!isSuperAdmin) {
      where.OR = [
        { scope: "SYSTEM" },
        { scope: "UNIT", unitId: actorUnitId },
      ];
    }

    const modes = await prisma.allocationMode.findMany({
      where,
      orderBy: [{ scope: "asc" }, { name: "asc" }, { createdAt: "asc" }],
      include: {
        unit: {
          select: { id: true, name: true },
        },
        createdBy: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
        categories: {
          where: { deletedAt: null },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
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
          },
        },
        militaryTypes: {
          orderBy: [{ typeId: "asc" }],
          include: {
            type: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
        },
        includedMilitaries: {
          include: {
            military: {
              select: {
                id: true,
                fullname: true,
                militaryCode: true,
              },
            },
          },
        },
        excludedMilitaries: {
          include: {
            military: {
              select: {
                id: true,
                fullname: true,
                militaryCode: true,
              },
            },
          },
        },
      },
    });

    return {
      modes: modes.map(mapMode),
    };
  };

  createMode = async ({ actor, body }) => {
    const resolvedScope = await resolveModeScope({
      actor,
      scope: body?.scope,
      unitId: body?.unitId,
    });
    const actorUnitId = getActorUnitId(actor);

    await validateModeAssociations({
      categories: body.categories || [],
      militaryTypeIds: body.militaryTypeIds || [],
      includedMilitaryIds: body.includedMilitaryIds || [],
      excludedMilitaryIds: body.excludedMilitaryIds || [],
      scope: resolvedScope.scope,
      unitId: resolvedScope.unitId,
      actorUnitId,
    });

    const name = normalizeName(body.name);
    const code = normalizeName(body.code || "") || null;
    const nameNormalized = normalizeForCompare(name);

    const existing = await prisma.allocationMode.findFirst({
      where: {
        ownerKey: resolvedScope.ownerKey,
        nameNormalized,
      },
      select: {
        id: true,
        deletedAt: true,
      },
    });

    if (existing && !existing.deletedAt) {
      throw new AppError({
        statusCode: HTTP_CODES.CONFLICT,
        message: "Tên chế độ cấp phát đã tồn tại",
        errorCode: "ALLOCATION_MODE_NAME_DUPLICATE",
      });
    }

    await assertCodeUnique({
      ownerKey: resolvedScope.ownerKey,
      code,
    });

    const modeId = existing?.id;

    const createdMode = await prisma.$transaction(async (tx) => {
      const mode = modeId
        ? await tx.allocationMode.update({
            where: { id: modeId },
            data: {
              scope: resolvedScope.scope,
              ownerKey: resolvedScope.ownerKey,
              unitId: resolvedScope.unitId,
              code,
              name,
              nameNormalized,
              description: normalizeName(body.description || "") || null,
              isActive: body.isActive ?? true,
              ruleCombinator: String(body.ruleCombinator || "ALL"),
              ruleConfig: mapRuleConfig(body.ruleConfig),
              createdById: actor?.id || null,
              deletedAt: null,
            },
          })
        : await tx.allocationMode.create({
            data: {
              scope: resolvedScope.scope,
              ownerKey: resolvedScope.ownerKey,
              unitId: resolvedScope.unitId,
              code,
              name,
              nameNormalized,
              description: normalizeName(body.description || "") || null,
              isActive: body.isActive ?? true,
              ruleCombinator: String(body.ruleCombinator || "ALL"),
              ruleConfig: mapRuleConfig(body.ruleConfig),
              createdById: actor?.id || null,
            },
          });

      if (modeId) {
        await tx.allocationModeMilitaryType.deleteMany({ where: { modeId } });
        await tx.allocationModeMilitaryInclude.deleteMany({ where: { modeId } });
        await tx.allocationModeMilitaryExclude.deleteMany({ where: { modeId } });
      }

      await writeModeRelations(tx, mode.id, body);
      return mode;
    });

    return {
      mode: mapMode(await fetchModeById(createdMode.id)),
    };
  };

  updateMode = async ({ actor, modeId, body }) => {
    const current = await ensureModeEditable({ actor, modeId });
    const actorUnitId = getActorUnitId(actor);
    const nextName =
      body?.name !== undefined ? normalizeName(body.name) : current.name;
    const nextCode =
      body?.code !== undefined ? normalizeName(body.code || "") || null : current.code;
    const nextDescription =
      body?.description !== undefined
        ? normalizeName(body.description || "") || null
        : current.description;
    const nextRuleCombinator =
      body?.ruleCombinator !== undefined
        ? String(body.ruleCombinator || "ALL")
        : current.ruleCombinator;
    const nextRuleConfig =
      body?.ruleConfig !== undefined ? mapRuleConfig(body.ruleConfig) : current.ruleConfig;

    if (
      body.categories ||
      body.militaryTypeIds ||
      body.includedMilitaryIds ||
      body.excludedMilitaryIds
    ) {
      const persisted = await fetchModeById(current.id);
      await validateModeAssociations({
        categories:
          body.categories ||
          (persisted.categories || []).map((row) => ({
            categoryId: row.category.id,
            quantity: row.quantity,
            isActive: row.isActive,
            sortOrder: row.sortOrder,
          })),
        militaryTypeIds:
          body.militaryTypeIds || (persisted.militaryTypes || []).map((row) => row.id),
        includedMilitaryIds:
          body.includedMilitaryIds || (persisted.includedMilitaries || []).map((row) => row.id),
        excludedMilitaryIds:
          body.excludedMilitaryIds || (persisted.excludedMilitaries || []).map((row) => row.id),
        scope: current.scope,
        unitId: current.unitId,
        actorUnitId,
      });
    }

    const duplicatedName = await prisma.allocationMode.findFirst({
      where: {
        ownerKey: current.ownerKey,
        nameNormalized: normalizeForCompare(nextName),
        id: { not: current.id },
        deletedAt: null,
      },
      select: { id: true },
    });

    if (duplicatedName) {
      throw new AppError({
        statusCode: HTTP_CODES.CONFLICT,
        message: "Tên chế độ cấp phát đã tồn tại",
        errorCode: "ALLOCATION_MODE_NAME_DUPLICATE",
      });
    }

    await assertCodeUnique({
      ownerKey: current.ownerKey,
      code: nextCode,
      excludeId: current.id,
    });

    await prisma.$transaction(async (tx) => {
      await tx.allocationMode.update({
        where: { id: current.id },
        data: {
          code: nextCode,
          name: nextName,
          nameNormalized: normalizeForCompare(nextName),
          description: nextDescription,
          ruleCombinator: nextRuleCombinator,
          ruleConfig: nextRuleConfig,
          ...(body?.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
        },
      });

      if (body.categories) {
        await writeModeRelations(tx, current.id, {
          categories: body.categories,
        });
      }

      if (body.militaryTypeIds) {
        await tx.allocationModeMilitaryType.deleteMany({
          where: {
            modeId: current.id,
          },
        });
        await writeModeRelations(tx, current.id, {
          militaryTypeIds: body.militaryTypeIds,
        });
      }

      if (body.includedMilitaryIds) {
        await tx.allocationModeMilitaryInclude.deleteMany({
          where: {
            modeId: current.id,
          },
        });
        await writeModeRelations(tx, current.id, {
          includedMilitaryIds: body.includedMilitaryIds,
        });
      }

      if (body.excludedMilitaryIds) {
        await tx.allocationModeMilitaryExclude.deleteMany({
          where: {
            modeId: current.id,
          },
        });
        await writeModeRelations(tx, current.id, {
          excludedMilitaryIds: body.excludedMilitaryIds,
        });
      }
    });

    return {
      mode: mapMode(await fetchModeById(current.id)),
    };
  };

  listApplicableModes = async ({ actor, query }) => {
    const military = await fetchMilitaryForAllocation({
      actor,
      militaryId: String(query?.militaryId || "").trim(),
    });
    const issueYear = query?.issueYear
      ? parseIssueYear(query.issueYear)
      : new Date().getFullYear();

    const modes = await prisma.allocationMode.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [
          { scope: "SYSTEM" },
          { scope: "UNIT", unitId: Number(military.unitId) },
        ],
      },
      orderBy: [{ scope: "asc" }, { name: "asc" }],
      include: {
        unit: {
          select: { id: true, name: true },
        },
        createdBy: {
          select: { id: true, username: true, email: true },
        },
        categories: {
          where: { deletedAt: null, isActive: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: {
            category: {
              select: {
                id: true,
                name: true,
                code: true,
                unitOfMeasure: {
                  select: { id: true, name: true },
                },
              },
            },
          },
        },
        militaryTypes: {
          include: {
            type: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
        },
        includedMilitaries: {
          include: {
            military: {
              select: {
                id: true,
                fullname: true,
                militaryCode: true,
              },
            },
          },
        },
        excludedMilitaries: {
          include: {
            military: {
              select: {
                id: true,
                fullname: true,
                militaryCode: true,
              },
            },
          },
        },
      },
    });

    return {
      military: mapMilitarySummary(military),
      issueYear,
      modes: modes.map((mode) => {
        const evaluation = evaluateModeForMilitary({
          mode,
          military,
          issueYear,
        });

        return {
          ...mapMode(mode),
          applicability: {
            applicable: evaluation.applicable,
            reason: evaluation.reason,
            ruleMatched: evaluation.ruleMatched,
            matchedClauseCount: evaluation.matchedClauseCount,
            totalClauseCount: evaluation.totalClauseCount,
            isIncluded: evaluation.isIncluded,
            isExcluded: evaluation.isExcluded,
            type: evaluation.modeType,
          },
        };
      }),
    };
  };

  getModeEligibility = async ({ actor, modeId, query }) => {
    const issueYear = parseIssueYear(query?.issueYear);
    const military = await fetchMilitaryForAllocation({
      actor,
      militaryId: String(query?.militaryId || "").trim(),
    });
    const mode = await fetchModeForIssue(modeId);
    const referenceVoucher = query?.excludeVoucherId
      ? await fetchIssueVoucherForScope({
          actor,
          voucherId: String(query.excludeVoucherId).trim(),
        })
      : null;

    const warehouseId = query?.warehouseId
      ? Number.parseInt(query.warehouseId, 10)
      : null;

    if (warehouseId) {
      await fetchWarehouseInUnit({
        warehouseId,
        unitId: Number(military.unitId),
      });
    }

    const snapshot = await buildModeEligibilitySnapshot({
      mode,
      military,
      issueYear,
      warehouseId,
      excludeVoucherId: query?.excludeVoucherId
        ? String(query.excludeVoucherId).trim()
        : null,
      referenceVoucher,
    });

    return {
      military: mapMilitarySummary(military),
      mode: mapMode(mode),
      issueYear,
      warehouseId,
      ...snapshot,
    };
  };

  createIssueVoucher = async ({ actor, body }) => {
    const purpose = normalizeIssueVoucherPurpose(body?.purpose);
    const issueYear = parseIssueYear(body?.issueYear);
    const issuedAt = parseIssueDate(body?.issuedAt, issueYear);
    const warehouse = await fetchWarehouseForActor({
      actor,
      warehouseId: body?.warehouseId,
    });
    const warehouseId = Number(warehouse.id);
    const receiverName = normalizeName(body?.receiverName || "");
    const reason = normalizeName(body?.reason || "") || null;
    const note = normalizeName(body?.note || "") || null;
    const createdById = actor?.id || null;

    if (!receiverName) {
      throw new AppError({
        statusCode: HTTP_CODES.BAD_REQUEST,
        message: "Tên người nhận hàng là bắt buộc",
        errorCode: "ALLOCATION_MODE_RECEIVER_NAME_REQUIRED",
      });
    }
    if (purpose === "OTHER" && !reason) {
      throw new AppError({
        statusCode: HTTP_CODES.BAD_REQUEST,
        message: "Lý do xuất kho là bắt buộc với phiếu xuất khác",
        errorCode: "ALLOCATION_MODE_OTHER_REASON_REQUIRED",
      });
    }

    const requestedItems = Array.isArray(body?.items) ? body.items : [];
    let positiveRows = [];
    let deductions = [];
    let military = null;
    let mode = null;
    let snapshot = null;

    if (purpose === "OTHER") {
      positiveRows = (await buildOtherIssueRows({
        warehouseId,
        requestedItems,
      })).filter((row) => row.issueQuantity > 0);
    } else {
      military = await fetchMilitaryForAllocation({
        actor,
        militaryId: String(body?.militaryId || "").trim(),
      });
      mode = await fetchModeForIssue(String(body?.modeId || "").trim());

      if (Number(warehouse.unitId) !== Number(military.unitId)) {
        throw new AppError({
          statusCode: HTTP_CODES.BAD_REQUEST,
          message: "Kho không tồn tại trong đơn vị của quân nhân",
          errorCode: "WAREHOUSE_NOT_FOUND",
        });
      }

      snapshot = await buildModeEligibilitySnapshot({
        mode,
        military,
        issueYear,
        warehouseId,
      });

      if (!snapshot.applicableMode.applicable) {
        throw new AppError({
          statusCode: HTTP_CODES.BAD_REQUEST,
          message: snapshot.applicableMode.reason,
          errorCode: "ALLOCATION_MODE_NOT_APPLICABLE",
        });
      }

      positiveRows = buildPositiveIssueRows({
        snapshot,
        requestedItems,
      });
    }

    if (!positiveRows.length) {
      throw new AppError({
        statusCode: HTTP_CODES.BAD_REQUEST,
        message:
          purpose === "OTHER"
            ? "Phải chọn ít nhất một quân trang có số lượng xuất lớn hơn 0"
            : "Phải nhập ít nhất một quân trang có số lượng cấp phát lớn hơn 0",
        errorCode: "ALLOCATION_MODE_ISSUE_ITEMS_REQUIRED",
      });
    }

    positiveRows.forEach((row) => {
      if (purpose !== "OTHER" && !row.eligible) {
        throw new AppError({
          statusCode: HTTP_CODES.BAD_REQUEST,
          message: `Quân trang "${row.category?.name || row.categoryName || row.categoryId}" chưa đủ điều kiện cấp phát`,
          errorCode: "ALLOCATION_MODE_CATEGORY_NOT_ELIGIBLE",
        });
      }
      if (purpose !== "OTHER" && row.issueQuantity > Number(row.quantity || 0)) {
        throw new AppError({
          statusCode: HTTP_CODES.BAD_REQUEST,
          message: `Số lượng cấp phát của "${row.category?.name || row.categoryId}" vượt quá số lượng còn lại được cấp trong năm`,
          errorCode: "ALLOCATION_MODE_ISSUE_QUANTITY_EXCEEDS_MODE",
        });
      }
      if (row.issueQuantity > Number(row.warehouseStock || 0)) {
        throw new AppError({
          statusCode: HTTP_CODES.BAD_REQUEST,
          message: `Tồn kho của "${row.category?.name || row.categoryId}" không đủ để cấp phát`,
          errorCode: "ALLOCATION_MODE_ISSUE_STOCK_INSUFFICIENT",
        });
      }
      if (!Number.isInteger(row.request.versionId) || !Number.isInteger(row.request.colorId)) {
        throw new AppError({
          statusCode: HTTP_CODES.BAD_REQUEST,
          message: `Vui lòng chọn phiên bản và màu sắc cho "${row.category?.name || row.categoryId}"`,
          errorCode: "ALLOCATION_MODE_ISSUE_VARIANT_REQUIRED",
        });
      }
      const selectedVariant = (row.availableVariants || []).find(
        (variant) =>
          Number(variant.versionId) === Number(row.request.versionId) &&
          Number(variant.colorId) === Number(row.request.colorId),
      );
      if (!selectedVariant) {
        throw new AppError({
          statusCode: HTTP_CODES.BAD_REQUEST,
          message: `Phiên bản hoặc màu sắc đã chọn không tồn tại trong kho cho "${row.category?.name || row.categoryId}"`,
          errorCode: "ALLOCATION_MODE_ISSUE_VARIANT_NOT_FOUND",
        });
      }
      if (row.issueQuantity > Number(selectedVariant.quantity || 0)) {
        throw new AppError({
          statusCode: HTTP_CODES.BAD_REQUEST,
          message: `Tồn kho của phiên bản/màu đã chọn cho "${row.category?.name || row.categoryId}" không đủ`,
          errorCode: "ALLOCATION_MODE_ISSUE_VARIANT_STOCK_INSUFFICIENT",
        });
      }
      if (
        purpose !== "OTHER" &&
        row.lastIssuedYear !== null &&
        issueYear < Number(row.lastIssuedYear)
      ) {
        throw new AppError({
          statusCode: HTTP_CODES.BAD_REQUEST,
          message: `Không thể cấp phát lùi năm cho "${row.category?.name || row.categoryId}" vì đã có dữ liệu cấp phát mới hơn`,
          errorCode: "ALLOCATION_MODE_ISSUE_YEAR_BACKDATED",
        });
      }
    });

    deductions = buildIssueDeductions(positiveRows, warehouseId);
    let voucherId = null;
    let transactionError = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      voucherId = randomUUID();

      try {
        await prisma.$transaction(async (tx) => {
          const voucherNo = await buildNextVoucherNo(tx);
          const templateUsage = await printTemplateService.resolvePrintTemplateUsage({
            tx,
            unitId: Number(warehouse.unitId),
            templateType:
              printTemplateService.PRINT_TEMPLATE_TYPES
                .ALLOCATION_MODE_ISSUE_VOUCHER,
            actorId: createdById,
          });

          await tx.allocationModeIssueVoucher.create({
            data: {
              id: voucherId,
              voucherNo,
              purpose,
              unitId: Number(warehouse.unitId),
              warehouseId: warehouse.id,
              modeId: mode?.id || null,
              militaryId: military?.id || null,
              printTemplateType: templateUsage.type,
              printTemplateId: templateUsage.templateId,
              printTemplateVersionId: templateUsage.versionId,
              printTemplateVersionNo: templateUsage.versionNo,
              printTemplateSnapshot: templateUsage.snapshot,
              receiverName,
              issuedAt,
              issuedYear: issueYear,
              reason,
              note,
              createdById,
            },
          });

          await applyWarehouseStockAdjustments({
            tx,
            adjustments: deductions,
            operation: "decrement",
          });

          await tx.allocationModeIssueVoucherItem.createMany({
            data: positiveRows.map((row) => ({
              id: randomUUID(),
              voucherId,
              modeCategoryId: row.modeCategoryId,
              categoryId: Number(row.categoryId),
              versionId: Number(row.request.versionId),
              colorId: Number(row.request.colorId),
              appliedTypeId: snapshot?.applicableMode?.type?.id || null,
              quantity: Number(row.issueQuantity || 0),
              serviceLifeYears: Number(row.serviceLifeYears || 0),
              lastIssuedYear: row.lastIssuedYear,
              nextEligibleYear: row.nextEligibleYear,
              wasDue: purpose === "OTHER" ? false : Boolean(row.eligible),
              categoryName: row.category?.name || "",
              versionName:
                deductions.find((item) => Number(item.categoryId) === Number(row.categoryId))
                  ?.versionName || null,
              colorName:
                deductions.find((item) => Number(item.categoryId) === Number(row.categoryId))
                  ?.colorName || null,
              unitOfMeasureName: row.category?.unitOfMeasure?.name || null,
            })),
          });

          if (military) {
            await syncMilitaryCategoryStatuses({
              tx,
              militaryId: military.id,
              categoryIds: positiveRows.map((row) => Number(row.categoryId)),
            });
          }
        });

        transactionError = null;
        break;
      } catch (error) {
        if (isVoucherNoConflict(error) && attempt < 4) {
          transactionError = error;
          continue;
        }
        throw error;
      }
    }

    if (transactionError) {
      throw transactionError;
    }

    return {
      voucher: mapVoucher(await fetchIssueVoucherForScope({ actor, voucherId })),
    };
  };

  updateIssueVoucher = async ({ actor, voucherId, body }) => {
    const currentVoucher = await fetchIssueVoucherForScope({ actor, voucherId });
    const purpose = normalizeIssueVoucherPurpose(currentVoucher.purpose);
    const nextReceiverName =
      body?.receiverName !== undefined
        ? normalizeName(body.receiverName || "")
        : currentVoucher.receiverName || "";

    if (!nextReceiverName) {
      throw new AppError({
        statusCode: HTTP_CODES.BAD_REQUEST,
        message: "Tên người nhận hàng là bắt buộc",
        errorCode: "ALLOCATION_MODE_RECEIVER_NAME_REQUIRED",
      });
    }

    const nextNote =
      body?.note !== undefined
        ? normalizeName(body.note || "") || null
        : currentVoucher.note || null;
    const nextReason =
      body?.reason !== undefined
        ? normalizeName(body.reason || "") || null
        : currentVoucher.reason || null;

    if (purpose === "OTHER" && !nextReason) {
      throw new AppError({
        statusCode: HTTP_CODES.BAD_REQUEST,
        message: "Lý do xuất kho là bắt buộc với phiếu xuất khác",
        errorCode: "ALLOCATION_MODE_OTHER_REASON_REQUIRED",
      });
    }

    if (!body?.items) {
      await prisma.allocationModeIssueVoucher.update({
        where: { id: currentVoucher.id },
        data: {
          receiverName: nextReceiverName,
          reason: nextReason,
          note: nextNote,
        },
      });

      return {
        voucher: mapVoucher(await fetchIssueVoucherForScope({ actor, voucherId })),
      };
    }

    const restoredStockAdjustments = await resolveVoucherItemStockAdjustments({
      items: currentVoucher.items,
      warehouseId: currentVoucher.warehouse?.id || null,
    });
    let snapshot = null;
    let positiveRows = [];

    if (purpose === "OTHER") {
      const adjustedSnapshot = applyStockAdjustmentsToSnapshot(
        await getCategoryStockSnapshot({
          warehouseId: currentVoucher.warehouse?.id || null,
          categoryIds: [
            ...new Set([
              ...currentVoucher.items.map((item) => Number(item.categoryId)),
              ...(Array.isArray(body.items) ? body.items : []).map((item) =>
                Number(item?.categoryId),
              ),
            ].filter((categoryId) => categoryId > 0)),
          ],
        }),
        restoredStockAdjustments,
      );
      const requestedRows = await buildOtherIssueRows({
        warehouseId: currentVoucher.warehouse?.id || null,
        requestedItems: Array.isArray(body.items) ? body.items : [],
      });
      positiveRows = requestedRows
        .map((row) => {
          const stockEntry = adjustedSnapshot.get(Number(row.categoryId));
          return {
            ...row,
            warehouseStock: Number(stockEntry?.total || row.warehouseStock || 0),
            quantity: Number(stockEntry?.total || row.quantity || 0),
            remainingQuantity: Number(
              stockEntry?.total || row.remainingQuantity || 0,
            ),
            availableVariants: (stockEntry?.variants || []).map((variantRow) => ({
              variantId: variantRow.variantId,
              versionId: variantRow.variant?.version?.id || null,
              versionName: variantRow.variant?.version?.name || null,
              colorId: variantRow.variant?.color?.id || null,
              colorName: variantRow.variant?.color?.name || null,
              quantity: Number(variantRow.quantity || 0),
            })),
          };
        })
        .filter((row) => row.issueQuantity > 0);
    } else {
      snapshot = await buildModeEligibilitySnapshot({
        mode: currentVoucher.mode,
        military: currentVoucher.military,
        issueYear: currentVoucher.issuedYear,
        warehouseId: currentVoucher.warehouse?.id || null,
        excludeVoucherId: currentVoucher.id,
        restoredStockAdjustments,
        referenceVoucher: currentVoucher,
      });

      if (!snapshot.applicableMode.applicable) {
        throw new AppError({
          statusCode: HTTP_CODES.BAD_REQUEST,
          message: snapshot.applicableMode.reason,
          errorCode: "ALLOCATION_MODE_NOT_APPLICABLE",
        });
      }

      positiveRows = buildPositiveIssueRows({
        snapshot,
        requestedItems: Array.isArray(body.items) ? body.items : [],
      });
    }

    if (!positiveRows.length) {
      throw new AppError({
        statusCode: HTTP_CODES.BAD_REQUEST,
        message: "Phải giữ lại ít nhất một quân trang có số lượng lớn hơn 0 trong phiếu",
        errorCode: "ALLOCATION_MODE_ISSUE_ITEMS_REQUIRED",
      });
    }

    positiveRows.forEach((row) => {
      if (purpose !== "OTHER" && !row.eligible) {
        throw new AppError({
          statusCode: HTTP_CODES.BAD_REQUEST,
          message: `Quân trang "${row.category?.name || row.categoryId}" chưa đủ điều kiện cấp phát`,
          errorCode: "ALLOCATION_MODE_CATEGORY_NOT_ELIGIBLE",
        });
      }
      if (purpose !== "OTHER" && row.issueQuantity > Number(row.quantity || 0)) {
        throw new AppError({
          statusCode: HTTP_CODES.BAD_REQUEST,
          message: `Số lượng cấp phát của "${row.category?.name || row.categoryId}" vượt quá số lượng còn lại được cấp trong năm`,
          errorCode: "ALLOCATION_MODE_ISSUE_QUANTITY_EXCEEDS_MODE",
        });
      }
      if (!Number.isInteger(row.request.versionId) || !Number.isInteger(row.request.colorId)) {
        throw new AppError({
          statusCode: HTTP_CODES.BAD_REQUEST,
          message: `Vui lòng chọn phiên bản và màu sắc cho "${row.category?.name || row.categoryId}"`,
          errorCode: "ALLOCATION_MODE_ISSUE_VARIANT_REQUIRED",
        });
      }
      const selectedVariant = (row.availableVariants || []).find(
        (variant) =>
          Number(variant.versionId) === Number(row.request.versionId) &&
          Number(variant.colorId) === Number(row.request.colorId),
      );
      if (!selectedVariant) {
        throw new AppError({
          statusCode: HTTP_CODES.BAD_REQUEST,
          message: `Phiên bản hoặc màu sắc đã chọn không tồn tại trong kho cho "${row.category?.name || row.categoryId}"`,
          errorCode: "ALLOCATION_MODE_ISSUE_VARIANT_NOT_FOUND",
        });
      }
      if (row.issueQuantity > Number(selectedVariant.quantity || 0)) {
        throw new AppError({
          statusCode: HTTP_CODES.BAD_REQUEST,
          message: `Tồn kho của phiên bản/màu đã chọn cho "${row.category?.name || row.categoryId}" không đủ`,
          errorCode: "ALLOCATION_MODE_ISSUE_VARIANT_STOCK_INSUFFICIENT",
        });
      }
    });

    const deductions = buildIssueDeductions(
      positiveRows,
      Number(currentVoucher.warehouse?.id || 0),
    );
    const affectedCategoryIds = [
      ...new Set([
        ...currentVoucher.items.map((item) => Number(item.categoryId)),
        ...positiveRows.map((row) => Number(row.categoryId)),
      ]),
    ];

    await prisma.$transaction(async (tx) => {
      await applyWarehouseStockAdjustments({
        tx,
        adjustments: restoredStockAdjustments,
        operation: "increment",
      });

      await tx.allocationModeIssueVoucher.update({
        where: { id: currentVoucher.id },
        data: {
          receiverName: nextReceiverName,
          reason: nextReason,
          note: nextNote,
        },
      });

      await tx.allocationModeIssueVoucherItem.deleteMany({
        where: {
          voucherId: currentVoucher.id,
        },
      });

      await applyWarehouseStockAdjustments({
        tx,
        adjustments: deductions,
        operation: "decrement",
      });

      await tx.allocationModeIssueVoucherItem.createMany({
        data: positiveRows.map((row) => ({
          id: randomUUID(),
          voucherId: currentVoucher.id,
          modeCategoryId: row.modeCategoryId,
          categoryId: Number(row.categoryId),
          versionId: Number(row.request.versionId),
          colorId: Number(row.request.colorId),
          appliedTypeId: snapshot?.applicableMode?.type?.id || null,
          quantity: Number(row.issueQuantity || 0),
          serviceLifeYears: Number(row.serviceLifeYears || 0),
          lastIssuedYear: row.lastIssuedYear,
          nextEligibleYear: row.nextEligibleYear,
          wasDue: purpose === "OTHER" ? false : Boolean(row.eligible),
          categoryName: row.category?.name || "",
          versionName:
            deductions.find((item) => Number(item.categoryId) === Number(row.categoryId))
              ?.versionName || null,
          colorName:
            deductions.find((item) => Number(item.categoryId) === Number(row.categoryId))
              ?.colorName || null,
          unitOfMeasureName: row.category?.unitOfMeasure?.name || null,
        })),
      });

      if (currentVoucher.military?.id) {
        await syncMilitaryCategoryStatuses({
          tx,
          militaryId: currentVoucher.military.id,
          categoryIds: affectedCategoryIds,
        });
      }
    });

    return {
      voucher: mapVoucher(await fetchIssueVoucherForScope({ actor, voucherId })),
    };
  };

  deleteIssueVoucher = async ({ actor, voucherId }) => {
    const currentVoucher = await fetchIssueVoucherForScope({ actor, voucherId });
    const restoredStockAdjustments = await resolveVoucherItemStockAdjustments({
      items: currentVoucher.items,
      warehouseId: currentVoucher.warehouse?.id || null,
    });
    const affectedCategoryIds = [
      ...new Set(currentVoucher.items.map((item) => Number(item.categoryId))),
    ];

    await prisma.$transaction(async (tx) => {
      await applyWarehouseStockAdjustments({
        tx,
        adjustments: restoredStockAdjustments,
        operation: "increment",
      });

      await tx.allocationModeIssueVoucher.delete({
        where: { id: currentVoucher.id },
      });

      if (currentVoucher.military?.id) {
        await syncMilitaryCategoryStatuses({
          tx,
          militaryId: currentVoucher.military.id,
          categoryIds: affectedCategoryIds,
        });
      }
    });

    return {
      id: currentVoucher.id,
    };
  };

  listIssueVouchers = async ({ actor, query }) => {
    assertAllocationModeManager(actor);
    const isSuperAdmin = hasAnyRole(actor, ["SUPER_ADMIN"]);
    const actorUnitId = getActorUnitId(actor);
    const page = parsePositiveInt(query?.page, 1);
    const limit = Math.min(parsePositiveInt(query?.limit, 20), 100);
    const skip = (page - 1) * limit;
    const search = String(query?.search || "").trim();
    const sortBy = query?.sortBy === "issuedAt" ? "issuedAt" : "issuedAt";
    const sortDir = query?.sortDir === "asc" ? "asc" : "desc";

    const where = {
      ...(!isSuperAdmin ? { unitId: actorUnitId } : {}),
      ...(query?.purpose
        ? { purpose: normalizeIssueVoucherPurpose(query.purpose) }
        : {}),
      ...(query?.militaryId ? { militaryId: String(query.militaryId).trim() } : {}),
      ...(query?.modeId ? { modeId: String(query.modeId).trim() } : {}),
      ...(query?.warehouseId
        ? { warehouseId: Number.parseInt(query.warehouseId, 10) }
        : {}),
      ...(query?.issueYear ? { issuedYear: parseIssueYear(query.issueYear) } : {}),
      ...(search
        ? {
            OR: [
              { voucherNo: { contains: search } },
              { receiverName: { contains: search } },
              { reason: { contains: search } },
              {
                military: {
                  fullname: { contains: search },
                },
              },
              {
                military: {
                  militaryCode: { contains: search },
                },
              },
              {
                mode: {
                  name: { contains: search },
                },
              },
            ],
          }
        : {}),
    };

    const [total, vouchers] = await prisma.$transaction([
      prisma.allocationModeIssueVoucher.count({ where }),
      prisma.allocationModeIssueVoucher.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ [sortBy]: sortDir }, { createdAt: "desc" }],
        include: {
          unit: {
            select: { id: true, name: true },
          },
          warehouse: {
            select: { id: true, name: true },
          },
          printTemplate: {
            select: { id: true, type: true, name: true },
          },
          printTemplateVersion: {
            select: { id: true, versionNo: true, config: true },
          },
          mode: {
            include: {
              unit: {
                select: { id: true, name: true },
              },
              createdBy: {
                select: { id: true, username: true, email: true },
              },
              categories: {
                where: { deletedAt: null },
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
                include: {
                  category: {
                    select: {
                      id: true,
                      name: true,
                      code: true,
                      unitOfMeasure: {
                        select: { id: true, name: true },
                      },
                    },
                  },
                },
              },
              militaryTypes: {
                include: {
                  type: {
                    select: {
                      id: true,
                      code: true,
                      name: true,
                    },
                  },
                },
              },
              includedMilitaries: {
                include: {
                  military: {
                    select: {
                      id: true,
                      fullname: true,
                      militaryCode: true,
                    },
                  },
                },
              },
              excludedMilitaries: {
                include: {
                  military: {
                    select: {
                      id: true,
                      fullname: true,
                      militaryCode: true,
                    },
                  },
                },
              },
            },
          },
          military: {
            include: {
              unit: {
                select: { id: true, name: true },
              },
              genderCatalog: {
                select: { code: true, name: true },
              },
              typeAssignments: {
                where: {
                  type: {
                    deletedAt: null,
                  },
                },
                include: {
                  type: {
                    select: {
                      id: true,
                      code: true,
                      name: true,
                    },
                  },
                },
                orderBy: [{ typeId: "asc" }],
              },
            },
          },
          createdBy: {
            select: {
              id: true,
              username: true,
              email: true,
              profile: {
                select: { fullName: true },
              },
              military: {
                select: { fullname: true },
              },
            },
          },
          items: {
            include: {
              category: {
                select: { id: true, name: true, code: true },
              },
              modeCategory: {
                select: { id: true, quantity: true },
              },
              appliedType: {
                select: { id: true, code: true, name: true },
              },
            },
          },
        },
      }),
    ]);

    return {
      vouchers: vouchers.map(mapVoucher),
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  };

  getIssueVoucherById = async ({ actor, voucherId }) => ({
    voucher: mapVoucher(await fetchIssueVoucherForScope({ actor, voucherId })),
  });

  getIssueVoucherFile = async ({ actor, voucherId }) => {
    const voucher = mapVoucher(await fetchIssueVoucherForScope({ actor, voucherId }));
    const buffer = await buildIssueVoucherWorkbook(voucher);

    return {
      fileName: `${voucher.voucherNo}.xlsx`,
      buffer,
    };
  };

  getVoucherTemplate = async ({ actor, query }) => {
    assertAllocationModeManager(actor);
    return printTemplateService.getCurrentPrintTemplate({
      actor,
      templateType: query?.templateType,
    });
  };

  updateVoucherTemplate = async ({ actor, body }) => {
    assertAllocationModeManager(actor);
    return printTemplateService.createPrintTemplateVersion({
      actor,
      templateType: body?.templateType,
      config: body?.config,
    });
  };

  deleteMode = async ({ actor, modeId }) => {
    const current = await ensureModeEditable({ actor, modeId });

    await prisma.allocationMode.update({
      where: { id: current.id },
      data: {
        deletedAt: new Date(),
      },
    });

    return {
      id: current.id,
    };
  };
}

export default new AllocationModeService();
