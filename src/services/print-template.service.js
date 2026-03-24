import { prisma } from "#configs/prisma.config.js";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";

const PRINT_TEMPLATE_TYPES = {
  ALLOCATION_MODE_ISSUE_VOUCHER: "ALLOCATION_MODE_ISSUE_VOUCHER",
};

const SIGNATURE_SUBTITLE_MAX_CHARS_PER_LINE = 28;
const SIGNATURE_WIDTH_PERCENT_TOTAL = 100;
const SIGNATURE_WIDTH_PERCENT_MIN = 5;
const TEMPLATE_VERSION_HISTORY_LIMIT = 20;

const DEFAULT_ALLOCATION_MODE_ISSUE_VOUCHER_TEMPLATE_CONFIG = {
  headerLine1: "",
  headerLine2: "",
  formCode: "Mẫu số: PXK",
  title: "PHIẾU XUẤT KHO",
  receiverLabel: "Họ và tên người nhận hàng",
  unitLabel: "Đơn vị",
  reasonLabel: "Lý do xuất kho",
  signatures: [
    {
      title: "Người lập phiếu",
      subtitle: "(Ký, ghi rõ họ tên)",
      signerName: "",
      widthPercent: 25,
    },
    {
      title: "Người nhận hàng",
      subtitle: "(Ký, ghi rõ họ tên)",
      signerName: "",
      widthPercent: 25,
    },
    {
      title: "Thủ kho",
      subtitle: "(Ký, ghi rõ họ tên)",
      signerName: "",
      widthPercent: 25,
    },
    {
      title: "Chỉ huy đơn vị",
      subtitle: "(Ký, đóng dấu)",
      signerName: "",
      widthPercent: 25,
    },
  ],
};

const PRINT_TEMPLATE_DEFINITIONS = {
  [PRINT_TEMPLATE_TYPES.ALLOCATION_MODE_ISSUE_VOUCHER]: {
    type: PRINT_TEMPLATE_TYPES.ALLOCATION_MODE_ISSUE_VOUCHER,
    name: "Mẫu in phiếu xuất kho",
    description: "Mẫu in dành cho phiếu xuất kho cấp phát theo chế độ.",
    defaultConfig: DEFAULT_ALLOCATION_MODE_ISSUE_VOUCHER_TEMPLATE_CONFIG,
    normalizeConfig: normalizeAllocationModeIssueVoucherTemplateConfig,
  },
};

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value, maxLength) {
  return String(value || "").slice(0, maxLength);
}

function normalizeSignatureSubtitle(subtitle) {
  return String(subtitle || "")
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.slice(0, SIGNATURE_SUBTITLE_MAX_CHARS_PER_LINE))
    .join("\n");
}

function normalizeSignatureWidthPercent(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return SIGNATURE_WIDTH_PERCENT_MIN;
  return Math.min(
    SIGNATURE_WIDTH_PERCENT_TOTAL,
    Math.max(SIGNATURE_WIDTH_PERCENT_MIN, Math.round(numericValue)),
  );
}

function distributeEvenSignatureWidthPercents(count) {
  if (!count) return [];
  const base = Math.floor(SIGNATURE_WIDTH_PERCENT_TOTAL / count);
  const remainder = SIGNATURE_WIDTH_PERCENT_TOTAL - base * count;

  return Array.from({ length: count }, (_, index) =>
    base + (index < remainder ? 1 : 0),
  );
}

