import crypto from "crypto";
import path from "path";
import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import {
  parseMultipartFormData,
} from "#services/militaries/common.js";
import {
  normalizeForCompare,
  normalizeName,
  throwBadRequest,
} from "#services/inventory/common.js";
import { buildAutoItemCode } from "#services/inventory/item-code.service.js";
import {
  appendWorksheetFromRows,
  applyListValidationRules,
  createWorkbook,
  readWorkbookFromBuffer,
  worksheetToRowArrays,
  writeWorkbookToBuffer,
} from "#services/spreadsheet/excel.util.js";

const ITEM_TEMPLATE_FILE_PREFIX = "inventory-items-template";
const ITEM_TEMPLATE_SHEET_NAME = "MatHangQuanTrang";
const CATEGORY_SHEET_NAME = "DanhMucQuanTrang";
const UNIT_OF_MEASURE_SHEET_NAME = "DonViTinh";
const TEMPLATE_META_SHEET_NAME = "HeThongMeta";
const TEMPLATE_TYPE = "SUPPLY_ITEM_IMPORT";
const TEMPLATE_VERSION = "1";
const TEMPLATE_HEADERS = ["itemName", "categoryName", "unitOfMeasureName", "note"];

function parseHeaderSignature(headers) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(headers.map((item) => String(item || "").trim())))
    .digest("hex");
}

function parseMetaSheet(sheet) {
  if (!sheet) return new Map();
  const rows = worksheetToRowArrays(sheet, { blankrows: false });
  return new Map(
    rows
      .slice(1)
      .map((row) => [String(row?.[0] || "").trim(), String(row?.[1] || "").trim()])
      .filter(([key]) => key.length > 0),
  );
}

function parseTemplateRows(sheet) {
  const rows = worksheetToRowArrays(sheet, { blankrows: false });

  if (!rows.length) {
    throwBadRequest("Template không có dữ liệu", "ITEM_TEMPLATE_EMPTY");
  }

  const headers = rows[0].map((value) => String(value || "").trim());
  const signature = parseHeaderSignature(headers);

  const parsedRows = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const itemName = normalizeName(row[0]);
    const categoryName = normalizeName(row[1]);
    const unitOfMeasureName = normalizeName(row[2]);
    const note = normalizeName(row[3]);

    if (!itemName && !categoryName && !unitOfMeasureName && !note) continue;

    parsedRows.push({
      excelRow: index + 1,
      itemName,
      categoryName,
      unitOfMeasureName,
    });
  }

  return { headers, signature, parsedRows };
}

export function getItemImportTemplateFileName() {
  const date = new Date().toISOString().slice(0, 10);
  return `${ITEM_TEMPLATE_FILE_PREFIX}-${date}.xlsx`;
}

