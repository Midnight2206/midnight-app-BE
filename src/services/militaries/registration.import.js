import path from "path";
import crypto from "crypto";
import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import {
  assertSizeRegistrationAccess,
  parseBooleanLike,
  parseMultipartFormData,
  parseInteger,
} from "#services/militaries/common.js";
import {
  getRegistrationCategories,
  parseRegistrationYear,
  upsertPeriodForYear,
} from "#services/militaries/registration.shared.js";
import {
  readWorkbookFromBuffer,
  worksheetToRowArrays,
} from "#services/spreadsheet/excel.util.js";

const SIZE_REGISTRATION_SHEET_NAME = "DangKyCoSo";
const SIZE_TEMPLATE_META_SHEET_NAME = "HeThongMeta";
const SIZE_TEMPLATE_TYPE = "SIZE_REGISTRATION";
const SIZE_TEMPLATE_VERSION = "1";
const MAX_IMPORT_ROWS = 5000;
const IMPORT_APPROVAL_TTL_MS = 10 * 60 * 1000;
const IMPORT_APPROVAL_SECRET =
  process.env.SIZE_IMPORT_APPROVAL_SECRET || crypto.randomBytes(32).toString("hex");

function normalizeSizeNameForCompare(name) {
  return String(name || "")
    .normalize("NFC")
    .trim()
    .toLowerCase();
}

