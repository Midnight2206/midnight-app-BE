import { z } from "zod";

const RULE_FIELDS = [
  "initialCommissioningYear",
  "gender",
  "rank",
  "rankGroup",
  "position",
  "assignedUnitId",
  "assignedUnit",
  "militaryCode",
  "unitId",
];

const RULE_OPERATORS = [
  "EQ",
  "NEQ",
  "GT",
  "GTE",
  "LT",
  "LTE",
  "IN",
  "NOT_IN",
  "CONTAINS",
  "STARTS_WITH",
  "ENDS_WITH",
  "IS_TRUE",
  "IS_FALSE",
];

const RULE_VALUE_SOURCES = ["STATIC", "ISSUE_YEAR", "CURRENT_YEAR"];
const MODE_SCOPES = ["SYSTEM", "UNIT"];
const RULE_COMBINATORS = ["ALL", "ANY"];
const PRINT_TEMPLATE_TYPES = ["ALLOCATION_MODE_ISSUE_VOUCHER"];

const ruleValueSchema = z.union([
  z.string().trim().min(1),
  z.number(),
  z.boolean(),
  z.array(z.string().trim().min(1)).min(1),
  z.array(z.number()).min(1),
]);

const ruleClauseSchema = z
  .object({
    field: z.enum(RULE_FIELDS),
    operator: z.enum(RULE_OPERATORS),
    valueSource: z.enum(RULE_VALUE_SOURCES).default("STATIC"),
    value: ruleValueSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.valueSource !== "STATIC" && value.value !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "value chỉ dùng khi valueSource là STATIC",
        path: ["value"],
      });
    }

    if (
      value.valueSource === "STATIC" &&
      !["IS_TRUE", "IS_FALSE"].includes(value.operator) &&
      value.value === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Phải có value khi valueSource là STATIC",
        path: ["value"],
      });
    }
  });

const ruleConfigSchema = z
  .object({
    clauses: z.array(ruleClauseSchema).max(50).default([]),
  })
  .optional();

const categorySchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().min(0),
  isActive: z.coerce.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});

const modeBodySchema = z.object({
  scope: z.enum(MODE_SCOPES).optional(),
  unitId: z.coerce.number().int().positive().optional(),
  code: z.string().trim().max(100).optional(),
  name: z.string().trim().min(2).max(191),
  description: z.string().trim().max(5000).optional(),
  isActive: z.coerce.boolean().optional(),
  ruleCombinator: z.enum(RULE_COMBINATORS).optional(),
  ruleConfig: ruleConfigSchema,
  militaryTypeIds: z.array(z.coerce.number().int().positive()).length(1),
  includedMilitaryIds: z.array(z.string().uuid()).max(1000).optional(),
  excludedMilitaryIds: z.array(z.string().uuid()).max(1000).optional(),
  categories: z.array(categorySchema).min(1).max(500),
});

export const listAllocationModesSchema = z.object({
  query: z.object({
    scope: z.enum(["all", "system", "unit"]).optional(),
    unitId: z.coerce.number().int().positive().optional(),
    status: z.enum(["active", "all"]).optional(),
  }),
});

export const createAllocationModeSchema = z.object({
  body: modeBodySchema,
});

export const updateAllocationModeSchema = z.object({
  params: z.object({
    modeId: z.string().uuid(),
  }),
  body: modeBodySchema.partial(),
});

export const allocationModeIdParamSchema = z.object({
  params: z.object({
    modeId: z.string().uuid(),
  }),
});

export const listApplicableAllocationModesSchema = z.object({
  query: z.object({
    militaryId: z.string().uuid(),
    issueYear: z.coerce.number().int().min(1900).max(3000).optional(),
  }),
});

export const getAllocationModeVoucherTemplateSchema = z.object({
  query: z.object({
    templateType: z.enum(PRINT_TEMPLATE_TYPES).optional(),
  }),
});

export const updateAllocationModeVoucherTemplateSchema = z.object({
  body: z.object({
    templateType: z.enum(PRINT_TEMPLATE_TYPES).optional(),
    config: z.unknown(),
  }),
});

export const allocationModeEligibilitySchema = z.object({
  params: z.object({
    modeId: z.string().uuid(),
  }),
  query: z.object({
    militaryId: z.string().uuid(),
    issueYear: z.coerce.number().int().min(1900).max(3000),
    warehouseId: z.coerce.number().int().positive().optional(),
    excludeVoucherId: z.string().uuid().optional(),
  }),
});

const issueVoucherItemSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().min(0),
  versionId: z.coerce.number().int().positive().optional(),
  colorId: z.coerce.number().int().positive().optional(),
});

export const createAllocationModeIssueVoucherSchema = z.object({
  body: z.object({
    purpose: z.enum(["MODE", "OTHER"]).optional(),
    modeId: z.string().uuid().optional(),
    militaryId: z.string().uuid().optional(),
    warehouseId: z.coerce.number().int().positive(),
    issueYear: z.coerce.number().int().min(1900).max(3000),
    issuedAt: z.string().trim().min(1).optional(),
    receiverName: z.string().trim().min(1).max(191),
    reason: z.string().trim().min(1).max(1000).optional(),
    note: z.string().trim().max(1000).optional(),
    items: z.array(issueVoucherItemSchema).min(1).max(500),
  }),
});

export const updateAllocationModeIssueVoucherSchema = z.object({
  params: z.object({
    voucherId: z.string().uuid(),
  }),
  body: z.object({
    receiverName: z.string().trim().min(1).max(191).optional(),
    reason: z.string().trim().min(1).max(1000).optional(),
    note: z.string().trim().max(1000).optional(),
    items: z.array(issueVoucherItemSchema).min(1).max(500).optional(),
  }),
});

export const listAllocationModeIssueVouchersSchema = z.object({
  query: z.object({
    search: z.string().trim().min(1).max(120).optional(),
    militaryId: z.string().uuid().optional(),
    modeId: z.string().uuid().optional(),
    purpose: z.enum(["MODE", "OTHER"]).optional(),
    warehouseId: z.coerce.number().int().positive().optional(),
    issueYear: z.coerce.number().int().min(1900).max(3000).optional(),
    sortBy: z.enum(["issuedAt"]).optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().optional(),
  }),
});

export const allocationModeIssueVoucherIdParamSchema = z.object({
  params: z.object({
    voucherId: z.string().uuid(),
  }),
});
