import { HTTP_CODES } from "#src/constants.js";

export class AppError extends Error {
  constructor({
    message = "Error",
    statusCode = HTTP_CODES.BAD_REQUEST,
    errorCode = null,
    metadata = null,
  }) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.metadata = metadata;

    Error.captureStackTrace(this, this.constructor);
  }
}
