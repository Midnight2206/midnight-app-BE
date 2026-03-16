import { z } from "zod";

export const submitRegistrationRequestSchema = z.object({
  body: z.object({
    year: z.coerce.number().int().min(2000).max(2100),
    note: z.string().trim().max(500).optional(),
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

export const upsertRegistrationPeriodSchema = z.object({
  params: z.object({
    year: z.coerce.number().int().min(2000).max(2100),
  }),
  body: z.object({
    status: z.enum(["OPEN", "LOCKED"]),
    note: z.string().trim().max(500).optional(),
  }),
});

export const reviewRegistrationRequestSchema = z.object({
  params: z.object({
    requestId: z.string().trim().uuid(),
  }),
  body: z.object({
    action: z.enum(["APPROVE", "REJECT"]),
    reviewNote: z.string().trim().max(500).optional(),
  }),
});
