import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "#configs/prisma.config.js";
import {
  buildPermissionCode,
  normalizePermissionPath,
} from "#utils/permission.util.js";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];
const SKIPPED_PERMISSION_CODES = new Set([
  "POST /api/auth/login",
  "POST /api/auth/register",
  "GET /api/auth/me",
  "POST /api/auth/refresh",
  "POST /api/auth/logout",
]);

const MODULE_LABELS = {
  access: "quản trị phân quyền",
  accounts: "quản lý tài khoản",
  auth: "xác thực tài khoản",
  backups: "sao lưu và khôi phục dữ liệu",
  categories: "danh mục quân trang",
  inventories: "quản lý kho quân trang",
  militaries: "hồ sơ quân nhân",
  role: "quản lý vai trò",
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const routesDir = path.resolve(__dirname, "../routes");

function shouldSkipPermission(code) {
  return SKIPPED_PERMISSION_CODES.has(code);
}

function normalizePermissionCode(code) {
  if (!code || typeof code !== "string") return code;
  const firstSpaceIndex = code.indexOf(" ");
  if (firstSpaceIndex <= 0) return code;

  const method = code.slice(0, firstSpaceIndex).trim();
  const pathname = code.slice(firstSpaceIndex + 1).trim() || "/";
  return buildPermissionCode(method, pathname);
}

function inferResourceLabel(routeName, normalizedPath) {
  if (routeName === "access") {
    if (normalizedPath.includes("/roles")) return "vai trò";
    if (normalizedPath.includes("/permissions")) return "permission";
    if (normalizedPath.includes("/users")) return "vai trò người dùng";
    return "phân quyền hệ thống";
  }

  if (routeName === "accounts") {
    if (normalizedPath.includes("/admins")) return "tài khoản quản trị";
    if (normalizedPath.includes("/audits")) return "nhật ký tài khoản";
    if (normalizedPath.includes("/units")) return "đơn vị";
    return "tài khoản";
  }

  if (routeName === "militaries") {
    if (normalizedPath.includes("/units")) return "đơn vị";
    if (normalizedPath.includes("/template")) return "tệp mẫu quân nhân";
    if (normalizedPath.includes("/import")) return "dữ liệu quân nhân";
    if (normalizedPath.includes("/registration-options"))
      return "lựa chọn cỡ số";
    if (normalizedPath.includes("/registrations"))
      return "đăng ký cỡ số quân nhân";
    return "hồ sơ quân nhân";
  }

  if (routeName === "inventories") {
    if (normalizedPath.includes("/catalog-options")) {
      return "danh mục và cỡ số cho kho quân trang";
    }
    if (normalizedPath.includes("/warehouses")) return "kho quân trang";
    if (normalizedPath.includes("/items")) return "mặt hàng quân trang";
    if (normalizedPath.includes("/stocks/logs")) return "nhật ký điều chỉnh tồn kho";
    if (normalizedPath.includes("/stocks/adjust")) return "điều chỉnh tồn kho";
    if (normalizedPath.includes("/stocks")) return "tồn kho mặt hàng";
    return "kho quân trang";
  }

  if (routeName === "categories") return "danh mục quân trang";
  if (routeName === "auth") return "phiên đăng nhập";
  if (routeName === "role") return "vai trò";

  return "tài nguyên";
}

function inferActionDescription(method, normalizedPath, routePath) {
  const upperMethod = method.toUpperCase();

  if (upperMethod === "POST" && normalizedPath.includes("/permissions/sync")) {
    return "Đồng bộ danh sách permission từ toàn bộ route backend vào cơ sở dữ liệu";
  }
  if (normalizedPath.includes("/template") && upperMethod === "GET") {
    return "Tải xuống tệp mẫu để nhập dữ liệu";
  }
  if (normalizedPath.includes("/import") && upperMethod === "POST") {
    return "Nhập dữ liệu từ tệp lên hệ thống";
  }
  if (normalizedPath.includes("/reset") && upperMethod === "DELETE") {
    return "Đặt lại dữ liệu theo phạm vi chức năng";
  }
  if (normalizedPath.includes("/exists") && upperMethod === "POST") {
    return "Kiểm tra dữ liệu đã tồn tại trước khi thao tác";
  }
  if (normalizedPath.includes("/restore") && upperMethod === "POST") {
    return "Khôi phục bản ghi đã bị xóa mềm";
  }
  if (normalizedPath.includes("/reset-password") && upperMethod === "PATCH") {
    return "Đặt lại mật khẩu cho tài khoản";
  }
  if (normalizedPath.includes("/status") && upperMethod === "PATCH") {
    return "Cập nhật trạng thái hoạt động của tài khoản";
  }
  if (normalizedPath.includes("/registrations") && upperMethod === "GET") {
    return "Xem thông tin đăng ký cỡ số của quân nhân";
  }
  if (
    normalizedPath.includes("/registrations") &&
    ["PUT", "PATCH"].includes(upperMethod)
  ) {
    return "Cập nhật đăng ký cỡ số cho quân nhân";
  }
  if (
    normalizedPath.includes("/roles/:id/permissions") &&
    upperMethod === "PATCH"
  ) {
    return "Gán hoặc thay đổi danh sách permission của vai trò";
  }
  if (
    normalizedPath.includes("/users/:id/role") &&
    ["PATCH", "PUT"].includes(upperMethod)
  ) {
    return "Cập nhật vai trò chính cho người dùng";
  }
  if (
    normalizedPath.includes("/users/:id/roles") &&
    ["PATCH", "PUT"].includes(upperMethod)
  ) {
    return "Cập nhật danh sách vai trò cho người dùng";
  }
  if (normalizedPath.includes("/login") && upperMethod === "POST") {
    return "Đăng nhập vào hệ thống";
  }
  if (normalizedPath.includes("/register") && upperMethod === "POST") {
    return "Đăng ký tài khoản mới";
  }
  if (normalizedPath.includes("/refresh") && upperMethod === "POST") {
    return "Làm mới phiên đăng nhập bằng refresh token";
  }
  if (normalizedPath.includes("/logout") && upperMethod === "POST") {
    return "Đăng xuất và thu hồi phiên đăng nhập";
  }
  if (normalizedPath.endsWith("/me") && upperMethod === "GET") {
    return "Xem thông tin tài khoản hiện tại";
  }

  if (upperMethod === "GET") {
    return routePath === "/" ? "Xem danh sách" : "Xem chi tiết";
  }
  if (upperMethod === "POST") {
    return routePath === "/" ? "Tạo mới dữ liệu" : "Thực thi nghiệp vụ";
  }
  if (upperMethod === "PUT") return "Cập nhật toàn bộ dữ liệu";
  if (upperMethod === "PATCH") return "Cập nhật một phần dữ liệu";
  if (upperMethod === "DELETE") return "Xóa dữ liệu";

  return "Truy cập tài nguyên";
}

function buildDescriptionVi({ method, routeName, code, fullPath, routePath }) {
  const normalizedPath = normalizePermissionPath(fullPath);
  const actionDescription = inferActionDescription(
    method,
    normalizedPath,
    routePath,
  );
  const moduleLabel = MODULE_LABELS[routeName] || routeName;
  const resourceLabel = inferResourceLabel(routeName, normalizedPath);

  return `${actionDescription} trong phân hệ ${moduleLabel}, áp dụng cho ${resourceLabel}. Mã quyền: ${code}.`;
}

function collectPermissionsFromRouteFiles() {
  const files = fs
    .readdirSync(routesDir)
    .filter((file) => file.endsWith(".route.js") && file !== "index.js");

  const registry = new Map();

  for (const file of files) {
    const routeName = file.replace(".route.js", "");
    const basePath = `/api/${routeName}`;
    const content = fs.readFileSync(path.join(routesDir, file), "utf-8");

    for (const method of HTTP_METHODS) {
      const routeRegex = new RegExp(
        `router\\.${method}\\(\\s*(['\"])([^'\"]+)\\1`,
        "g",
      );

      let match = routeRegex.exec(content);
      while (match) {
        const routePath = match[2].trim();
        const fullPath =
          routePath === "/"
            ? basePath
            : normalizePermissionPath(
                `${basePath}${routePath.startsWith("/") ? "" : "/"}${routePath}`,
              );

        const code = buildPermissionCode(method, fullPath);
        if (shouldSkipPermission(code)) {
          match = routeRegex.exec(content);
          continue;
        }

        if (!registry.has(code)) {
          registry.set(code, {
            code,
            description: buildDescriptionVi({
              method,
              routeName,
              code,
              fullPath,
              routePath,
            }),
          });
        }

        match = routeRegex.exec(content);
      }
    }
  }

  return [...registry.values()];
}

export async function syncPermissionsFromRoutes() {
  const scannedPermissionsRaw = collectPermissionsFromRouteFiles();
  const scannedPermissionMap = new Map();
  for (const permission of scannedPermissionsRaw) {
    if (!scannedPermissionMap.has(permission.code)) {
      scannedPermissionMap.set(permission.code, permission);
    }
  }
  const scannedPermissions = [...scannedPermissionMap.values()];
  const skippedCodes = [...SKIPPED_PERMISSION_CODES];

  if (scannedPermissions.length === 0) {
    return {
      totalScanned: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
    };
  }

  const existingPermissions = await prisma.permission.findMany({
    select: {
      id: true,
      code: true,
      description: true,
    },
  });

  const existingMap = new Map(
    existingPermissions.map((permission) => [permission.code, permission]),
  );

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const removedCodes = existingPermissions
    .filter((permission) => SKIPPED_PERMISSION_CODES.has(permission.code))
    .map((permission) => permission.code);
  const legacyPermissionsToMigrate = existingPermissions.filter((permission) => {
    if (shouldSkipPermission(permission.code)) return false;
    const normalizedCode = normalizePermissionCode(permission.code);
    return normalizedCode && normalizedCode !== permission.code;
  });
  let migratedLegacyCodes = 0;

  await prisma.$transaction(async (tx) => {
    if (removedCodes.length > 0) {
      await tx.permission.deleteMany({
        where: {
          code: {
            in: removedCodes,
          },
        },
      });
    }

    for (const permission of scannedPermissions) {
      const existed = existingMap.get(permission.code);

      if (!existed) {
        created += 1;
      } else if ((existed.description || "") !== permission.description) {
        updated += 1;
      } else {
        unchanged += 1;
      }

      await tx.permission.upsert({
        where: {
          code: permission.code,
        },
        update: {
          description: permission.description,
        },
        create: permission,
      });
    }

    if (legacyPermissionsToMigrate.length > 0) {
      const currentPermissions = await tx.permission.findMany({
        select: {
          id: true,
          code: true,
        },
      });
      const currentPermissionMap = new Map(
        currentPermissions.map((permission) => [permission.code, permission]),
      );

      for (const legacyPermission of legacyPermissionsToMigrate) {
        const normalizedCode = normalizePermissionCode(legacyPermission.code);
        const targetPermission = currentPermissionMap.get(normalizedCode);

        if (!targetPermission || targetPermission.id === legacyPermission.id) {
          continue;
        }

        const roleLinks = await tx.rolePermission.findMany({
          where: {
            permissionId: legacyPermission.id,
          },
          select: {
            roleId: true,
          },
        });

        if (roleLinks.length > 0) {
          await tx.rolePermission.createMany({
            data: roleLinks.map((roleLink) => ({
              roleId: roleLink.roleId,
              permissionId: targetPermission.id,
            })),
            skipDuplicates: true,
          });
        }

        await tx.rolePermission.deleteMany({
          where: {
            permissionId: legacyPermission.id,
          },
        });

        await tx.permission.delete({
          where: {
            id: legacyPermission.id,
          },
        });

        migratedLegacyCodes += 1;
      }
    }
  });

  return {
    totalScanned: scannedPermissions.length,
    created,
    updated,
    unchanged,
    skipped: skippedCodes.length,
    removed: removedCodes.length,
    migratedLegacyCodes,
  };
}
