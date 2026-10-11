// Errors a service raises for the client: a code (the response's `error`, one of schema's
// ERROR_CODES) and the HTTP status it maps to in the app's onError. Anything else is a server fault
// (500).
import type { ErrorCode } from "@sprachanker/schema";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 411 | 413 | 415 | 422 | 429 | 502 | 507;

export class ServiceError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: ErrorStatus = 400,
  ) {
    super(code);
  }
}

/** What an error answers with: a service's refusal (its code and status), a request that does not
 *  validate (400 with what did not fit); undefined for anything else (a server fault). */
export function errorResponse(
  error: unknown,
): { status: ContentfulStatusCode; body: { error: string; detail?: string } } | undefined {
  if (error instanceof ServiceError) return { status: error.status, body: { error: error.code } };
  if (error instanceof HTTPException)
    return { status: error.status, body: { error: "invalid_request", detail: error.message } };
  return undefined;
}
