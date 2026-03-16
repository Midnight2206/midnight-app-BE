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
