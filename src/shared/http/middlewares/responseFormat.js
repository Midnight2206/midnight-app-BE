import { HTTP_CODES } from "#src/constants.js";

export function responseMiddleware(req, res, next) {
  res.success = ({
    data = null,
    message = "Success",
    statusCode = HTTP_CODES.OK,
    meta = null,
  } = {}) => {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
      meta,
    });
  }
  next();
}
