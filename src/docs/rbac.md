## RBAC overview

Backend sử dụng **RBAC (Role-Based Access Control)** với các entity chính trong Prisma:

- `Role`
- `Permission` (mã quyền dạng `METHOD /api/...`)
- `UserRole` (gán 1 role cho user — hiện đang có `@@unique([userId])`)
- `RolePermission` (gán permission cho role)

## Luồng auth & attach quyền

- Client gửi request kèm cookie `accessToken`.
- Middleware `authOptional` sẽ verify JWT và load user từ DB.
- `getCurrentUser()` trả về object có:
  - `roles`: danh sách tên role
  - `permissions`: danh sách permission code (unique)

## Convention middleware cho authorization

Quy ước chung cho các route trong `src/routes/*.route.js`:

- **Public routes**: không cần login\n+  - Không dùng `protectedRoute`\n+- **Authenticated routes**: cần login\n+  - Dùng `protectedRoute`\n+- **RBAC-protected routes**: cần login + cần permission\n+  - Dùng `protectedRoute` + `requirePermission()`\n+  - Thông thường áp dụng ở mức module: `router.use(protectedRoute, requirePermission())`

Lưu ý:

- `requirePermission()` nếu không truyền tham số sẽ tự build permission code từ request (`req.method` + `req.baseUrl + req.path`).
- Nếu `req.user.roles` chứa `SUPER_ADMIN` thì được **bypass** permission check.

## Format permission code

Permission code được build bằng `buildPermissionCode(method, pathname)`:

- Dạng: `METHOD /api/<module>/<path>`
- Path được normalize bởi `normalizePermissionPath()`:\n+  - Segment là số / UUID / `:param` sẽ được normalize về `:id`\n+  - Ví dụ: `GET /api/accounts/users/123` → `GET /api/accounts/users/:id`

## Đồng bộ permission từ routes

Khi boot server, `syncPermissionsFromRoutes()` sẽ scan các file `*.route.js` để tạo danh sách permission trong DB:

- Scan các call `router.get/post/put/patch/delete("...")`
- Permission được tạo theo `basePath = /api/<routeName>` + `routePath`
- Một số auth endpoints được skip (ví dụ login/register/refresh/logout/me)

Bạn có thể trigger sync permission thủ công qua endpoint tương ứng trong module access (nếu đang bật trong routes).

