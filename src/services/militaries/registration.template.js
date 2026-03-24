import crypto from "crypto";
import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import {
  assertSizeRegistrationAccess,
  parseBooleanLike,
} from "#services/militaries/common.js";
import {
  getRegistrationCategories,
  parseRegistrationYear,
} from "#services/militaries/registration.shared.js";
import {
  appendWorksheetFromRows,
  applyListValidationRules,
  createWorkbook,
  writeWorkbookToBuffer,
  columnNumberToName,
} from "#services/spreadsheet/excel.util.js";

const SIZE_REGISTRATION_TEMPLATE_FILE_PREFIX = "size-registration-template";
const SIZE_REGISTRATION_SHEET_NAME = "DangKyCoSo";
const SIZE_OPTIONS_SHEET_NAME = "DanhMucCoSo";
const SIZE_TEMPLATE_META_SHEET_NAME = "HeThongMeta";
const SIZE_TEMPLATE_TYPE = "SIZE_REGISTRATION";
const SIZE_TEMPLATE_VERSION = "1";

function parseCategoryIdsInput(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") return [];

  const source = Array.isArray(rawValue)
    ? rawValue
    : String(rawValue)
        .split(",")
        .map((item) => item.trim());

  const ids = source
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  return [...new Set(ids)];
}

function parseHeaderSignature(headers) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(headers.map((item) => String(item || "").trim())))
    .digest("hex");
}

export function getSizeRegistrationTemplateFileName(year) {
  const date = new Date().toISOString().slice(0, 10);
  const selectedYear = parseRegistrationYear(year);
  return `${SIZE_REGISTRATION_TEMPLATE_FILE_PREFIX}-${selectedYear}-${date}.xlsx`;
}

export async function getSizeRegistrationTemplate({
  actor,
  categoryIds: rawCategoryIds,
  includeExisting,
  year: rawYear,
}) {
  const actorUnitId = assertSizeRegistrationAccess(actor);
  const selectedYear = parseRegistrationYear(rawYear);
  const categories = await getRegistrationCategories();
  const selectedCategoryIds = parseCategoryIdsInput(rawCategoryIds);
  const hasCategoryFilter = selectedCategoryIds.length > 0;
  const selectedCategoryIdSet = new Set(selectedCategoryIds);
  const selectedCategories = hasCategoryFilter
    ? categories.filter((category) => selectedCategoryIdSet.has(category.id))
    : categories;

  if (selectedCategories.length === 0) {
    throw new AppError({
      message: "No valid category found for template generation",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "CATEGORY_TEMPLATE_EMPTY",
    });
  }

  if (hasCategoryFilter && selectedCategories.length !== selectedCategoryIds.length) {
    const selectedMap = new Set(selectedCategories.map((category) => category.id));
    const missingCategoryIds = selectedCategoryIds.filter((id) => !selectedMap.has(id));

    throw new AppError({
      message: `Category not found: ${missingCategoryIds.join(", ")}`,
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "CATEGORY_NOT_FOUND",
    });
  }

  const shouldIncludeExisting = parseBooleanLike(includeExisting, true);

  const militaries = await prisma.military.findMany({
    where: {
      unitId: actorUnitId,
      deletedAt: null,
    },
    select: {
      id: true,
      militaryCode: true,
      fullname: true,
      assignedUnit: true,
      yearlyRegistrations: {
        where: {
          year: selectedYear,
          deletedAt: null,
        },
        select: {
          categoryId: true,
          categorySize: {
            select: {
              size: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: {
      fullname: "asc",
    },
  });

  const categoryColumns = selectedCategories.map((category) => ({
    ...category,
    header: `${category.name} (CAT_${category.id})`,
  }));

  const mainHeaderRow = [
    "militaryCode",
    "fullname",
    "assignedUnit",
    ...categoryColumns.map((column) => column.header),
  ];

  const dataRows = militaries.map((military) => {
    const sizeByCategoryId = shouldIncludeExisting
      ? new Map(
          military.yearlyRegistrations.map((registration) => [
            registration.categoryId,
            registration.categorySize.size.name,
          ]),
        )
      : new Map();

    return [
      military.militaryCode,
      military.fullname,
      military.assignedUnit || "",
      ...categoryColumns.map((column) => sizeByCategoryId.get(column.id) || ""),
    ];
  });

  const templateRows = [mainHeaderRow, ...dataRows];

  const optionHeaderRow = categoryColumns.map(
    (column) => `CAT_${column.id} - ${column.name}`,
  );
  const maxOptionRows = Math.max(1, ...categoryColumns.map((column) => column.sizes.length));
  const optionRows = [optionHeaderRow];

  for (let rowIndex = 0; rowIndex < maxOptionRows; rowIndex += 1) {
    optionRows.push(categoryColumns.map((column) => column.sizes[rowIndex]?.name || ""));
  }

  const workbook = await createWorkbook();
  const mainSheet = appendWorksheetFromRows(workbook, {
    name: SIZE_REGISTRATION_SHEET_NAME,
    rows: templateRows,
    widths: [18, 24, 20, ...categoryColumns.map(() => 24)],
  });
  appendWorksheetFromRows(workbook, {
    name: SIZE_OPTIONS_SHEET_NAME,
    rows: optionRows,
    widths: categoryColumns.map(() => 24),
    state: "hidden",
  });
  const metaRows = [
    ["key", "value"],
    ["templateType", SIZE_TEMPLATE_TYPE],
    ["templateVersion", SIZE_TEMPLATE_VERSION],
    ["unitId", String(actorUnitId)],
    ["year", String(selectedYear)],
    ["generatedAt", new Date().toISOString()],
    ["categoryIds", selectedCategories.map((item) => item.id).join(",")],
    ["frameStartRow", "2"],
    ["frameEndRow", String(dataRows.length + 1)],
    ["frameStartCol", "1"],
    ["frameEndCol", String(mainHeaderRow.length)],
    ["headerSignature", parseHeaderSignature(mainHeaderRow)],
  ];
  appendWorksheetFromRows(workbook, {
    name: SIZE_TEMPLATE_META_SHEET_NAME,
    rows: metaRows,
    state: "hidden",
  });

  const maxInputRow = Math.max(500, dataRows.length + 500);
  const dataValidationRules = categoryColumns
    .map((column, index) => {
      if (!column.sizes.length) return null;

      const targetCol = columnNumberToName(4 + index);
      const optionsCol = columnNumberToName(1 + index);
      const optionEndRow = 1 + column.sizes.length;

      return {
        sqref: `${targetCol}2:${targetCol}${maxInputRow}`,
        formula1: `${SIZE_OPTIONS_SHEET_NAME}!$${optionsCol}$2:$${optionsCol}$${optionEndRow}`,
      };
    })
    .filter(Boolean);

  applyListValidationRules(mainSheet, dataValidationRules);

  return writeWorkbookToBuffer(workbook);
}
