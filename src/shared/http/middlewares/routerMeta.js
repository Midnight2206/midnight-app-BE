import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";

export const publicRoute = (req, res, next) => {
  next();
};

export const protectedRoute = (req, res, next) => {
  if (!req.user) {
    return next(
      new AppError({
        message: "Unauthenticated",
        statusCode: HTTP_CODES.UNAUTHORIZED,
      }),
    );
  }
  next();
};