export async function getItemImportTemplate() {
  const [categories, unitOfMeasures] = await Promise.all([
    prisma.category.findMany({
      where: {
        deletedAt: null,
      },
      orderBy: {
        name: "asc",
      },
      select: {
        id: true,
        name: true,
        sizes: {
          where: {
            size: { deletedAt: null },
          },
          include: {
            size: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    }),
    prisma.unitOfMeasure.findMany({
      where: {
        deletedAt: null,
      },
      orderBy: {
        name: "asc",
      },
      select: {
        name: true,
      },
    }),
  ]);

  if (!categories.length) {
    throw new AppError({
      message: "Chưa có danh mục quân trang để tạo template",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "CATEGORY_TEMPLATE_EMPTY",
    });
  }
  if (!unitOfMeasures.length) {
    throw new AppError({
      message: "Chưa có đơn vị tính để tạo template",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "UNIT_OF_MEASURE_TEMPLATE_EMPTY",
    });
  }

  const firstUnitOfMeasure = unitOfMeasures[0]?.name || "Cái";
  const mainRows = [TEMPLATE_HEADERS];
  const firstCategory = categories[0];
  mainRows.push([
    "Áo mưa",
    firstCategory.name,
    firstUnitOfMeasure,
    "Nhập categoryName theo danh mục hiện tại",
  ]);

  const categoryRows = [
    ["categoryName", "sizeSystem"],
    ...categories.map((category) => [
      category.name,
      category.sizes.map((item) => item.size.name).join(", "),
    ]),
  ];
  const unitRows = [
    ["unitOfMeasureName"],
    ...unitOfMeasures.map((unit) => [unit.name]),
  ];

  const metaRows = [
    ["key", "value"],
    ["templateType", TEMPLATE_TYPE],
    ["templateVersion", TEMPLATE_VERSION],
    ["generatedAt", new Date().toISOString()],
    ["headerSignature", parseHeaderSignature(TEMPLATE_HEADERS)],
  ];
  const workbook = await createWorkbook();
  const mainSheet = appendWorksheetFromRows(workbook, {
    name: ITEM_TEMPLATE_SHEET_NAME,
    rows: mainRows,
    widths: [28, 26, 20, 36],
  });
  appendWorksheetFromRows(workbook, {
    name: CATEGORY_SHEET_NAME,
    rows: categoryRows,
    widths: [30, 42],
  });
  appendWorksheetFromRows(workbook, {
    name: UNIT_OF_MEASURE_SHEET_NAME,
    rows: unitRows,
    widths: [24],
  });
  appendWorksheetFromRows(workbook, {
    name: TEMPLATE_META_SHEET_NAME,
    rows: metaRows,
    state: "hidden",
  });

  const categoryFormula = `${CATEGORY_SHEET_NAME}!$A$2:$A$${categories.length + 1}`;
  const unitFormula = `${UNIT_OF_MEASURE_SHEET_NAME}!$A$2:$A$${unitOfMeasures.length + 1}`;
  applyListValidationRules(mainSheet, [
    {
      sqref: "B2:B1000",
      formula1: categoryFormula,
    },
    {
      sqref: "C2:C1000",
      formula1: unitFormula,
    },
  ]);

  return writeWorkbookToBuffer(workbook);
}

export async function importItemsByTemplate({ req }) {
  const { files } = await parseMultipartFormData(req);

  if (!files.file) {
    throwBadRequest("File là bắt buộc (field: file)", "FILE_REQUIRED");
  }

  const fileName = files.file.filename || "inventory-items-import.xlsx";
  const extension = path.extname(fileName).toLowerCase();
  if (extension !== ".xlsx") {
    throwBadRequest(
      "Định dạng file không hợp lệ, chỉ hỗ trợ .xlsx",
      "UNSUPPORTED_IMPORT_FILE",
    );
  }

  const workbook = await readWorkbookFromBuffer(files.file.content);
  const mainSheet =
    workbook.getWorksheet(ITEM_TEMPLATE_SHEET_NAME) || workbook.worksheets[0];
  if (!mainSheet) {
    throwBadRequest("Không tìm thấy sheet dữ liệu mặt hàng", "ITEM_TEMPLATE_SHEET_NOT_FOUND");
  }

  const metaSheet = workbook.getWorksheet(TEMPLATE_META_SHEET_NAME);
  const meta = parseMetaSheet(metaSheet);
  if (meta.get("templateType") !== TEMPLATE_TYPE || meta.get("templateVersion") !== TEMPLATE_VERSION) {
    throwBadRequest(
      "Template không hợp lệ hoặc không phải template hệ thống",
      "ITEM_TEMPLATE_INVALID",
    );
  }

  const { signature, parsedRows } = parseTemplateRows(mainSheet);
  const expectedHeaderSignature = meta.get("headerSignature");
  if (!expectedHeaderSignature || signature !== expectedHeaderSignature) {
    throwBadRequest(
      "Header template đã bị thay đổi, vui lòng tải template mới",
      "ITEM_TEMPLATE_HEADER_CHANGED",
    );
  }

  if (!parsedRows.length) {
    throwBadRequest("Không có dòng dữ liệu hợp lệ để import", "ITEM_IMPORT_EMPTY");
  }

  const [categories, unitOfMeasures] = await Promise.all([
    prisma.category.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    }),
    prisma.unitOfMeasure.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    }),
  ]);
  const categoryByNameNormalized = new Map(
    categories.map((item) => [normalizeForCompare(item.name), item]),
  );
  const unitByNameNormalized = new Map(
    unitOfMeasures.map((item) => [normalizeForCompare(item.name), item]),
  );

  const existingItems = await prisma.supplyItem.findMany({
    select: {
      id: true,
      name: true,
      nameNormalized: true,
      code: true,
      deletedAt: true,
    },
  });

  const existingByNameNormalized = new Map(
    existingItems.map((item) => [item.nameNormalized, item]),
  );
  const inFileNames = new Set();
  const validRows = [];
  const skippedRows = [];

  for (const row of parsedRows) {
    const name = normalizeName(row.itemName);
    const categoryName = normalizeName(row.categoryName);
    const unitOfMeasureName = normalizeName(row.unitOfMeasureName);
    const category = categoryByNameNormalized.get(normalizeForCompare(categoryName));
    const unitOfMeasure = unitByNameNormalized.get(
      normalizeForCompare(unitOfMeasureName),
    );
    const categoryId = category?.id;
    const unitOfMeasureId = unitOfMeasure?.id;
    const nameNormalized = normalizeForCompare(name);

    if (!name) {
      skippedRows.push({
        rowNumber: row.excelRow,
        reason: "Thiếu itemName",
      });
      continue;
    }

    if (!categoryId) {
      skippedRows.push({
        rowNumber: row.excelRow,
        reason: `categoryName không hợp lệ: ${row.categoryName || "(trống)"}`,
      });
      continue;
    }

    if (!unitOfMeasureId) {
      skippedRows.push({
        rowNumber: row.excelRow,
        reason: `unitOfMeasureName không hợp lệ: ${
          row.unitOfMeasureName || "(trống)"
        }`,
      });
      continue;
    }

    if (inFileNames.has(nameNormalized)) {
      skippedRows.push({
        rowNumber: row.excelRow,
        reason: "Trùng itemName trong file import",
      });
      continue;
    }

    if (existingByNameNormalized.has(nameNormalized)) {
      const existed = existingByNameNormalized.get(nameNormalized);
      skippedRows.push({
        rowNumber: row.excelRow,
        reason: existed?.deletedAt
          ? "Mặt hàng đã tồn tại nhưng đang ở trạng thái đã xoá"
          : "Mặt hàng đã tồn tại",
      });
      continue;
    }

    inFileNames.add(nameNormalized);
    validRows.push({
      name,
      nameNormalized,
      code: null,
      categoryId,
      unitOfMeasureId,
    });
  }

  if (!validRows.length) {
    return {
      importedRows: 0,
      skippedRows: skippedRows.length,
      skippedDetails: skippedRows,
    };
  }

  const createdIds = [];
  for (const row of validRows) {
    const created = await prisma.supplyItem.create({
      data: row,
      select: { id: true },
    });
    createdIds.push(created.id);
  }

  for (const id of createdIds) {
    const code = buildAutoItemCode(id);
    await prisma.supplyItem.update({
      where: { id },
      data: { code },
      select: { id: true },
    });
  }

  return {
    importedRows: validRows.length,
    skippedRows: skippedRows.length,
    skippedDetails: skippedRows,
  };
}