function parseCategoryIdFromTemplateHeader(header) {
  const matched = String(header || "").match(/CAT_(\d+)/i);
  if (!matched) return null;
  return Number(matched[1]);
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

function hashBufferSha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function buildImportFingerprint({
  actorUnitId,
  selectedYear,
  keepExisting,
  importedCategoryIds,
  parsedRows,
  rowsWithoutSelections,
  totalRegistrationAssignments,
  existingRowsToReplace,
  fileChecksum,
}) {
  const normalizedCategoryIds = [...importedCategoryIds].sort((a, b) => a - b);
  const payload = JSON.stringify({
    actorUnitId,
    selectedYear,
    keepExisting,
    importedCategoryIds: normalizedCategoryIds,
    parsedRows: parsedRows.length,
    rowsWithoutSelections,
    totalRegistrationAssignments,
    existingRowsToReplace,
    fileChecksum,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function signImportApprovalToken(payload) {
  const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", IMPORT_APPROVAL_SECRET)
    .update(payloadBase64)
    .digest("hex");
  return `v1.${payloadBase64}.${signature}`;
}

function verifyImportApprovalToken(token) {
  const normalized = String(token || "").trim();
  const parts = normalized.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;

  const payloadBase64 = parts[1];
  const signature = parts[2];
  const expectedSignature = crypto
    .createHmac("sha256", IMPORT_APPROVAL_SECRET)
    .update(payloadBase64)
    .digest("hex");

  const actualBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payloadText = Buffer.from(payloadBase64, "base64url").toString("utf8");
    return JSON.parse(payloadText);
  } catch {
    return null;
  }
}

function parseMetaSheet(workbook) {
  const metaSheet = workbook.getWorksheet(SIZE_TEMPLATE_META_SHEET_NAME);
  if (!metaSheet) {
    throw new AppError({
      message: "Import file is not a valid system template (metadata sheet missing)",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "XLSX_TEMPLATE_META_MISSING",
    });
  }

  const rows = worksheetToRowArrays(metaSheet);
  const kv = new Map();
  for (let i = 1; i < rows.length; i += 1) {
    const key = String(rows[i]?.[0] || "").trim();
    const value = String(rows[i]?.[1] || "").trim();
    if (!key) continue;
    kv.set(key, value);
  }

  const templateType = kv.get("templateType");
  const templateVersion = kv.get("templateVersion");
  if (templateType !== SIZE_TEMPLATE_TYPE || templateVersion !== SIZE_TEMPLATE_VERSION) {
    throw new AppError({
      message: "Import file metadata is invalid or unsupported",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "XLSX_TEMPLATE_META_INVALID",
    });
  }

  return kv;
}

function parseHeaderSignature(headers) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(headers.map((item) => String(item || "").trim())))
    .digest("hex");
}

export async function prepareSizeRegistrationsImportPayload({ actor, req }) {
  const actorUnitId = assertSizeRegistrationAccess(actor);
  const { files, fields } = await parseMultipartFormData(req);
  const selectedYear = parseRegistrationYear(fields.year);

  if (!files.file) {
    throw new AppError({
      message: "File is required (field name: file)",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "FILE_REQUIRED",
    });
  }

  const fileName = files.file.filename || "size-registration-import.xlsx";
  const extension = path.extname(fileName).toLowerCase();

  if (extension !== ".xlsx") {
    throw new AppError({
      message: "Unsupported file type. Please upload .xlsx only",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "UNSUPPORTED_IMPORT_FILE",
    });
  }

  const keepExisting = parseBooleanLike(fields.keepExisting, false);
  const approvalToken = String(fields.approvalToken || "").trim();
  const requestedCategoryIds = parseCategoryIdsInput(fields.categoryIds);
  const requestedCategoryIdSet = new Set(requestedCategoryIds);

  const categories = await getRegistrationCategories();
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const sizeLookupByCategory = new Map(
    categories.map((category) => [
      category.id,
      new Map(
        category.sizes.map((size) => [
          normalizeSizeNameForCompare(size.name),
          size.id,
        ]),
      ),
    ]),
  );

  const fileChecksum = hashBufferSha256(files.file.content);
  const workbook = await readWorkbookFromBuffer(files.file.content);
  const meta = parseMetaSheet(workbook);
  const templateUnitId = parseInteger(meta.get("unitId"), "template.unitId");
  const templateYear = parseInteger(meta.get("year"), "template.year");
  if (!templateUnitId || templateUnitId !== actorUnitId) {
    throw new AppError({
      message: "Template unit does not match your admin scope",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "TEMPLATE_UNIT_SCOPE_FORBIDDEN",
    });
  }
  if (!templateYear || templateYear !== selectedYear) {
    throw new AppError({
      message: "Template year does not match selected import year",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "TEMPLATE_YEAR_MISMATCH",
    });
  }
  const firstSheet = workbook.worksheets?.[0];
  const firstSheetName = firstSheet?.name;

  if (!firstSheetName) {
    throw new AppError({
      message: "XLSX file has no worksheet",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "XLSX_EMPTY",
    });
  }
  if (firstSheetName !== SIZE_REGISTRATION_SHEET_NAME) {
    throw new AppError({
      message: `Invalid template layout. First sheet must be ${SIZE_REGISTRATION_SHEET_NAME}`,
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "XLSX_INVALID_TEMPLATE_LAYOUT",
    });
  }

  const rows = worksheetToRowArrays(firstSheet);

  if (!Array.isArray(rows) || rows.length < 2) {
    throw new AppError({
      message: "XLSX file must include header and at least one data row",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "XLSX_EMPTY",
    });
  }
  if (rows.length - 1 > MAX_IMPORT_ROWS) {
    throw new AppError({
      message: `Import file exceeds limit (${MAX_IMPORT_ROWS} rows)`,
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "XLSX_IMPORT_ROW_LIMIT_EXCEEDED",
    });
  }

  const headers = rows[0].map((cell) => String(cell || "").trim());
  const frameStartRow = parseInteger(meta.get("frameStartRow"), "template.frameStartRow") || 2;
  const frameEndRow =
    parseInteger(meta.get("frameEndRow"), "template.frameEndRow") || rows.length;
  const frameStartCol = parseInteger(meta.get("frameStartCol"), "template.frameStartCol") || 1;
  const frameEndCol = parseInteger(meta.get("frameEndCol"), "template.frameEndCol") || headers.length;
  const expectedHeaderSignature = String(meta.get("headerSignature") || "").trim();
  if (
    frameStartRow <= 0 ||
    frameEndRow < frameStartRow ||
    frameStartCol <= 0 ||
    frameEndCol < frameStartCol
  ) {
    throw new AppError({
      message: "Template frame metadata is invalid",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "XLSX_TEMPLATE_FRAME_INVALID",
    });
  }
  if (!expectedHeaderSignature || parseHeaderSignature(headers) !== expectedHeaderSignature) {
    throw new AppError({
      message: "Template header was modified. Please re-download template.",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "XLSX_TEMPLATE_HEADER_TAMPERED",
    });
  }

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const excelRowNumber = rowIndex + 1;
    const hasAnyValue = row.some((cell) => String(cell || "").trim() !== "");
    if (!hasAnyValue) continue;

    if (excelRowNumber < frameStartRow || excelRowNumber > frameEndRow) {
      throw new AppError({
        message: `XLSX row ${excelRowNumber} is outside allowed template frame`,
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "XLSX_OUT_OF_FRAME_ROW",
      });
    }

    for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
      const excelColNumber = colIndex + 1;
      if (excelColNumber < frameStartCol || excelColNumber > frameEndCol) {
        const value = String(row[colIndex] || "").trim();
        if (value) {
          throw new AppError({
            message: `XLSX has data outside allowed columns at row ${excelRowNumber}`,
            statusCode: HTTP_CODES.BAD_REQUEST,
            errorCode: "XLSX_OUT_OF_FRAME_COLUMN",
          });
        }
      }
    }
  }

  const militaryCodeColumnIndex = headers.findIndex((header) => header === "militaryCode");

  if (militaryCodeColumnIndex < 0) {
    throw new AppError({
      message: "Missing required XLSX header: militaryCode",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "XLSX_INVALID_HEADER",
    });
  }

  const categoryColumns = [];
  const seenCategoryIds = new Set();

  headers.forEach((header, index) => {
    const categoryId = parseCategoryIdFromTemplateHeader(header);
    if (!categoryId) return;

    if (!categoryMap.has(categoryId)) {
      throw new AppError({
        message: `Template has unknown category column: ${header}`,
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "XLSX_UNKNOWN_CATEGORY",
      });
    }

    if (seenCategoryIds.has(categoryId)) {
      throw new AppError({
        message: `Template has duplicated category column: ${header}`,
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "XLSX_DUPLICATE_CATEGORY_COLUMN",
      });
    }

    seenCategoryIds.add(categoryId);
    categoryColumns.push({
      categoryId,
      index,
    });
  });

  if (!categoryColumns.length) {
    throw new AppError({
      message: "Template has no category columns (CAT_<id>)",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "XLSX_INVALID_HEADER",
    });
  }

  const importCategoryColumns =
    requestedCategoryIds.length > 0
      ? categoryColumns.filter((column) => requestedCategoryIdSet.has(column.categoryId))
      : categoryColumns;

  if (requestedCategoryIds.length > 0 && !importCategoryColumns.length) {
    throw new AppError({
      message: "Selected categories are not present in import template",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "CATEGORY_NOT_IN_TEMPLATE",
    });
  }

  if (requestedCategoryIds.length > 0) {
    const foundSet = new Set(importCategoryColumns.map((column) => column.categoryId));
    const missing = requestedCategoryIds.filter((id) => !foundSet.has(id));
    if (missing.length > 0) {
      throw new AppError({
        message: `Some selected categories are not in template: ${missing.join(", ")}`,
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "CATEGORY_NOT_IN_TEMPLATE",
      });
    }
  }

  const parsedRows = [];
  for (let rowIndex = frameStartRow - 1; rowIndex <= frameEndRow - 1; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const militaryCode = String(row[militaryCodeColumnIndex] || "").trim();
    const hasAnyValue = row.some((cell) => String(cell || "").trim() !== "");

    if (!militaryCode && !hasAnyValue) {
      continue;
    }

    if (!militaryCode) {
      throw new AppError({
        message: `XLSX row ${rowIndex + 1} is missing militaryCode`,
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "XLSX_INVALID_ROW",
      });
    }

    const registrations = [];

    for (const column of importCategoryColumns) {
      const rawSizeName = String(row[column.index] || "").trim();
      if (!rawSizeName) continue;

      const sizeLookup = sizeLookupByCategory.get(column.categoryId);
      const sizeId = sizeLookup?.get(normalizeSizeNameForCompare(rawSizeName));

      if (!sizeId) {
        throw new AppError({
          message: `XLSX row ${rowIndex + 1} has invalid size "${rawSizeName}" for category CAT_${column.categoryId}`,
          statusCode: HTTP_CODES.BAD_REQUEST,
          errorCode: "XLSX_INVALID_SIZE_SELECTION",
        });
      }

      registrations.push({
        categoryId: column.categoryId,
        sizeId,
      });
    }

    parsedRows.push({
      militaryCode,
      registrations,
    });
  }

  if (!parsedRows.length) {
    throw new AppError({
      message: "No valid data rows found in import file",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "XLSX_EMPTY_DATA",
    });
  }

  const codes = parsedRows.map((row) => row.militaryCode);
  const uniqueCodes = new Set(codes);
  if (uniqueCodes.size !== codes.length) {
    throw new AppError({
      message: "Duplicate militaryCode found in import file",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "DUPLICATE_MILITARY_CODE_IN_FILE",
    });
  }

  const militaries = await prisma.military.findMany({
    where: {
      militaryCode: {
        in: [...uniqueCodes],
      },
      unitId: actorUnitId,
      deletedAt: null,
    },
    select: {
      id: true,
      militaryCode: true,
    },
  });
  const militaryByCode = new Map(militaries.map((military) => [military.militaryCode, military]));

  const militaryIds = parsedRows
    .map((row) => militaryByCode.get(row.militaryCode)?.id)
    .filter(Boolean);
  const uniqueMilitaryIds = [...new Set(militaryIds)];

  const missingCodes = [...uniqueCodes].filter((code) => !militaryByCode.has(code));
  if (missingCodes.length > 0) {
    throw new AppError({
      message: `Military not found in your unit: ${missingCodes.slice(0, 10).join(", ")}`,
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "MILITARY_NOT_FOUND_IN_UNIT",
      metadata: {
        missingCodes,
      },
    });
  }

  const activeAssignments = uniqueMilitaryIds.length
    ? await prisma.militaryUnit.findMany({
        where: {
          militaryId: {
            in: uniqueMilitaryIds,
          },
          unitId: actorUnitId,
          transferInYear: {
            lte: selectedYear,
          },
          OR: [{ transferOutYear: null }, { transferOutYear: { gt: selectedYear } }],
        },
        select: {
          militaryId: true,
        },
      })
    : [];
  const activeAssignmentIds = new Set(activeAssignments.map((item) => item.militaryId));

  const pendingTransfers = uniqueMilitaryIds.length
    ? await prisma.militaryTransferRequest.findMany({
        where: {
          militaryId: {
            in: uniqueMilitaryIds,
          },
          fromUnitId: actorUnitId,
          status: "PENDING",
          transferYear: {
            lte: selectedYear,
          },
        },
        select: {
          militaryId: true,
        },
      })
    : [];
  const pendingTransferIds = new Set(pendingTransfers.map((item) => item.militaryId));

  const pendingTransferCodes = [];
  const transferredOutCodes = [];
  for (const row of parsedRows) {
    const military = militaryByCode.get(row.militaryCode);
    if (!military) continue;
    if (pendingTransferIds.has(military.id)) {
      pendingTransferCodes.push(row.militaryCode);
      continue;
    }
    if (!activeAssignmentIds.has(military.id)) {
      transferredOutCodes.push(row.militaryCode);
    }
  }

  const excludedCodes = new Set([...pendingTransferCodes, ...transferredOutCodes]);
  const eligibleParsedRows = excludedCodes.size
    ? parsedRows.filter((row) => !excludedCodes.has(row.militaryCode))
    : parsedRows;
  const rowsWithoutSelections = eligibleParsedRows.filter(
    (row) => row.registrations.length === 0,
  ).length;
  const totalRegistrationAssignments = eligibleParsedRows.reduce(
    (total, row) => total + row.registrations.length,
    0,
  );
  if (eligibleParsedRows.length === 0 || totalRegistrationAssignments <= 0) {
    throw new AppError({
      message: "Import file has no valid size assignments",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "XLSX_NO_ASSIGNMENTS",
    });
  }
  const importedCategoryIds =
    requestedCategoryIds.length > 0
      ? requestedCategoryIds
      : [...new Set(importCategoryColumns.map((column) => column.categoryId))];
  const importCategories = importedCategoryIds.map((categoryId) => {
    const category = categoryMap.get(categoryId);
    return {
      id: categoryId,
      name: category?.name || `CAT_${categoryId}`,
      sizeCount: category?.sizes?.length || 0,
    };
  });

  const period = await upsertPeriodForYear({
    year: selectedYear,
    unitId: actorUnitId,
    actorId: actor?.id,
  });
  const eligibleMilitaryIds = eligibleParsedRows
    .map((row) => militaryByCode.get(row.militaryCode)?.id)
    .filter(Boolean);
  const uniqueEligibleMilitaryIds = [...new Set(eligibleMilitaryIds)];
  const existingRowsToReplace = uniqueEligibleMilitaryIds.length
    ? await prisma.militaryCategorySizeYearly.count({
        where: {
          year: selectedYear,
          militaryId: {
            in: uniqueEligibleMilitaryIds,
          },
          ...(keepExisting
            ? {
                categoryId: {
                  in: importedCategoryIds,
                },
              }
            : {}),
          deletedAt: null,
        },
      })
    : 0;

  return {
    actorUnitId,
    selectedYear,
    periodId: period.id,
    keepExisting,
    parsedRows: eligibleParsedRows,
    militaryByCode,
    importedCategoryIds,
    importCategories,
    rowsWithoutSelections,
    totalRegistrationAssignments,
    totalTemplateRows: rows.length - 1,
    existingRowsToReplace,
    fileChecksum,
    approvalToken,
    excludedCodes: {
      pendingTransferCodes,
      transferredOutCodes,
    },
  };
}