function rebalanceSignatureWidthPercents(widthPercents, pinnedIndex = null) {
  if (!widthPercents.length) return [];

  const nextPercents = widthPercents.map((value) =>
    normalizeSignatureWidthPercent(value),
  );
  const minTotal = nextPercents.length * SIGNATURE_WIDTH_PERCENT_MIN;
  if (minTotal > SIGNATURE_WIDTH_PERCENT_TOTAL) {
    return distributeEvenSignatureWidthPercents(nextPercents.length);
  }

  let diff =
    SIGNATURE_WIDTH_PERCENT_TOTAL -
    nextPercents.reduce((sum, value) => sum + value, 0);

  while (diff !== 0) {
    const candidateIndexes = nextPercents
      .map((value, index) => ({ value, index }))
      .filter(({ index, value }) =>
        diff > 0
          ? index !== pinnedIndex
          : index !== pinnedIndex && value > SIGNATURE_WIDTH_PERCENT_MIN,
      )
      .sort((left, right) =>
        diff > 0 ? left.value - right.value : right.value - left.value,
      )
      .map(({ index }) => index);

    if (!candidateIndexes.length) {
      const fallbackIndex =
        pinnedIndex ??
        nextPercents.findIndex((value) => value > SIGNATURE_WIDTH_PERCENT_MIN);
      if (fallbackIndex === -1) break;
      candidateIndexes.push(fallbackIndex);
    }

    let changed = false;
    for (const index of candidateIndexes) {
      if (diff === 0) break;
      if (diff > 0) {
        nextPercents[index] += 1;
        diff -= 1;
        changed = true;
        continue;
      }
      if (nextPercents[index] <= SIGNATURE_WIDTH_PERCENT_MIN) continue;
      nextPercents[index] -= 1;
      diff += 1;
      changed = true;
    }

    if (!changed) break;
  }

  return nextPercents;
}

function normalizeSignatureWidthPercents(signatures = []) {
  if (!signatures.length) return [];

  const rawPercents = signatures.map((signature) => Number(signature?.widthPercent));
  const hasStoredPercents = rawPercents.some((value) => Number.isFinite(value));
  const baseValues = hasStoredPercents
    ? rawPercents.map((value) =>
        Number.isFinite(value) ? value : SIGNATURE_WIDTH_PERCENT_MIN,
      )
    : signatures.map((signature) => {
        const legacyWeight = Number(signature?.widthWeight);
        return Number.isFinite(legacyWeight) && legacyWeight > 0 ? legacyWeight : 1;
      });

  const totalBase = baseValues.reduce((sum, value) => sum + value, 0);
  if (totalBase <= 0) {
    return distributeEvenSignatureWidthPercents(signatures.length);
  }

  const scaledValues = baseValues.map(
    (value) => (value / totalBase) * SIGNATURE_WIDTH_PERCENT_TOTAL,
  );
  return rebalanceSignatureWidthPercents(
    scaledValues.map((value) => Math.round(value)),
  );
}

function buildFallbackSignature(index) {
  const defaultSignature =
    DEFAULT_ALLOCATION_MODE_ISSUE_VOUCHER_TEMPLATE_CONFIG.signatures[index];

  if (defaultSignature) {
    return cloneJsonValue(defaultSignature);
  }

  return {
    title: `Chữ ký ${index + 1}`,
    subtitle: "",
    signerName: "",
    widthPercent: SIGNATURE_WIDTH_PERCENT_MIN,
  };
}

