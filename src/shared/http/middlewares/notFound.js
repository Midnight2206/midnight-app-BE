import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#root/utils/AppError.js";
export function notFoundMiddleware(req, res, next) {
  throw new AppError({
    statusCode: HTTP_CODES.NOT_FOUND,
    message: "Resource not found",
    errorCode: "RESOURCE_NOT_FOUND",
  });
}
