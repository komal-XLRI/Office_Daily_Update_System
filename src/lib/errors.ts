/**
 * Application errors. The `message` of an AppError is always safe to show to end users.
 * Any other thrown value is reported to clients as a generic failure (no stack traces).
 */

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "INVALID_OFFICE"
  | "INVALID_USER"
  | "CONFLICT"
  | "OTP_EXPIRED"
  | "INVALID_OTP"
  | "TOO_MANY_ATTEMPTS"
  | "RATE_LIMITED"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FILE"
  | "UPLOAD_FAILED"
  | "DATABASE_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export type FieldErrors = Record<string, string[]>;

interface AppErrorOptions {
  fieldErrors?: FieldErrors;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors?: FieldErrors;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, status: number, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.fieldErrors = options.fieldErrors;
    this.details = options.details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Please sign in to continue.") {
    super("UNAUTHORIZED", message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super("FORBIDDEN", message, 403);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Record") {
    super("NOT_FOUND", `${resource} not found.`, 404);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message = "Please correct the highlighted fields.", fieldErrors?: FieldErrors) {
    super("INVALID_INPUT", message, 400, { fieldErrors });
    this.name = "ValidationError";
  }
}

export class InvalidOfficeError extends AppError {
  constructor(message = "The selected office is invalid or inactive.") {
    super("INVALID_OFFICE", message, 400, { fieldErrors: { officeId: [message] } });
    this.name = "InvalidOfficeError";
  }
}

export class InvalidUserError extends AppError {
  constructor(message = "Invalid user.", status = 400) {
    super("INVALID_USER", message, status);
    this.name = "InvalidUserError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("CONFLICT", message, 409, { details });
    this.name = "ConflictError";
  }
}

export class OtpExpiredError extends AppError {
  constructor(message = "The OTP has expired. Please request a new one.") {
    super("OTP_EXPIRED", message, 400);
    this.name = "OtpExpiredError";
  }
}

export class InvalidOtpError extends AppError {
  constructor(attemptsRemaining?: number) {
    const suffix =
      attemptsRemaining === undefined
        ? ""
        : ` ${attemptsRemaining} attempt${attemptsRemaining === 1 ? "" : "s"} remaining.`;
    super("INVALID_OTP", `Invalid OTP.${suffix}`, 400, {
      details: attemptsRemaining === undefined ? undefined : { attemptsRemaining },
    });
    this.name = "InvalidOtpError";
  }
}

export class TooManyAttemptsError extends AppError {
  constructor(message = "Too many incorrect attempts. Please request a new OTP.") {
    super("TOO_MANY_ATTEMPTS", message, 429);
    this.name = "TooManyAttemptsError";
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many requests. Please try again later.", retryAfterSeconds?: number) {
    super("RATE_LIMITED", message, 429, {
      details: retryAfterSeconds === undefined ? undefined : { retryAfterSeconds },
    });
    this.name = "RateLimitError";
  }
}

export class FileTooLargeError extends AppError {
  constructor(message = "File is too large.") {
    super("FILE_TOO_LARGE", message, 413);
    this.name = "FileTooLargeError";
  }
}

export class UnsupportedFileError extends AppError {
  constructor(message = "Unsupported file type.") {
    super("UNSUPPORTED_FILE", message, 415);
    this.name = "UnsupportedFileError";
  }
}

export class UploadFailedError extends AppError {
  constructor(message = "File upload failed. Please try again.", cause?: unknown) {
    super("UPLOAD_FAILED", message, 502, { cause });
    this.name = "UploadFailedError";
  }
}

export class DatabaseError extends AppError {
  constructor(cause?: unknown) {
    super("DATABASE_ERROR", "A database error occurred. Please try again.", 503, { cause });
    this.name = "DatabaseError";
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "This service is temporarily unavailable. Please try again later.") {
    super("SERVICE_UNAVAILABLE", message, 503);
    this.name = "ServiceUnavailableError";
  }
}

/** Server misconfiguration. Users see a generic message; `internalMessage` is only logged. */
export class ConfigurationError extends ServiceUnavailableError {
  readonly internalMessage: string;

  constructor(internalMessage: string) {
    super("The service is not configured correctly. Please contact the administrator.");
    this.name = "ConfigurationError";
    this.internalMessage = internalMessage;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
