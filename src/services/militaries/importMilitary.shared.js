import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import {
  loadXlsxLibrary,
  normalizeMilitaryGender,
} from "#services/militaries/common.js";
import { normalizeMilitaryTypeCodesInput } from "#services/militaries/type-catalog.js";

const OPEN_ENDED_TRANSFER_YEAR = 9999;

export function hasYearRangeOverlap({ leftStart, leftEnd, rightStart, rightEnd }) {
  return leftStart < rightEnd && rightStart < leftEnd;
}

export function normalizeTransferEndYear(year) {
  return year ?? OPEN_ENDED_TRANSFER_YEAR;
}

function normalizeForcedTypeCode(forcedTypeCode) {
  const normalized = normalizeMilitaryTypeCodesInput(forcedTypeCode, {
    required: false,
    fieldName: "type",
  });

  if (!normalized?.length) return null;
  return normalized[0];
}

export async function parseXlsxRows(fileBuffer, { forcedTypeCode } = {}) {
  const XLSX = await loadXlsxLibrary();
  const normalizedForcedTypeCode = normalizeForcedTypeCode(forcedTypeCode);

  const workbook = XLSX.read(fileBuffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames?.[0];

  if (!firstSheetName) {
    throw new AppError({
      message: "XLSX file has no worksheet",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "XLSX_EMPTY",
    });
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  if (!Array.isArray(rows) || rows.length < 2) {
    throw new AppError({
      message: "XLSX file must include header and at least one data row",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "XLSX_EMPTY",
    });
  }

  const headers = rows[0].map((cell) => String(cell || "").trim());
  const headerMap = headers.reduce((acc, header, index) => {
    acc[header] = index;
    return acc;
  }, {});

  const requiredHeaders = [
    "fullname",
    "rank",
    "position",
    "gender",
    "militaryCode",
    "initialCommissioningYear",
  ];

  for (const header of requiredHeaders) {
    if (headerMap[header] === undefined) {
      throw new AppError({
        message: `Missing required XLSX header: ${header}`,
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "XLSX_INVALID_HEADER",
      });
    }
  }
  if (!normalizedForcedTypeCode && headerMap.types === undefined && headerMap.type === undefined) {
    throw new AppError({
      message: "Missing required XLSX header: types (or type)",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "XLSX_INVALID_HEADER",
    });
  }

  const parsedRows = [];

  for (let i = 1; i < rows.length; i += 1) {
    const rowValues = rows[i] || [];
    const rawTypesValue =
      headerMap.types !== undefined
        ? rowValues[headerMap.types]
        : headerMap.type !== undefined
          ? rowValues[headerMap.type]
          : "";

    const row = {
      fullname: String(rowValues[headerMap.fullname] || "").trim(),
      rank: String(rowValues[headerMap.rank] || "").trim(),
      position: String(rowValues[headerMap.position] || "").trim(),
      gender: normalizeMilitaryGender(rowValues[headerMap.gender], {
        required: true,
        fieldName: "gender",
      }),
      types: normalizedForcedTypeCode
        ? [normalizedForcedTypeCode]
        : normalizeMilitaryTypeCodesInput(rawTypesValue, {
            required: true,
            fieldName: "types",
          }),
      militaryCode: String(rowValues[headerMap.militaryCode] || "")
        .trim()
        .toUpperCase(),
      initialCommissioningYear: String(
        rowValues[headerMap.initialCommissioningYear] || "",
      ).trim(),
      assignedUnit:
        headerMap.assignedUnit !== undefined
          ? String(rowValues[headerMap.assignedUnit] || "").trim()
          : "",
      unitTransferInYear:
        headerMap.unitTransferInYear !== undefined
          ? String(rowValues[headerMap.unitTransferInYear] || "").trim()
          : "",
      unitTransferOutYear:
        headerMap.unitTransferOutYear !== undefined
          ? String(rowValues[headerMap.unitTransferOutYear] || "").trim()
          : "",
    };

    if (
      !row.fullname ||
      !row.rank ||
      !row.position ||
      !row.gender ||
      !Array.isArray(row.types) ||
      row.types.length === 0 ||
      !row.militaryCode
    ) {
      throw new AppError({
        message: `XLSX row ${i + 1} has empty required fields`,
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "XLSX_INVALID_ROW",
      });
    }

    const year = Number(row.initialCommissioningYear);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      throw new AppError({
        message: `XLSX row ${i + 1} has invalid initialCommissioningYear`,
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "XLSX_INVALID_YEAR",
      });
    }

    const transferInYearRaw = row.unitTransferInYear;
    const transferInYear = transferInYearRaw ? Number(transferInYearRaw) : year;

    if (!Number.isInteger(transferInYear) || transferInYear < 1900 || transferInYear > 2100) {
      throw new AppError({
        message: `XLSX row ${i + 1} has invalid unitTransferInYear`,
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "XLSX_INVALID_UNIT_TRANSFER_IN_YEAR",
      });
    }

    const transferOutYearRaw = row.unitTransferOutYear;
    const transferOutYear = transferOutYearRaw ? Number(transferOutYearRaw) : null;

    if (
      transferOutYear !== null &&
      (!Number.isInteger(transferOutYear) || transferOutYear < 1900 || transferOutYear > 2100)
    ) {
      throw new AppError({
        message: `XLSX row ${i + 1} has invalid unitTransferOutYear`,
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "XLSX_INVALID_UNIT_TRANSFER_OUT_YEAR",
      });
    }

    if (transferOutYear !== null && transferOutYear < transferInYear) {
      throw new AppError({
        message: `XLSX row ${i + 1} has unitTransferOutYear earlier than unitTransferInYear`,
        statusCode: HTTP_CODES.BAD_REQUEST,
        errorCode: "XLSX_INVALID_UNIT_TRANSFER_RANGE",
      });
    }

    parsedRows.push({
      rowNumber: i + 1,
      ...row,
      initialCommissioningYear: year,
      unitTransferInYear: transferInYear,
      unitTransferOutYear: transferOutYear,
    });
  }

  return parsedRows;
}
