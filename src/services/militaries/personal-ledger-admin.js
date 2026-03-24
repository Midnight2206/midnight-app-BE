import crypto from "crypto";
import path from "path";
import { randomUUID } from "crypto";

import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import { buildMilitarySearchNormalized } from "#utils/searchNormalizer.js";
import {
  appendWorksheetFromRows,
  createWorkbook,
  readWorkbookFromBuffer,
  worksheetToRowArrays,
  writeWorkbookToBuffer,
} from "#services/spreadsheet/excel.util.js";
import {
  assertAdminAccess,
  parseInteger,
  parseMultipartFormData,
  resolveScopeUnitId,
} from "#services/militaries/common.js";
import {
  getMilitaryRankLabel,
  normalizeMilitaryRankCode,
  resolveMilitaryGenderCatalogRecord,
  resolveMilitaryRankGroupFromCode,
} from "#services/militaries/profile-reference.js";

const MODE_BASELINE_SHEET_NAME = "NienHanCheDo";
const MODE_BASELINE_META_SHEET_NAME = "HeThongMeta";
const MODE_BASELINE_TEMPLATE_TYPE = "ALLOCATION_MODE_BASELINE";
const MODE_BASELINE_TEMPLATE_VERSION = "1";
const MAX_IMPORT_ROWS = 20000;

function parseHeaderSignature(headers) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(headers.map((item) => String(item || "").trim())))
    .digest("hex");
}

function getTemplateFileName(unitId) {
  const date = new Date().toISOString().slice(0, 10);
  return `allocation-mode-baseline-template-unit-${unitId}-${date}.xlsx`;
}

function parseLatestIssuedYear(value, fieldName = "latestIssuedYear") {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 3000) {
    throw new AppError({
      message: `${fieldName} không hợp lệ`,
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "INVALID_YEAR",
    });
  }
  return parsed;
}

function parseMetaSheet(workbook) {
  const metaSheet = workbook.getWorksheet(MODE_BASELINE_META_SHEET_NAME);
  if (!metaSheet) {
    throw new AppError({
      message: "Thiếu sheet metadata của template import",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "XLSX_TEMPLATE_META_MISSING",
    });
  }

  const rows = worksheetToRowArrays(metaSheet);
  const kv = new Map();
  for (let index = 1; index < rows.length; index += 1) {
    const key = String(rows[index]?.[0] || "").trim();
    const value = String(rows[index]?.[1] || "").trim();
    if (!key) continue;
    kv.set(key, value);
  }

  if (
    kv.get("templateType") !== MODE_BASELINE_TEMPLATE_TYPE ||
    kv.get("templateVersion") !== MODE_BASELINE_TEMPLATE_VERSION
  ) {
    throw new AppError({
      message: "Template import không đúng định dạng hệ thống hỗ trợ",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "XLSX_TEMPLATE_META_INVALID",
    });
  }

  return kv;
}

