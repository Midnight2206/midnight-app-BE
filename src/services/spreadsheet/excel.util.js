import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";

function normalizeSheetValue(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value && value.text !== undefined) return String(value.text);
    if ("result" in value && value.result !== undefined) {
      return normalizeSheetValue(value.result);
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text || "").join("");
    }
    if ("hyperlink" in value && value.hyperlink) return String(value.text || "");
  }
  return String(value);
}

function parseCellRef(ref) {
  const match = String(ref || "").trim().match(/^([A-Z]+)(\d+)$/i);
  if (!match) {
    throw new Error(`Invalid cell reference: ${ref}`);
  }

  return {
    col: columnNameToNumber(match[1]),
    row: Number(match[2]),
  };
}

function parseSqref(sqref) {
  const [startRef, endRef = startRef] = String(sqref || "").split(":");
  const start = parseCellRef(startRef);
  const end = parseCellRef(endRef);

  return {
    startCol: Math.min(start.col, end.col),
    endCol: Math.max(start.col, end.col),
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
  };
}

export function columnNumberToName(columnNumber) {
  let dividend = Number(columnNumber);
  let columnName = "";

  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    columnName = String.fromCharCode(65 + modulo) + columnName;
    dividend = Math.floor((dividend - modulo) / 26);
  }

  return columnName;
}

export function columnNameToNumber(columnName) {
  return String(columnName || "")
    .trim()
    .toUpperCase()
    .split("")
    .reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
}

export async function loadExcelLibrary() {
  try {
    const module = await import("exceljs");
    return module.default || module;
  } catch {
    throw new AppError({
      message: "Excel parser is not installed. Run: npm install exceljs",
      statusCode: HTTP_CODES.INTERNAL_SERVER_ERROR,
      errorCode: "XLSX_PARSER_MISSING",
    });
  }
}

export async function createWorkbook() {
  const ExcelJS = await loadExcelLibrary();
  return new ExcelJS.Workbook();
}

export async function readWorkbookFromBuffer(buffer) {
  const workbook = await createWorkbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

export async function writeWorkbookToBuffer(workbook) {
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

export function worksheetToRowArrays(worksheet, { blankrows = true } = {}) {
  if (!worksheet) return [];

  const rows = [];
  const totalRows = worksheet.rowCount;
  const totalColumns = worksheet.actualColumnCount || worksheet.columnCount || 0;

  for (let rowNumber = 1; rowNumber <= totalRows; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const inferredColumns = Math.max(totalColumns, row.values.length - 1);
    const values = [];

    for (let colNumber = 1; colNumber <= inferredColumns; colNumber += 1) {
      const cell = row.getCell(colNumber);
      values.push(normalizeSheetValue(cell.value));
    }

    while (values.length > 0 && values[values.length - 1] === "") {
      values.pop();
    }

    if (!blankrows && values.length === 0) {
      continue;
    }

    rows.push(values);
  }

  return rows;
}

export function appendWorksheetFromRows(
  workbook,
  { name, rows = [], widths = [], state = "visible" },
) {
  const worksheet = workbook.addWorksheet(name);

  rows.forEach((row) => {
    worksheet.addRow(row);
  });

  widths.forEach((width, index) => {
    if (!width) return;
    worksheet.getColumn(index + 1).width = width;
  });

  worksheet.state = state;
  return worksheet;
}

export function applyListValidationRules(worksheet, rules = []) {
  rules
    .filter((rule) => rule?.sqref && rule?.formula1)
    .forEach((rule) => {
      const { startCol, endCol, startRow, endRow } = parseSqref(rule.sqref);

      for (let row = startRow; row <= endRow; row += 1) {
        for (let col = startCol; col <= endCol; col += 1) {
          worksheet.getCell(row, col).dataValidation = {
            type: "list",
            allowBlank: true,
            showErrorMessage: true,
            errorStyle: "stop",
            formulae: [rule.formula1],
          };
        }
      }
    });
}
