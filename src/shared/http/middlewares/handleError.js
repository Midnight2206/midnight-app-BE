import jwt from "jsonwebtoken";
import { Prisma } from "#src/generated/prisma/index.js";
import { ZodError } from "zod";
import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";

export function errorMiddleware(err, req, res, next) {
  // Dev log
  if (process.env.NODE_ENV === "development") {
    console.error("🔥 ERROR:", err);
  }

  // 1. AppError (business)
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errorCode: err.errorCode,
      metadata: err.metadata,
    });
  }

  // 2. JWT
  if (err instanceof jwt.TokenExpiredError) {
    return res.status(HTTP_CODES.UNAUTHORIZED).json({
      success: false,
      message: "Token expired",
      errorCode: "TOKEN_EXPIRED",
    });
  }

  if (err instanceof jwt.JsonWebTokenError) {
    return res.status(HTTP_CODES.UNAUTHORIZED).json({
      success: false,
      message: "Invalid token",
      errorCode: "INVALID_TOKEN",
    });
  }

  // 3. Validation
  if (err instanceof ZodError) {
    return res.status(HTTP_CODES.UNPROCESSABLE_ENTITY).json({
      success: false,
      message: "Validation failed",
      errorCode: "VALIDATION_ERROR",
      errors: err.issues.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      })),
    });
  }

  // 4. Prisma
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const debug =
      process.env.NODE_ENV === "development"
        ? {
            prismaCode: err.code,
            prismaMeta: err.meta,
          }
        : undefined;

    switch (err.code) {
      case "P2002":
        return res.status(HTTP_CODES.BAD_REQUEST).json({
          success: false,
          message: "Duplicate data",
          errorCode: "DUPLICATE_FIELD",
          debug,
        });

      case "P2025":
        return res.status(HTTP_CODES.NOT_FOUND).json({
          success: false,
          message: "Resource not found",
          errorCode: "NOT_FOUND",
          debug,
        });

      case "P2003":
        return res.status(HTTP_CODES.BAD_REQUEST).json({
          success: false,
          message: "Invalid relation reference",
          errorCode: "FOREIGN_KEY_CONSTRAINT",
          debug,
        });

      default:
        return res.status(HTTP_CODES.BAD_REQUEST).json({
          success: false,
          message: "Database error",
          errorCode: "PRISMA_ERROR",
          debug,
        });
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      success: false,
      message: "Database query validation error",
      errorCode: "PRISMA_VALIDATION_ERROR",
      debug:
        process.env.NODE_ENV === "development"
          ? { details: err.message }
          : undefined,
    });
  }

  // 5. Fallback
  return res.status(HTTP_CODES.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: "Internal Server Error",
    errorCode: "INTERNAL_ERROR",
  });
}
