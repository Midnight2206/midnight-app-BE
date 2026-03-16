import { z } from "zod";

export const createRoleSchema = z.object({
  body: z.object({
    name: z
      .string()
      .trim()
      .min(2, "Role name tối thiểu 2 ký tự")
      .max(50, "Role name tối đa 50 ký tự"),
    description: z.string().trim().max(255, "Description tối đa 255 ký tự").optional(),
  }),
});

export const updateRolePermissionsSchema = z.object({
  params: z.object({
    roleId: z.coerce.number().int().positive(),
  }),
  body: z.object({
    permissionCodes: z.array(z.string().trim().min(1)).default([]),
  }),
});

export const updateUserRolesSchema = z.object({
  params: z.object({
    userId: z.string().uuid("userId không hợp lệ"),
  }),
  body: z
    .object({
      roleName: z.string().trim().min(1, "Phải có role").optional(),
      roleNames: z.array(z.string().trim().min(1)).max(1).optional(),
    })
    .refine(
      (body) =>
        Boolean(body.roleName) ||
        (Array.isArray(body.roleNames) && body.roleNames.length === 1),
      {
        message: "Phải truyền roleName hoặc roleNames với đúng 1 phần tử",
        path: ["roleName"],
      },
    ),
});
