import { z } from "zod";

export const createUnitSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, "Tên đơn vị tối thiểu 2 ký tự").max(100),
  }),
});

export const createMilitaryTypeSchema = z.object({
  body: z.object({
    code: z.string().trim().min(1, "code là bắt buộc").max(50),
    name: z.string().trim().max(191).optional(),
  }),
});

export const militaryTypeIdParamSchema = z.object({
  params: z.object({
    typeId: z.coerce.number().int().positive(),
  }),
});

export const updateMilitarySizeRegistrationsSchema = z.object({
  params: z.object({
    militaryId: z.string().trim().uuid("militaryId không hợp lệ"),
  }),
  body: z.object({
    registrations: z
      .array(
        z.object({
          categoryId: z.coerce.number().int().positive(),
          sizeId: z.coerce.number().int().positive(),
        }),
      )
      .default([]),
  }),
});

export const createRegistrationYearSchema = z.object({
  body: z.object({
    year: z.coerce.number().int().min(2020).max(2100),
    isActive: z.coerce.boolean().optional(),
  }),
});

export const cutMilitaryAssuranceSchema = z.object({
  params: z.object({
    militaryId: z.string().trim().uuid("militaryId không hợp lệ"),
  }),
  body: z.object({
    transferOutYear: z.coerce.number().int().min(1900).max(2100),
  }),
});

export const receiveMilitaryAssuranceSchema = z.object({
  body: z.object({
    militaryCode: z.string().trim().min(1, "militaryCode là bắt buộc").max(100),
    transferInYear: z.coerce.number().int().min(1900).max(2100),
  }),
});

export const transferMilitaryAssuranceSchema = z.object({
  body: z
    .object({
      militaryCode: z.string().trim().min(1, "militaryCode là bắt buộc").max(100),
      transferYear: z.coerce.number().int().min(1900).max(2100),
      fromUnitId: z.preprocess(
        (value) => (value === "" || value === undefined ? null : value),
        z.union([z.coerce.number().int().positive(), z.null()]),
      ),
      toUnitId: z.preprocess(
        (value) => (value === "" || value === undefined ? null : value),
        z.union([z.coerce.number().int().positive(), z.null()]),
      ),
      fromExternalUnitName: z.string().trim().max(191).optional(),
      toExternalUnitName: z.string().trim().max(191).optional(),
      fullname: z.string().trim().max(191).optional(),
      rank: z.string().trim().max(191).optional(),
      position: z.string().trim().max(191).optional(),
      gender: z.enum(["MALE", "FEMALE"]).optional(),
      type: z.string().trim().max(50).optional(),
      types: z
        .union([z.string().trim().max(500), z.array(z.string().trim().max(50)).max(20)])
        .optional(),
      initialCommissioningYear: z.coerce.number().int().min(1900).max(2100).optional(),
      assignedUnit: z.string().trim().max(191).optional(),
      note: z.string().trim().max(191).optional(),
    })
    .refine((data) => data.fromUnitId !== null || data.toUnitId !== null, {
      message: "Từ đơn vị hoặc đến đơn vị phải có ít nhất một giá trị",
      path: ["toUnitId"],
    })
    .refine(
      (data) => !(data.fromUnitId === null && !String(data.fromExternalUnitName || "").trim()),
      {
        message: "Nguồn ngoài hệ thống là bắt buộc khi không chọn đơn vị nguồn",
        path: ["fromExternalUnitName"],
      },
    )
    .refine(
      (data) => !(data.toUnitId === null && !String(data.toExternalUnitName || "").trim()),
      {
        message: "Đích ngoài hệ thống là bắt buộc khi không chọn đơn vị đích",
        path: ["toExternalUnitName"],
      },
    ),
});

export const createCutTransferRequestSchema = z.object({
  params: z.object({
    militaryId: z.string().trim().uuid("militaryId không hợp lệ"),
  }),
  body: z.object({
    typeId: z.coerce.number().int().positive(),
    toUnitId: z.coerce.number().int().positive(),
    transferYear: z.coerce.number().int().min(1900).max(2100),
    note: z.string().trim().max(191).optional(),
  }),
});

export const requestIdParamSchema = z.object({
  params: z.object({
    requestId: z.string().trim().uuid("requestId không hợp lệ"),
  }),
});

// Snapshot schemas removed: history-only model
