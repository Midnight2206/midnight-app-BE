import { normalizeMilitaryTypeCodesInput } from "#services/militaries/type-catalog.js";
import {
  appendWorksheetFromRows,
  createWorkbook,
  writeWorkbookToBuffer,
} from "#services/spreadsheet/excel.util.js";

export function getTemplateFileName() {
  return "military-import-template.xlsx";
}

function normalizeTemplateTypeCode(type) {
  const normalized = normalizeMilitaryTypeCodesInput(type, {
    required: false,
    fieldName: "type",
  });

  if (!normalized?.length) return null;
  return normalized[0];
}

export async function getTemplate({ type } = {}) {
  const templateTypeCode = normalizeTemplateTypeCode(type);

  const headers = [
    "fullname",
    "rank",
    "position",
    "gender",
    "type",
    "militaryCode",
    "initialCommissioningYear",
    "assignedUnit",
    "unitTransferInYear",
    "unitTransferOutYear",
  ];

  const sampleRows = [
    [
      "Nguyen Van A",
      "Đại úy",
      "Trung đội trưởng",
      "MALE",
      templateTypeCode || "SQ_QNCN",
      "QN0001",
      2018,
      "Đại đội 1",
      2024,
      "",
    ],
    [
      "Tran Thi B",
      "Thiếu tá",
      "Trợ lý quân nhu",
      "FEMALE",
      templateTypeCode || "PHI_CONG",
      "QN0002",
      2020,
      "Đại đội 2",
      2025,
      "",
    ],
    [
      "Le Van C",
      "Hạ sĩ",
      "Chiến sĩ",
      "MALE",
      templateTypeCode || "HSQ_CS",
      "QN0003",
      2023,
      "Trung đội 3",
      2023,
      "",
    ],
  ];

  const notes = [
    [],
    ["Ghi chú:"],
    [
      "- rank: THIEU_UY, TRUNG_UY, THUONG_UY, DAI_UY, THIEU_TA, TRUNG_TA, THUONG_TA, DAI_TA, THIEU_TUONG, TRUNG_TUONG, THUONG_TUONG, DAI_TUONG, BINH_NHI, BINH_NHAT, HA_SI, TRUNG_SI, THUONG_SI",
    ],
    ["- gender: MALE | FEMALE"],
    templateTypeCode
      ? [`- type: template này cố định cho danh sách ${templateTypeCode}`]
      : ["- type: mã danh sách quân nhân, ví dụ SQ_QNCN, PHI_CONG, CAN_BO_NV_DU, HSQ_CS"],
    ["- assignedUnit: bắt buộc, là tên assignedUnit thuộc đơn vị đang import; hệ thống sẽ tự map/tạo trong danh mục assignedUnit của đơn vị đó"],
    ["- unitTransferInYear để trống sẽ mặc định = initialCommissioningYear"],
    ["- unitTransferOutYear để trống nếu quân nhân đang còn trong đơn vị hiện tại"],
  ];

  const workbook = await createWorkbook();
  appendWorksheetFromRows(workbook, {
    name: "militaries",
    rows: [headers, ...sampleRows, ...notes],
    widths: headers.map((header) => Math.max(header.length + 2, 18)),
  });

  return writeWorkbookToBuffer(workbook);
}
