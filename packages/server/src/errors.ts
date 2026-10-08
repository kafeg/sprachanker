// Errors a service raises for the client: a code (the response's `error`, one of schema's
// ERROR_CODES) and the HTTP status it maps to in the app's onError. Anything else is a server fault
// (500).
import type { ErrorCode } from "@sprachanker/schema";

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 502;

export class ServiceError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: ErrorStatus = 400,
  ) {
    super(code);
  }
}
