import { z } from "zod";

export const listBackupsSchema = z.object({
  query: z.object({
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
    pageToken: z.string().optional(),
  }),
});

export const restoreBackupSchema = z.object({
  body: z.object({
    fileId: z.string().trim().min(1, "fileId là bắt buộc"),
    fileName: z.string().trim().optional(),
  }),
});

export const downloadBackupSchema = z.object({
  params: z.object({
    fileId: z.string().trim().min(1, "fileId là bắt buộc"),
  }),
});
