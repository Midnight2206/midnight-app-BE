import { z } from "zod";

export const itemIdParamSchema = z.object({
  params: z.object({
    itemId: z.coerce.number().int().positive(),
  }),
});

export const unitOfMeasureIdParamSchema = z.object({
  params: z.object({
    unitOfMeasureId: z.coerce.number().int().positive(),
  }),
});

export const versionIdParamSchema = z.object({
  params: z.object({
    versionId: z.coerce.number().int().positive(),
  }),
});

export const colorIdParamSchema = z.object({
  params: z.object({
    colorId: z.coerce.number().int().positive(),
  }),
});

export const subjectIdParamSchema = z.object({
  params: z.object({
    subjectId: z.coerce.number().int().positive(),
  }),
});

export const standardIdParamSchema = z.object({
  params: z.object({
    standardId: z.coerce.number().int().positive(),
  }),
});

export const warehouseIdParamSchema = z.object({
  params: z.object({
    warehouseId: z.coerce.number().int().positive(),
  }),
});

export const createWarehouseSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, "Tên kho tối thiểu 2 ký tự").max(191),
    categoryIds: z.array(z.coerce.number().int().positive()).max(2000).optional(),
  }),
});

export const updateWarehouseSchema = z.object({
  params: z.object({
    warehouseId: z.coerce.number().int().positive(),
  }),
  body: z
    .object({
      name: z.string().trim().min(2, "Tên kho tối thiểu 2 ký tự").max(191),
      categoryIds: z.array(z.coerce.number().int().positive()).max(2000).optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: "Phải có ít nhất một trường để cập nhật",
      path: ["name"],
    }),
});

export const warehouseItemParamSchema = z.object({
  params: z.object({
    warehouseId: z.coerce.number().int().positive(),
    itemId: z.coerce.number().int().positive(),
  }),
});

export const addWarehouseItemsSchema = z.object({
  params: z.object({
    warehouseId: z.coerce.number().int().positive(),
  }),
  body: z.object({
    itemIds: z
      .array(z.coerce.number().int().positive())
      .min(1, "Phải có ít nhất một itemId")
      .max(500, "Tối đa 500 itemId mỗi lần"),
  }),
});

export const removeCategoryWarehouseItemSchema = z.object({
  params: z.object({
    warehouseId: z.coerce.number().int().positive(),
  }),
  body: z.object({
    categoryId: z.coerce.number().int().positive(),
    versionId: z.coerce.number().int().positive(),
    colorId: z.coerce.number().int().positive(),
  }),
});

export const transferCategoryStockSchema = z.object({
  body: z.object({
    fromWarehouseId: z.coerce.number().int().positive(),
    toWarehouseId: z.coerce.number().int().positive(),
    categoryId: z.coerce.number().int().positive(),
    versionId: z.coerce.number().int().positive(),
    colorId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().positive(),
    note: z.string().trim().max(191).optional(),
  }),
});

export const adjustWarehouseCategoryStockSchema = z.object({
  body: z.object({
    warehouseId: z.coerce.number().int().positive(),
    categoryId: z.coerce.number().int().positive(),
    versionId: z.coerce.number().int().positive(),
    colorId: z.coerce.number().int().positive(),
    delta: z.coerce.number().int().refine((value) => value !== 0, {
      message: "delta phải khác 0",
    }),
  }),
});

export const createSupplyItemSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, "Tên mặt hàng tối thiểu 2 ký tự").max(191),
    categoryId: z.coerce.number().int().positive(),
    unitOfMeasureId: z.coerce.number().int().positive().optional(),
    versionId: z.coerce.number().int().positive().optional(),
    colorId: z.coerce.number().int().positive().optional(),
    isActive: z.coerce.boolean().optional(),
  }),
});

export const createUnitOfMeasureSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(191),
  }),
});

export const createVersionSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(191),
  }),
});

export const createColorSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(191),
  }),
});

export const createAllocationSubjectSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(191),
    unitId: z.coerce.number().int().positive().optional(),
  }),
});

const membershipPeriodSchema = z
  .object({
    subjectId: z.coerce.number().int().positive(),
    transferInYear: z.coerce.number().int().min(1900).max(3000),
    transferOutYear: z.coerce.number().int().min(1900).max(3000).nullable().optional(),
  })
  .refine(
    (entry) =>
      entry.transferOutYear === undefined ||
      entry.transferOutYear === null ||
      entry.transferOutYear >= entry.transferInYear,
    {
      message: "transferOutYear phải lớn hơn hoặc bằng transferInYear",
      path: ["transferOutYear"],
    },
  );

export const listAllocationSubjectMembershipsSchema = z.object({
  query: z.object({
    unitId: z.coerce.number().int().positive().optional(),
    militaryId: z.string().trim().min(1),
    asOfYear: z.coerce.number().int().min(1900).max(3000).optional(),
  }),
});

export const setAllocationSubjectMembershipsSchema = z.object({
  body: z.object({
    unitId: z.coerce.number().int().positive().optional(),
    militaryId: z.string().trim().min(1),
    memberships: z.array(membershipPeriodSchema).max(500),
  }),
});

const standardItemQuantitySchema = z.object({
  itemId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().min(0),
});

const standardItemRuleSchema = z.object({
  itemId: z.coerce.number().int().positive(),
  mode: z.enum(["OPEN", "CONDITIONAL"]).optional(),
  gender: z.enum(["ANY", "MALE", "FEMALE"]).optional(),
  rankGroup: z
    .enum(["ANY", "CAP_UY", "CAP_TA", "CAP_TUONG", "HSQ_BS"])
    .optional(),
});