async function getScopedEditableMilitary({ tx = prisma, actor, militaryId }) {
  assertAdminAccess(actor);
  const isSuperAdmin = Array.isArray(actor?.roles) && actor.roles.includes("SUPER_ADMIN");
  const actorUnitId = resolveScopeUnitId(actor);

  const military = await tx.military.findFirst({
    where: {
      id: String(militaryId),
      deletedAt: null,
    },
    include: {
      unit: {
        select: { id: true, name: true },
      },
      genderCatalog: {
        select: { id: true, code: true, name: true },
      },
      assignedUnitCatalog: {
        select: { id: true, unitId: true, name: true },
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
      message: "Quân nhân không tồn tại",
      statusCode: HTTP_CODES.NOT_FOUND,
      errorCode: "MILITARY_NOT_FOUND",
    });
  }

  if (!isSuperAdmin && Number(military.unitId) !== Number(actorUnitId)) {
    throw new AppError({
      message: "ADMIN chỉ được sửa quân nhân thuộc đơn vị mình",
      statusCode: HTTP_CODES.FORBIDDEN,
      errorCode: "MILITARY_SCOPE_FORBIDDEN",
    });
  }

  return military;
}

function mapEditableMilitary(military) {
  return {
    id: military.id,
    fullname: military.fullname,
    militaryCode: military.militaryCode,
    rank: military.rank,
    rankLabel: getMilitaryRankLabel(military.rank),
    rankGroup: military.rankGroup,
    position: military.position,
    gender: military.genderCatalog?.code || military.gender,
    assignedUnitId: military.assignedUnitId || null,
    assignedUnit: military.assignedUnit || null,
    initialCommissioningYear: military.initialCommissioningYear,
    unit: military.unit
      ? {
          id: military.unit.id,
          name: military.unit.name,
        }
      : null,
    types: (military.typeAssignments || []).map((entry) => ({
      id: entry.type.id,
      code: entry.type.code,
      name: entry.type.name || null,
    })),
  };
}

async function buildModeBaselineCandidates({ tx = prisma, unitId }) {
  const [militaries, modes, baselines] = await Promise.all([
    tx.military.findMany({
      where: {
        unitId: Number(unitId),
        deletedAt: null,
      },
      select: {
        id: true,
        militaryCode: true,
        fullname: true,
        typeAssignments: {
          where: {
            type: {
              deletedAt: null,
            },
          },
          orderBy: [{ typeId: "asc" }],
          select: {
            typeId: true,
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
      orderBy: [{ fullname: "asc" }, { militaryCode: "asc" }],
    }),
    tx.allocationMode.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [
          {
            scope: "SYSTEM",
          },
          {
            scope: "UNIT",
            unitId: Number(unitId),
          },
        ],
      },
      select: {
        id: true,
        militaryTypes: {
          select: {
            typeId: true,
            type: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
        },
        categories: {
          where: {
            deletedAt: null,
            isActive: true,
          },
          select: {
            categoryId: true,
            category: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
        },
      },
    }),
    tx.allocationModeMilitaryCategoryBaseline.findMany({
      where: {
        unitId: Number(unitId),
      },
      select: {
        militaryId: true,
        categoryId: true,
        typeId: true,
        latestIssuedYear: true,
      },
    }),
  ]);

  const categoryPairsByTypeId = new Map();
  (modes || []).forEach((mode) => {
    (mode.militaryTypes || []).forEach((modeType) => {
      const typeId = Number(modeType.typeId || modeType.type?.id || 0);
      if (!typeId) return;
      if (!categoryPairsByTypeId.has(typeId)) {
        categoryPairsByTypeId.set(typeId, new Map());
      }
      const categoryMap = categoryPairsByTypeId.get(typeId);
      (mode.categories || []).forEach((modeCategory) => {
        const categoryId = Number(modeCategory.categoryId || modeCategory.category?.id || 0);
        if (!categoryId) return;
        categoryMap.set(categoryId, {
          id: categoryId,
          code: modeCategory.category?.code || null,
          name: modeCategory.category?.name || `CAT_${categoryId}`,
        });
      });
    });
  });

  const baselineYearByKey = new Map(
    baselines.map((row) => [
      `${row.militaryId}:${Number(row.typeId)}:${Number(row.categoryId)}`,
      Number(row.latestIssuedYear),
    ]),
  );

  const rows = [];
  const tupleKeySet = new Set();

  (militaries || []).forEach((military) => {
    (military.typeAssignments || []).forEach((assignment) => {
      const typeId = Number(assignment.typeId || assignment.type?.id || 0);
      if (!typeId) return;
      const categoriesForType = categoryPairsByTypeId.get(typeId);
      if (!categoriesForType?.size) return;

      [...categoriesForType.values()]
        .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "vi"))
        .forEach((category) => {
          const tupleKey = `${military.id}:${typeId}:${category.id}`;
          tupleKeySet.add(tupleKey);
          rows.push({
            tupleKey,
            militaryId: military.id,
            militaryCode: military.militaryCode,
            fullname: military.fullname,
            typeId,
            typeCode: assignment.type?.code || null,
            typeName: assignment.type?.name || null,
            categoryId: Number(category.id),
            categoryCode: category.code || null,
            categoryName: category.name || null,
            importedLatestIssuedYear:
              baselineYearByKey.get(tupleKey) ?? null,
          });
        });
    });
  });

  return {
    rows,
    tupleKeySet,
  };
}

export async function updateMilitaryFromPersonalLedger({ actor, militaryId, body }) {
  const payload = body || {};

  return prisma.$transaction(async (tx) => {
    const military = await getScopedEditableMilitary({
      tx,
      actor,
      militaryId,
    });

    const nextRank = payload.rank !== undefined
      ? normalizeMilitaryRankCode(payload.rank, {
          required: true,
          fieldName: "rank",
        })
      : military.rank;
    const nextGenderRecord = payload.gender !== undefined
      ? await resolveMilitaryGenderCatalogRecord({
          tx,
          value: payload.gender,
          required: true,
          fieldName: "gender",
        })
      : military.genderCatalog;
    let nextAssignedUnitId = military.assignedUnitId || null;
    let nextAssignedUnitName = military.assignedUnit || null;

    if (payload.assignedUnitId !== undefined) {
      if (payload.assignedUnitId === null) {
        nextAssignedUnitId = null;
        nextAssignedUnitName = null;
      } else {
        const assignedUnit = await tx.militaryAssignedUnit.findFirst({
          where: {
            id: Number(payload.assignedUnitId),
            unitId: Number(military.unitId),
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
          },
        });

        if (!assignedUnit) {
          throw new AppError({
            message: "Đơn vị quản lý không tồn tại trong đơn vị hiện tại",
            statusCode: HTTP_CODES.BAD_REQUEST,
            errorCode: "ASSIGNED_UNIT_NOT_FOUND",
          });
        }

        nextAssignedUnitId = assignedUnit.id;
        nextAssignedUnitName = assignedUnit.name;
      }
    }

    const nextTypeRows = (military.typeAssignments || []).map((entry) => entry.type);

    const updated = await tx.military.update({
      where: {
        id: military.id,
      },
      data: {
        ...(payload.fullname !== undefined ? { fullname: String(payload.fullname).trim() } : {}),
        ...(payload.militaryCode !== undefined
          ? { militaryCode: String(payload.militaryCode).trim() }
          : {}),
        ...(payload.position !== undefined ? { position: String(payload.position).trim() } : {}),
        ...(payload.initialCommissioningYear !== undefined
          ? {
              initialCommissioningYear: Number(payload.initialCommissioningYear),
            }
          : {}),
        rank: nextRank,
        rankGroup: resolveMilitaryRankGroupFromCode(nextRank),
        gender: nextGenderRecord?.code || military.gender,
        genderId: nextGenderRecord?.id || military.genderId,
        assignedUnitId: nextAssignedUnitId,
        assignedUnit: nextAssignedUnitName,
        searchNormalized: buildMilitarySearchNormalized({
          fullname:
            payload.fullname !== undefined ? String(payload.fullname).trim() : military.fullname,
          militaryCode:
            payload.militaryCode !== undefined
              ? String(payload.militaryCode).trim()
              : military.militaryCode,
          rank: `${nextRank} ${getMilitaryRankLabel(nextRank)}`,
          position:
            payload.position !== undefined ? String(payload.position).trim() : military.position,
          gender: nextGenderRecord?.code || military.gender,
          type: nextTypeRows.map((item) => item.code).filter(Boolean).join(" "),
          assignedUnit: nextAssignedUnitName,
          unitName: military.unit?.name,
        }),
      },
      include: {
        unit: {
          select: { id: true, name: true },
        },
        genderCatalog: {
          select: { id: true, code: true, name: true },
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

    return {
      military: mapEditableMilitary(updated),
    };
  });
}

export async function getAllocationModeBaselineTemplate({ actor, unitId }) {
  const scopeUnitId = resolveScopeUnitId(actor, unitId);
  const { rows } = await buildModeBaselineCandidates({
    unitId: scopeUnitId,
  });

  const headerRow = [
    "militaryCode",
    "fullname",
    "typeCode",
    "typeName",
    "categoryId",
    "categoryCode",
    "categoryName",
    "importedLatestIssuedYear",
  ];
  const workbook = await createWorkbook();
  appendWorksheetFromRows(workbook, {
    name: MODE_BASELINE_SHEET_NAME,
    rows: [
      headerRow,
      ...rows.map((row) => [
        row.militaryCode,
        row.fullname,
        row.typeCode || "",
        row.typeName || "",
        row.categoryId,
        row.categoryCode || "",
        row.categoryName || "",
        row.importedLatestIssuedYear ?? "",
      ]),
    ],
    widths: [18, 28, 18, 24, 12, 18, 28, 20],
  });
  appendWorksheetFromRows(workbook, {
    name: MODE_BASELINE_META_SHEET_NAME,
    rows: [
      ["key", "value"],
      ["templateType", MODE_BASELINE_TEMPLATE_TYPE],
      ["templateVersion", MODE_BASELINE_TEMPLATE_VERSION],
      ["unitId", String(scopeUnitId)],
      ["generatedAt", new Date().toISOString()],
      ["headerSignature", parseHeaderSignature(headerRow)],
      ["notes", "Để trống importedLatestIssuedYear nếu muốn xóa mốc import hiện tại"],
    ],
    state: "hidden",
  });

  return {
    fileName: getTemplateFileName(scopeUnitId),
    buffer: await writeWorkbookToBuffer(workbook),
  };
}

export async function importAllocationModeBaselineTemplate({ actor, req }) {
  assertAdminAccess(actor);
  const { files } = await parseMultipartFormData(req);

  if (!files.file) {
    throw new AppError({
      message: "File import là bắt buộc",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "FILE_REQUIRED",
    });
  }

  const fileName = files.file.filename || "allocation-mode-baseline-import.xlsx";
  if (path.extname(fileName).toLowerCase() !== ".xlsx") {
    throw new AppError({
      message: "Chỉ hỗ trợ file .xlsx",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "UNSUPPORTED_IMPORT_FILE",
    });
  }

  const workbook = await readWorkbookFromBuffer(files.file.content);
  const meta = parseMetaSheet(workbook);
  const scopeUnitId = resolveScopeUnitId(actor, meta.get("unitId"));
  const sheet = workbook.getWorksheet(MODE_BASELINE_SHEET_NAME) || workbook.worksheets?.[0];

  if (!sheet || sheet.name !== MODE_BASELINE_SHEET_NAME) {
    throw new AppError({
      message: `Sheet đầu tiên phải là ${MODE_BASELINE_SHEET_NAME}`,
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "XLSX_INVALID_TEMPLATE_LAYOUT",
    });
  }

  const rows = worksheetToRowArrays(sheet, { blankrows: false });
  if (rows.length < 1) {
    throw new AppError({
      message: "Template import không có dữ liệu",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "XLSX_EMPTY",
    });
  }

  const headerRow = rows[0].map((item) => String(item || "").trim());
  if (parseHeaderSignature(headerRow) !== String(meta.get("headerSignature") || "").trim()) {
    throw new AppError({
      message: "Header của template import không khớp với mẫu hệ thống",
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "XLSX_TEMPLATE_HEADER_MISMATCH",
    });
  }

  if (rows.length - 1 > MAX_IMPORT_ROWS) {
    throw new AppError({
      message: `File import vượt quá giới hạn ${MAX_IMPORT_ROWS} dòng`,
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "XLSX_IMPORT_ROW_LIMIT_EXCEEDED",
    });
  }

  const { rows: candidateRows, tupleKeySet } = await buildModeBaselineCandidates({
    unitId: scopeUnitId,
  });
  const candidateByTupleKey = new Map(candidateRows.map((row) => [row.tupleKey, row]));
  const militaries = await prisma.military.findMany({
    where: {
      unitId: scopeUnitId,
      deletedAt: null,
    },
    select: {
      id: true,
      militaryCode: true,
      typeAssignments: {
        select: {
          typeId: true,
        },
      },
    },
  });
  const militariesByCode = new Map(
    militaries.map((military) => [String(military.militaryCode).trim().toUpperCase(), military]),
  );
  const militaryTypes = await prisma.militaryTypeCatalog.findMany({
    where: {
      deletedAt: null,
    },
    select: {
      id: true,
      code: true,
      name: true,
    },
  });
  const typeByCode = new Map(
    militaryTypes.map((type) => [String(type.code).trim().toUpperCase(), type]),
  );

  const parsedRows = [];
  const rowErrors = [];
  const duplicateKeys = new Set();

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const militaryCode = String(row[0] || "").trim();
    const typeCode = String(row[2] || "").trim();
    const rawCategoryId = String(row[4] || "").trim();
    const categoryId = rawCategoryId ? Number.parseInt(rawCategoryId, 10) : null;
    const latestIssuedYear = parseLatestIssuedYear(
      row[7],
      `row ${index + 1}.importedLatestIssuedYear`,
    );

    const isBlankRow = !militaryCode && !typeCode && !String(row[4] || "").trim() && row[7] === "";
    if (isBlankRow) continue;

    if (!Number.isInteger(categoryId) || Number(categoryId) <= 0) {
      rowErrors.push(`Dòng ${index + 1}: categoryId không hợp lệ.`);
      continue;
    }

    const military = militariesByCode.get(militaryCode.toUpperCase());
    if (!military) {
      rowErrors.push(`Dòng ${index + 1}: không tìm thấy quân nhân ${militaryCode} trong đơn vị.`);
      continue;
    }

    const type = typeByCode.get(typeCode.toUpperCase());
    if (!type) {
      rowErrors.push(`Dòng ${index + 1}: loại quân nhân ${typeCode} không tồn tại.`);
      continue;
    }

    const hasAssignedType = (military.typeAssignments || []).some(
      (entry) => Number(entry.typeId) === Number(type.id),
    );
    if (!hasAssignedType) {
      rowErrors.push(
        `Dòng ${index + 1}: quân nhân ${militaryCode} hiện không thuộc loại ${typeCode}.`,
      );
      continue;
    }

    const tupleKey = `${military.id}:${Number(type.id)}:${Number(categoryId)}`;
    if (!tupleKeySet.has(tupleKey)) {
      rowErrors.push(
        `Dòng ${index + 1}: tổ hợp quân nhân/type/quân trang không nằm trong phạm vi chế độ cấp phát đang áp dụng.`,
      );
      continue;
    }

    if (duplicateKeys.has(tupleKey)) {
      rowErrors.push(
        `Dòng ${index + 1}: bị trùng với một dòng import trước đó cho cùng quân nhân/type/quân trang.`,
      );
      continue;
    }

    duplicateKeys.add(tupleKey);
    parsedRows.push({
      tupleKey,
      militaryId: military.id,
      typeId: Number(type.id),
      categoryId: Number(categoryId),
      latestIssuedYear,
    });
  }

  if (rowErrors.length) {
    throw new AppError({
      message: rowErrors.slice(0, 20).join(" "),
      statusCode: HTTP_CODES.BAD_REQUEST,
      errorCode: "ALLOCATION_MODE_BASELINE_IMPORT_INVALID",
    });
  }

  if (!parsedRows.length) {
    return {
      unitId: scopeUnitId,
      processedRows: 0,
      createdRows: 0,
      updatedRows: 0,
      clearedRows: 0,
    };
  }

  const existingBaselines = await prisma.allocationModeMilitaryCategoryBaseline.findMany({
    where: {
      unitId: scopeUnitId,
      OR: parsedRows.map((row) => ({
        militaryId: row.militaryId,
        typeId: row.typeId,
        categoryId: row.categoryId,
      })),
    },
    select: {
      militaryId: true,
      typeId: true,
      categoryId: true,
      latestIssuedYear: true,
    },
  });
  const existingByTupleKey = new Map(
    existingBaselines.map((row) => [
      `${row.militaryId}:${Number(row.typeId)}:${Number(row.categoryId)}`,
      Number(row.latestIssuedYear),
    ]),
  );

  let createdRows = 0;
  let updatedRows = 0;
  let clearedRows = 0;

  await prisma.$transaction(async (tx) => {
    for (const row of parsedRows) {
      const existingYear = existingByTupleKey.get(row.tupleKey) ?? null;
      if (!candidateByTupleKey.has(row.tupleKey)) continue;

      if (row.latestIssuedYear === null) {
        if (existingYear !== null) {
          clearedRows += 1;
        }
        await tx.allocationModeMilitaryCategoryBaseline.deleteMany({
          where: {
            militaryId: row.militaryId,
            typeId: row.typeId,
            categoryId: row.categoryId,
          },
        });
        continue;
      }

      if (existingYear === null) {
        createdRows += 1;
      } else if (Number(existingYear) !== Number(row.latestIssuedYear)) {
        updatedRows += 1;
      }

      await tx.allocationModeMilitaryCategoryBaseline.upsert({
        where: {
          militaryId_categoryId_typeId: {
            militaryId: row.militaryId,
            categoryId: row.categoryId,
            typeId: row.typeId,
          },
        },
        create: {
          id: randomUUID(),
          unitId: scopeUnitId,
          militaryId: row.militaryId,
          typeId: row.typeId,
          categoryId: row.categoryId,
          latestIssuedYear: row.latestIssuedYear,
          importedById: actor.id || null,
        },
        update: {
          latestIssuedYear: row.latestIssuedYear,
          importedById: actor.id || null,
        },
      });
    }
  });

  return {
    unitId: scopeUnitId,
    processedRows: parsedRows.length,
    createdRows,
    updatedRows,
    clearedRows,
  };
}