function normalizeAllocationModeIssueVoucherTemplateConfig(config) {
  const source =
    config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const signatureSource = Array.isArray(source.signatures)
    ? source.signatures.filter(Boolean).slice(0, 8)
    : [];
  const nextSignaturesSource = signatureSource.length
    ? signatureSource
    : DEFAULT_ALLOCATION_MODE_ISSUE_VOUCHER_TEMPLATE_CONFIG.signatures;

  const normalizedSignatures = nextSignaturesSource.map((signature, index) => {
    const fallback = buildFallbackSignature(index);
    const candidate =
      signature && typeof signature === "object" && !Array.isArray(signature)
        ? signature
        : {};

    return {
      title: normalizeText(candidate.title ?? fallback.title, 191),
      subtitle: normalizeSignatureSubtitle(candidate.subtitle ?? fallback.subtitle),
      signerName: normalizeText(candidate.signerName ?? fallback.signerName, 191),
      widthPercent:
        candidate.widthPercent ?? candidate.widthWeight ?? fallback.widthPercent,
    };
  });

  const widthPercents = normalizeSignatureWidthPercents(normalizedSignatures);

  return {
    headerLine1: normalizeText(
      source.headerLine1,
      191,
    ),
    headerLine2: normalizeText(
      source.headerLine2,
      191,
    ),
    formCode: normalizeText(
      source.formCode ?? DEFAULT_ALLOCATION_MODE_ISSUE_VOUCHER_TEMPLATE_CONFIG.formCode,
      191,
    ),
    title: normalizeText(
      source.title ?? DEFAULT_ALLOCATION_MODE_ISSUE_VOUCHER_TEMPLATE_CONFIG.title,
      191,
    ),
    receiverLabel: normalizeText(
      source.receiverLabel ??
        DEFAULT_ALLOCATION_MODE_ISSUE_VOUCHER_TEMPLATE_CONFIG.receiverLabel,
      191,
    ),
    unitLabel: normalizeText(
      source.unitLabel ?? DEFAULT_ALLOCATION_MODE_ISSUE_VOUCHER_TEMPLATE_CONFIG.unitLabel,
      191,
    ),
    reasonLabel: normalizeText(
      source.reasonLabel ??
        DEFAULT_ALLOCATION_MODE_ISSUE_VOUCHER_TEMPLATE_CONFIG.reasonLabel,
      191,
    ),
    signatures: normalizedSignatures.map((signature, index) => ({
      ...signature,
      widthPercent: widthPercents[index],
    })),
  };
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

function getTemplateDefinition(templateType) {
  const definition = PRINT_TEMPLATE_DEFINITIONS[String(templateType || "").trim()];
  if (!definition) {
    throw new AppError({
      statusCode: HTTP_CODES.BAD_REQUEST,
      message: "Loại mẫu in không hợp lệ",
      errorCode: "PRINT_TEMPLATE_TYPE_INVALID",
    });
  }

  return definition;
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

function mapTemplateVersion(version, { includeConfig = true } = {}) {
  if (!version) return null;

  return {
    id: version.id,
    versionNo: version.versionNo,
    createdAt: version.createdAt,
    createdBy: mapUserSummary(version.createdBy),
    ...(includeConfig ? { config: cloneJsonValue(version.config) } : {}),
  };
}

function mapTemplate(template) {
  if (!template) return null;

  return {
    id: template.id,
    type: template.type,
    name: template.name,
    description: template.description || null,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    unit: template.unit
      ? {
          id: template.unit.id,
          name: template.unit.name,
        }
      : null,
    currentVersion: mapTemplateVersion(template.activeVersion),
    versions: (template.versions || []).map((version) => mapTemplateVersion(version)),
  };
}

async function fetchTemplateRecord({ unitId, templateType, tx = prisma }) {
  return tx.printTemplate.findFirst({
    where: {
      unitId,
      type: templateType,
      deletedAt: null,
    },
    include: {
      unit: {
        select: { id: true, name: true },
      },
      activeVersion: {
        include: {
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
        },
      },
      versions: {
        orderBy: [{ versionNo: "desc" }],
        take: TEMPLATE_VERSION_HISTORY_LIMIT,
        include: {
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
        },
      },
    },
  });
}

async function createInitialTemplateVersion({ tx, template, createdById }) {
  const definition = getTemplateDefinition(template.type);
  const defaultConfig = definition.normalizeConfig(definition.defaultConfig);

  const version = await tx.printTemplateVersion.create({
    data: {
      templateId: template.id,
      versionNo: 1,
      config: defaultConfig,
      createdById: createdById || null,
    },
  });

  await tx.printTemplate.update({
    where: { id: template.id },
    data: {
      activeVersionId: version.id,
    },
  });

  return version;
}

async function ensureTemplateRecord({
  unitId,
  templateType,
  createdById = null,
  tx = prisma,
}) {
  let template = await tx.printTemplate.findFirst({
    where: {
      unitId,
      type: templateType,
      deletedAt: null,
    },
    include: {
      activeVersion: true,
    },
  });

  if (!template) {
    const definition = getTemplateDefinition(templateType);
    template = await tx.printTemplate.create({
      data: {
        unitId,
        type: templateType,
        name: definition.name,
        description: definition.description,
        createdById,
      },
      include: {
        activeVersion: true,
      },
    });
  }

  if (template.activeVersion) return template;

  const latestVersion = await tx.printTemplateVersion.findFirst({
    where: { templateId: template.id },
    orderBy: [{ versionNo: "desc" }],
  });

  if (latestVersion) {
    await tx.printTemplate.update({
      where: { id: template.id },
      data: {
        activeVersionId: latestVersion.id,
      },
    });

    return {
      ...template,
      activeVersion: latestVersion,
    };
  }

  const initialVersion = await createInitialTemplateVersion({
    tx,
    template,
    createdById,
  });

  return {
    ...template,
    activeVersion: initialVersion,
  };
}

export async function getCurrentPrintTemplate({
  actor,
  templateType = PRINT_TEMPLATE_TYPES.ALLOCATION_MODE_ISSUE_VOUCHER,
}) {
  const unitId = getActorUnitId(actor);
  const resolvedType = getTemplateDefinition(templateType).type;

  await prisma.$transaction(async (tx) => {
    await ensureTemplateRecord({
      tx,
      unitId,
      templateType: resolvedType,
      createdById: actor?.id || null,
    });
  });

  const template = await fetchTemplateRecord({
    unitId,
    templateType: resolvedType,
  });

  return {
    template: mapTemplate(template),
  };
}

export async function createPrintTemplateVersion({
  actor,
  templateType = PRINT_TEMPLATE_TYPES.ALLOCATION_MODE_ISSUE_VOUCHER,
  config,
}) {
  const unitId = getActorUnitId(actor);
  const definition = getTemplateDefinition(templateType);
  const normalizedConfig = definition.normalizeConfig(config);

  await prisma.$transaction(async (tx) => {
    const template = await ensureTemplateRecord({
      tx,
      unitId,
      templateType: definition.type,
      createdById: actor?.id || null,
    });

    const latestVersion = await tx.printTemplateVersion.findFirst({
      where: { templateId: template.id },
      orderBy: [{ versionNo: "desc" }],
      select: { versionNo: true },
    });

    const createdVersion = await tx.printTemplateVersion.create({
      data: {
        templateId: template.id,
        versionNo: Number(latestVersion?.versionNo || 0) + 1,
        config: normalizedConfig,
        createdById: actor?.id || null,
      },
    });

    await tx.printTemplate.update({
      where: { id: template.id },
      data: {
        activeVersionId: createdVersion.id,
        name: definition.name,
        description: definition.description,
      },
    });
  });

  const template = await fetchTemplateRecord({
    unitId,
    templateType: definition.type,
  });

  return {
    template: mapTemplate(template),
  };
}

export async function resolvePrintTemplateUsage({
  unitId,
  templateType,
  actorId = null,
  tx = prisma,
}) {
  const definition = getTemplateDefinition(templateType);
  const template = await ensureTemplateRecord({
    tx,
    unitId,
    templateType: definition.type,
    createdById: actorId,
  });

  const activeVersion = template.activeVersion
    ? {
        id: template.activeVersion.id,
        versionNo: template.activeVersion.versionNo,
        config: definition.normalizeConfig(template.activeVersion.config),
      }
    : null;

  if (!activeVersion) {
    throw new AppError({
      statusCode: HTTP_CODES.INTERNAL_SERVER_ERROR,
      message: "Không thể khởi tạo phiên bản mẫu in hiện hành",
      errorCode: "PRINT_TEMPLATE_ACTIVE_VERSION_MISSING",
    });
  }

  return {
    type: definition.type,
    templateId: template.id,
    templateName: template.name,
    versionId: activeVersion.id,
    versionNo: activeVersion.versionNo,
    snapshot: cloneJsonValue(activeVersion.config),
  };
}

export function mapPrintTemplateUsage({
  templateType,
  templateId,
  templateVersionId,
  templateVersionNo,
  templateSnapshot,
  template,
  templateVersion,
}) {
  if (!templateType && !templateVersionNo && !templateSnapshot) {
    return null;
  }

  return {
    type: templateType || template?.type || null,
    templateId: templateId || template?.id || null,
    templateName: template?.name || null,
    versionId: templateVersionId || templateVersion?.id || null,
    versionNo: templateVersionNo || templateVersion?.versionNo || null,
    config: templateSnapshot
      ? cloneJsonValue(templateSnapshot)
      : templateVersion?.config
        ? cloneJsonValue(templateVersion.config)
        : null,
  };
}

export const printTemplateService = {
  getCurrentPrintTemplate,
  createPrintTemplateVersion,
  resolvePrintTemplateUsage,
  mapPrintTemplateUsage,
  PRINT_TEMPLATE_TYPES,
};

export default printTemplateService;
