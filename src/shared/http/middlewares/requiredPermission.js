import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";
import { buildPermissionCode } from "#utils/permission.util.js";

function buildPermissionCodeFromRequest(req) {
  return buildPermissionCode(req.method, `${req.baseUrl || ""}${req.path || "/"}`);
}

export const requirePermission = (...requiredPermissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(
        new AppError({
          message: "Unauthenticated",
          statusCode: HTTP_CODES.UNAUTHORIZED,
        }),
      );
    }

    if (req.user.roles?.includes("SUPER_ADMIN")) {
      return next();
    }

    const permissions =
      requiredPermissions.length > 0
        ? requiredPermissions
        : [buildPermissionCodeFromRequest(req)];

    const hasPermission = permissions.every((p) =>
      req.user.permissions.includes(p),
    );

    if (!hasPermission) {
      return next(
        new AppError({
          message: `Forbidden (${permissions.join(", ")})`,
          statusCode: HTTP_CODES.FORBIDDEN,
        }),
      );
    }

    next();
  };
};
