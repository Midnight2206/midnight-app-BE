import { z } from "zod";

export const createAdminSchema = z.object({
  body: z.object({
    email: z.email("Email không hợp lệ"),
    username: z.string().trim().min(3, "Username tối thiểu 3 ký tự"),
    password: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự"),
    unitId: z
      .number({ message: "unitId phải là số" })
      .int("unitId phải là số nguyên")
      .positive("unitId phải lớn hơn 0"),
  }),
});

export const updateAccountStatusSchema = z.object({
  params: z.object({
    userId: z.string().uuid("userId không hợp lệ"),
  }),
  body: z.object({
    isActive: z.boolean({ message: "isActive phải là boolean" }),
  }),
});

export const resetPasswordSchema = z.object({
  params: z.object({
    userId: z.string().uuid("userId không hợp lệ"),
  }),
  body: z.object({
    newPassword: z.string().min(8, "Mật khẩu mới tối thiểu 8 ký tự"),
  }),
});