const standardConditionSchema = z.object({
  field: z.enum(["INITIAL_COMMISSIONING_YEAR"]),
  operator: z.enum(["GT", "GTE", "LT", "LTE", "EQ", "NEQ"]),
  issueYearOffset: z.coerce.number().int().min(-50).max(50).optional(),
});

export const createAllocationStandardSchema = z.object({
  body: z.object({
    unitId: z.coerce.number().int().positive().optional(),
    subjectId: z.coerce.number().int().positive(),
    categoryId: z.coerce.number().int().positive(),
    serviceLifeYears: z.coerce.number().int().positive().max(100),
    campaignContent: z.string().trim().max(1000).optional(),
    standardCondition: standardConditionSchema.nullable().optional(),
    itemQuantities: z.array(standardItemQuantitySchema).max(500).optional(),
    itemRules: z.array(standardItemRuleSchema).max(500).optional(),
  }),
});

export const updateAllocationStandardSchema = z.object({
  params: z.object({
    standardId: z.coerce.number().int().positive(),
  }),
  body: z
    .object({
      unitId: z.coerce.number().int().positive().optional(),
      subjectId: z.coerce.number().int().positive().optional(),
      categoryId: z.coerce.number().int().positive().optional(),
      serviceLifeYears: z.coerce.number().int().positive().max(100).optional(),
      campaignContent: z.string().trim().max(1000).optional(),
      standardCondition: standardConditionSchema.nullable().optional(),
      itemQuantities: z.array(standardItemQuantitySchema).max(500).optional(),
      itemRules: z.array(standardItemRuleSchema).max(500).optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: "Phải có ít nhất một trường để cập nhật",
      path: ["subjectId"],
    }),
});

export const updateSupplyItemSchema = z.object({
  params: z.object({
    itemId: z.coerce.number().int().positive(),
  }),
  body: z
    .object({
      name: z.string().trim().min(2).max(191).optional(),
      categoryId: z.coerce.number().int().positive().optional(),
      unitOfMeasureId: z.coerce.number().int().positive().optional(),
      versionId: z.coerce.number().int().positive().optional(),
      colorId: z.coerce.number().int().positive().optional(),
      isActive: z.coerce.boolean().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: "Phải có ít nhất một trường để cập nhật",
      path: ["name"],
    }),
});

export const adjustStockSchema = z.object({
  body: z.object({
    warehouseId: z.coerce.number().int().positive(),
    itemId: z.coerce.number().int().positive(),
    delta: z.coerce.number().int().refine((value) => value !== 0, {
      message: "delta phải khác 0",
    }),
    note: z.string().trim().max(191).optional(),
  }),
});

export const adjustStockBatchSchema = z.object({
  body: z.object({
    adjustments: z
      .array(
        z.object({
          warehouseId: z.coerce.number().int().positive(),
          itemId: z.coerce.number().int().positive(),
          delta: z.coerce.number().int().refine((value) => value !== 0, {
            message: "delta phải khác 0",
          }),
          note: z.string().trim().max(191).optional(),
        }),
      )
      .min(1, "Phải có ít nhất 1 điều chỉnh")
      .max(500, "Tối đa 500 điều chỉnh mỗi lần"),
  }),
});

export const transferStockSchema = z.object({
  body: z.object({
    fromWarehouseId: z.coerce.number().int().positive(),
    toWarehouseId: z.coerce.number().int().positive(),
    itemId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().positive(),
    note: z.string().trim().max(191).optional(),
  }),
});

export const transferStockBatchSchema = z.object({
  body: z.object({
    fromWarehouseId: z.coerce.number().int().positive(),
    toWarehouseId: z.coerce.number().int().positive(),
    note: z.string().trim().max(191).optional(),
    transfers: z
      .array(
        z.object({
          itemId: z.coerce.number().int().positive(),
          quantity: z.coerce.number().int().positive(),
          note: z.string().trim().max(191).optional(),
        }),
      )
      .min(1, "Phải có ít nhất 1 mặt hàng luân chuyển")
      .max(500, "Tối đa 500 mặt hàng mỗi lần luân chuyển"),
  }),
});

export const getAllocationEligibleItemsSchema = z.object({
  query: z.object({
    unitId: z.coerce.number().int().positive().optional(),
    subjectId: z.coerce.number().int().positive(),
    militaryId: z.string().trim().min(1),
    categoryId: z.coerce.number().int().positive().optional(),
    asOfDate: z.string().datetime().optional(),
    asOfYear: z.coerce.number().int().min(1900).max(3000).optional(),
    gender: z.enum(["MALE", "FEMALE"]).optional(),
  }),
});

export const createAllocationIssueLogSchema = z.object({
  body: z.object({
    unitId: z.coerce.number().int().positive().optional(),
    warehouseId: z.coerce.number().int().positive(),
    militaryId: z.string().trim().min(1),
    standardId: z.coerce.number().int().positive(),
    issuedAt: z.string().datetime().optional(),
    note: z.string().trim().max(191).optional(),
    items: z
      .array(
        z.object({
          itemId: z.coerce.number().int().positive(),
          quantity: z.coerce.number().int().positive(),
        }),
      )
      .min(1, "Phải có ít nhất một mặt hàng được cấp")
      .max(500, "Tối đa 500 mặt hàng mỗi lần"),
  }),
});

export const allocationIssueVoucherIdParamSchema = z.object({
  params: z.object({
    voucherId: z.string().trim().min(1),
  }),
});