export async function previewSizeRegistrationsImportByTemplate({ actor, req }) {
  const payload = await prepareSizeRegistrationsImportPayload({ actor, req });

  const {
    actorUnitId,
    selectedYear,
    keepExisting,
    parsedRows,
    importedCategoryIds,
    importCategories,
    rowsWithoutSelections,
    totalRegistrationAssignments,
    totalTemplateRows,
    existingRowsToReplace,
    fileChecksum,
    excludedCodes,
  } = payload;
  const approvalFingerprint = buildImportFingerprint({
    actorUnitId,
    selectedYear,
    keepExisting,
    importedCategoryIds,
    parsedRows,
    rowsWithoutSelections,
    totalRegistrationAssignments,
    existingRowsToReplace,
    fileChecksum,
  });
  const approvalExpiresAt = Date.now() + IMPORT_APPROVAL_TTL_MS;
  const approvalToken = signImportApprovalToken({
    fp: approvalFingerprint,
    exp: approvalExpiresAt,
  });

  const warnings = [];
  if (!keepExisting) {
    warnings.push(
      "Import này sẽ ghi đè toàn bộ cỡ số hiện có của các quân nhân nằm trong file.",
    );
  }
  if (keepExisting) {
    warnings.push(
      "Chỉ các danh mục đã chọn mới bị thay thế; các danh mục khác sẽ giữ nguyên cỡ số hiện tại.",
    );
  }
  if (rowsWithoutSelections > 0) {
    warnings.push(
      `${rowsWithoutSelections} quân nhân không có chọn cỡ số trong vùng import, dữ liệu ở phạm vi thay thế có thể bị xóa.`,
    );
  }
  if (excludedCodes?.pendingTransferCodes?.length > 0) {
    warnings.push(
      `${excludedCodes.pendingTransferCodes.length} quân nhân đang chờ chuyển đơn vị đã bị loại khỏi danh sách import.`,
    );
  }
  if (excludedCodes?.transferredOutCodes?.length > 0) {
    warnings.push(
      `${excludedCodes.transferredOutCodes.length} quân nhân đã chuyển khỏi đơn vị trong năm này đã bị loại khỏi danh sách import.`,
    );
  }

  return {
    unitId: actorUnitId,
    year: selectedYear,
    keepExisting,
    summary: {
      totalTemplateRows,
      validRows: parsedRows.length,
      affectedMilitaries: parsedRows.length,
      categoryCount: importCategories.length,
      totalRegistrationAssignments,
      existingRowsToReplace,
      rowsWithoutSelections,
    },
    categories: importCategories,
    warnings,
    excludedCodes,
    approval: {
      token: approvalToken,
      expiresAt: new Date(approvalExpiresAt).toISOString(),
    },
    sampleRows: parsedRows.slice(0, 20).map((row) => ({
      militaryCode: row.militaryCode,
      selectedCount: row.registrations.length,
    })),
  };
}

