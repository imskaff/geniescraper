import type { AppError, ErrorCode } from "../shared/messages";

/** A failure with a stable code the panel can turn into a message; thrown inside the page, returned as data. */
export class AppleError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "AppleError";
    this.code = code;
  }

  toJSON(): AppError {
    return { code: this.code, message: this.message };
  }
}

export const NOT_FOUND_MESSAGE = "Page not found. Check the URL and try again.";
