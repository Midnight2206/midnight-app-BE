import { z } from "zod";

export const registerSchema = z.object({
  body: z.object({
    email: z.email("Email không hợp lệ"),
    username: z.string().min(3, "Tên người dùng tối thiểu 3 ký tự"),
    password: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự"),
    militaryCode: z.string().trim().min(1, "Mã quân nhân không được để trống"),
  }),
});
export const loginSchema = z.object({
  body: z.object({
    identifier: z.string().min(1, "Vui lòng nhập email hoặc tên người dùng"),
    password: z.string().min(1, "Vui lòng nhập mật khẩu"),
  }),
});

export const verifyEmailConfirmSchema = z.object({
  query: z.object({
    token: z.string().trim().min(1, "Verify token is required"),
  }),
});

export const verifyEmailTestSchema = z.object({
  body: z.object({
    to: z.email("Email test không hợp lệ").optional(),
  }),
});

export const updateProfileSchema = z.object({
  body: z.object({
    fullName: z.string().trim().max(191, "Họ tên quá dài").optional().nullable(),
    avatar: z.string().trim().url("Avatar phải là URL hợp lệ").optional().or(z.literal("")).nullable(),
    phone: z.string().trim().max(30, "Số điện thoại quá dài").optional().nullable(),
    birthday: z.string().trim().optional().nullable(),
    initialCommissioningYear: z
      .union([z.number().int().nonnegative(), z.string().trim(), z.null()])
      .optional(),
    assignedUnit: z.string().trim().max(191, "Assigned unit quá dài").optional().nullable(),
  }),
});

export const passwordChangeRequestSchema = z
  .object({
    body: z.object({
      currentPassword: z.string().min(1, "Vui lòng nhập mật khẩu hiện tại"),
      newPassword: z.string().min(8, "Mật khẩu mới tối thiểu 8 ký tự"),
      confirmPassword: z.string().min(8, "Vui lòng xác nhận mật khẩu mới"),
    }),
  })
  .refine((input) => input.body.newPassword === input.body.confirmPassword, {
    path: ["body", "confirmPassword"],
    message: "Xác nhận mật khẩu không khớp",
  });

export const passwordChangeConfirmSchema = z.object({
  body: z.object({
    token: z.string().trim().min(1, "Password change token is required"),
  }),
});
