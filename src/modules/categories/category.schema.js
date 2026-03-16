import { z } from "zod";

export const idParamSchema = z.object({
  params: z.object({
    id: z.coerce.number().int("ID phải là số nguyên").positive("ID phải > 0"),
  }),
});
export const createCategorySchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, "Tên danh mục tối thiểu 2 ký tự"),
    code: z.string().trim().max(191).optional(),
    unitOfMeasureId: z.coerce.number().int().positive().optional(),
    versionId: z.coerce.number().int().positive().optional(),
    colorId: z.coerce.number().int().positive().optional(),
    versionIds: z.array(z.coerce.number().int().positive()).optional(),
    colorIds: z.array(z.coerce.number().int().positive()).optional(),
    totalQuantity: z.coerce.number().int().min(0).optional(),
    isActive: z.coerce.boolean().optional(),

    sizes: z
      .array(z.string().trim().toUpperCase())
      .refine(
        (sizes) => new Set(sizes).size === sizes.length,
        "Size không được trùng nhau",
      ),
  }),
});
export const checkCategoryExistSchema = z.object({
  query: z.object({
    name: z.string().trim().min(1, "Tên danh mục không được để trống"),
  }),
});

export const updateCategorySchema = z.object({
  params: z.object({
    id: z.coerce.number().int("ID phải là số nguyên").positive("ID phải > 0"),
  }),

  body: z.object({
    name: z.string().trim().min(2, "Tên danh mục tối thiểu 2 ký tự"),
    code: z.string().trim().max(191).optional(),
    unitOfMeasureId: z.coerce.number().int().positive().optional(),
    versionId: z.coerce.number().int().positive().optional(),
    colorId: z.coerce.number().int().positive().optional(),
    versionIds: z.array(z.coerce.number().int().positive()).optional(),
    colorIds: z.array(z.coerce.number().int().positive()).optional(),
    totalQuantity: z.coerce.number().int().min(0).optional(),
    isActive: z.coerce.boolean().optional(),

    sizes: z
      .array(z.string().trim().toUpperCase())
      .refine(
        (sizes) => new Set(sizes).size === sizes.length,
        "Size không được trùng nhau",
      ),
  }),
});
export const getCategoriesSchema = z.object({
  query: z
    .object({
      q: z.string().trim().min(1).optional(),

      status: z.enum(["deleted", "active", "all"]).optional(),

      sortBy: z.enum(["createdAt", "name"]).optional(),

      order: z.enum(["asc", "desc"]).optional(),
    })
    .strict()
    .catch({}),
});

export const deleteCategorySchema = idParamSchema;
export const restoreCategorySchema = idParamSchema;

export const warehouseIdParamSchema = z.object({
  params: z.object({
    warehouseId: z.coerce.number().int().positive(),
  }),
});

export const createWarehouseSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(191),
  }),
});

export const updateWarehouseSchema = z.object({
  params: z.object({
    warehouseId: z.coerce.number().int().positive(),
  }),
  body: z.object({
    name: z.string().trim().min(2).max(191),
  }),
});

const warehouseEntrySchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  versionId: z.coerce.number().int().positive(),
  colorId: z.coerce.number().int().positive(),
});

export const addWarehouseCategoryItemsSchema = z.object({
  params: z.object({
    warehouseId: z.coerce.number().int().positive(),
  }),
  body: z.object({
    entries: z.array(warehouseEntrySchema).min(1).max(500),
  }),
});

export const removeWarehouseCategoryItemSchema = z.object({
  params: z.object({
    warehouseId: z.coerce.number().int().positive(),
  }),
  body: warehouseEntrySchema,
});

export const adjustCategoryStockSchema = z.object({
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