export async function importSizeRegistrationsByTemplate({ actor, req }) {
  const payload = await prepareSizeRegistrationsImportPayload({ actor, req });

  const {
    actorUnitId,
    selectedYear,
    periodId,
    keepExisting,
    parsedRows,
    militaryByCode,
    importedCategoryIds,
    rowsWithoutSelections,
    totalRegistrationAssignments,
    existingRowsToReplace,
    fileChecksum,
    approvalToken,
  } = payload;
  if (!approvalToken) {
    throw new AppError({
      message: "Missing import approval token. Please run preview before import.",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "IMPORT_APPROVAL_REQUIRED",
    });
  }
  const tokenPayload = verifyImportApprovalToken(approvalToken);
  if (!tokenPayload?.fp || !tokenPayload?.exp) {
    throw new AppError({
      message: "Invalid import approval token. Please run preview again.",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "IMPORT_APPROVAL_INVALID",
    });
  }
  if (Date.now() > Number(tokenPayload.exp)) {
    throw new AppError({
      message: "Import approval token expired. Please run preview again.",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "IMPORT_APPROVAL_EXPIRED",
    });
  }
  const expectedFingerprint = buildImportFingerprint({
    actorUnitId,
    selectedYear,
    keepExisting,
    importedCategoryIds,
    parsedRows,
    rowsWithoutSelections,
    totalRegistrationAssignments,
    existingRowsToReplace,
    fileChecksum,
  });
  if (tokenPayload.fp !== expectedFingerprint) {
    throw new AppError({
      message: "Import file/setting changed after preview. Please preview again.",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "IMPORT_APPROVAL_MISMATCH",
    });
  }

  const categoryIdsToReplace = importedCategoryIds;

  await prisma.$transaction(async (tx) => {
    for (const row of parsedRows) {
      const military = militaryByCode.get(row.militaryCode);

      if (keepExisting) {
        if (categoryIdsToReplace.length > 0) {
          await tx.militaryCategorySizeYearly.deleteMany({
            where: {
              year: selectedYear,
              militaryId: military.id,
              categoryId: {
                in: categoryIdsToReplace,
              },
            },
          });
        }
      } else {
        await tx.militaryCategorySizeYearly.deleteMany({
          where: {
            year: selectedYear,
            militaryId: military.id,
          },
        });
      }

      if (row.registrations.length > 0) {
        await tx.militaryCategorySizeYearly.createMany({
          data: row.registrations.map((registration) => ({
            periodId,
            year: selectedYear,
            militaryId: military.id,
            categoryId: registration.categoryId,
            sizeId: registration.sizeId,
            source: "IMPORT",
          })),
          skipDuplicates: true,
        });
      }
    }
  });

  return {
    year: selectedYear,
    importedRows: parsedRows.length,
    updatedMilitaries: parsedRows.length,
    keepExisting,
    importedCategoryIds,
    unitId: actorUnitId,
  };
}
