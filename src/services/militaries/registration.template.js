import crypto from "crypto";
import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import {
  assertSizeRegistrationAccess,
  loadXlsxLibrary,
  parseBooleanLike,
} from "#services/militaries/common.js";
import {
  getRegistrationCategories,
  parseRegistrationYear,
} from "#services/militaries/registration.shared.js";

const SIZE_REGISTRATION_TEMPLATE_FILE_PREFIX = "size-registration-template";
const SIZE_REGISTRATION_SHEET_NAME = "DangKyCoSo";
const SIZE_OPTIONS_SHEET_NAME = "DanhMucCoSo";
const SIZE_TEMPLATE_META_SHEET_NAME = "HeThongMeta";
const SIZE_TEMPLATE_TYPE = "SIZE_REGISTRATION";
const SIZE_TEMPLATE_VERSION = "1";

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toExcelColumnName(columnIndex) {
  let dividend = columnIndex;
  let columnName = "";

  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    columnName = String.fromCharCode(65 + modulo) + columnName;
    dividend = Math.floor((dividend - modulo) / 26);
  }

  return columnName;
}

function buildDataValidationXml(rules) {
  if (!rules.length) return "";

  const validationRows = rules
    .map(
      (rule) =>
        `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorStyle="stop" sqref="${escapeXml(
          rule.sqref,
        )}"><formula1>${escapeXml(rule.formula1)}</formula1></dataValidation>`,
    )
    .join("");

  return `<dataValidations count="${rules.length}">${validationRows}</dataValidations>`;
}

function injectDataValidationToFirstWorksheet(xlsxBuffer, dataValidationXml, XLSX) {
  if (!dataValidationXml) return xlsxBuffer;

  const cfb = XLSX.CFB.read(xlsxBuffer, { type: "buffer" });
  const sheetEntry = cfb.FileIndex.find((entry) => entry.name === "sheet1.xml");

  if (!sheetEntry) return xlsxBuffer;

  const sheetXml = Buffer.isBuffer(sheetEntry.content)
    ? sheetEntry.content.toString("utf8")
    : String(sheetEntry.content || "");

  const cleanedXml = sheetXml.replace(
    /<dataValidations[\s\S]*?<\/dataValidations>/g,
    "",
  );
  const hasIgnoredErrors = /<ignoredErrors[\s\S]*?<\/ignoredErrors>/i.test(
    cleanedXml,
  );
  const injectedXml = hasIgnoredErrors
    ? cleanedXml.replace(
        /<ignoredErrors/i,
        `${dataValidationXml}<ignoredErrors`,
      )
    : cleanedXml.replace(
        /<\/worksheet>\s*$/i,
        `${dataValidationXml}</worksheet>`,
      );

  sheetEntry.content = Buffer.from(injectedXml, "utf8");
  return XLSX.CFB.write(cfb, { type: "buffer", fileType: "zip" });
}

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
  const XLSX = await loadXlsxLibrary();
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
  const mainSheet = XLSX.utils.aoa_to_sheet(templateRows);
  mainSheet["!cols"] = [
    { wch: 18 },
    { wch: 24 },
    { wch: 20 },
    ...categoryColumns.map(() => ({ wch: 24 })),
  ];

  const optionHeaderRow = categoryColumns.map(
    (column) => `CAT_${column.id} - ${column.name}`,
  );
  const maxOptionRows = Math.max(1, ...categoryColumns.map((column) => column.sizes.length));
  const optionRows = [optionHeaderRow];

  for (let rowIndex = 0; rowIndex < maxOptionRows; rowIndex += 1) {
    optionRows.push(categoryColumns.map((column) => column.sizes[rowIndex]?.name || ""));
  }

  const optionsSheet = XLSX.utils.aoa_to_sheet(optionRows);
  optionsSheet["!cols"] = categoryColumns.map(() => ({ wch: 24 }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, mainSheet, SIZE_REGISTRATION_SHEET_NAME);
  XLSX.utils.book_append_sheet(workbook, optionsSheet, SIZE_OPTIONS_SHEET_NAME);
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
  const metaSheet = XLSX.utils.aoa_to_sheet(metaRows);
  XLSX.utils.book_append_sheet(workbook, metaSheet, SIZE_TEMPLATE_META_SHEET_NAME);
  workbook.Workbook = workbook.Workbook || {};
  workbook.Workbook.Sheets = [
    { name: SIZE_REGISTRATION_SHEET_NAME, Hidden: 0 },
    { name: SIZE_OPTIONS_SHEET_NAME, Hidden: 1 },
    { name: SIZE_TEMPLATE_META_SHEET_NAME, Hidden: 1 },
  ];

  let fileBuffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  });

  const maxInputRow = Math.max(500, dataRows.length + 500);
  const dataValidationRules = categoryColumns
    .map((column, index) => {
      if (!column.sizes.length) return null;

      const targetCol = toExcelColumnName(4 + index);
      const optionsCol = toExcelColumnName(1 + index);
      const optionEndRow = 1 + column.sizes.length;

      return {
        sqref: `${targetCol}2:${targetCol}${maxInputRow}`,
        formula1: `${SIZE_OPTIONS_SHEET_NAME}!$${optionsCol}$2:$${optionsCol}$${optionEndRow}`,
      };
    })
    .filter(Boolean);

  const dataValidationXml = buildDataValidationXml(dataValidationRules);
  fileBuffer = injectDataValidationToFirstWorksheet(fileBuffer, dataValidationXml, XLSX);

  return fileBuffer;
}
