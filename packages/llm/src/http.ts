// Requests to a provider's HTTP API (07, "Providers"), whichever API it speaks: time limits, errors
// mapped to LlmError, and asking again without an option the provider refused.
import { LlmError } from "./errors.ts";

/**
 * The time a request may take: until its first byte, then between chunks of a streamed reply (it is
 * extended as data arrives), so a slow model is never cut off while it is still writing.
 */
export class TimeLimit {
  private readonly ctl = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(ms: number) {
    this.extend(ms);
  }
  get signal() {
    return this.ctl.signal;
  }
  get expired() {
    return this.ctl.signal.aborted;
  }
  extend(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.ctl.abort(), ms);
    // A pending limit does not keep the process alive (Bun, Node).
    (this.timer as { unref?: () => void }).unref?.();
  }
  clear() {
    clearTimeout(this.timer);
  }
}

/** Until the first byte, and between chunks of a streamed reply (tests shorten them). */
export interface Limits {
  firstMs: number;
  idleMs: number;
}

/** Local servers may load the model on the first request (JIT), which takes a while; silence
 *  allowed between chunks of a streamed reply. */
export const CHAT_LIMITS: Limits = { firstMs: 180_000, idleMs: 60_000 };
export const MODELS_TIMEOUT_MS = 10_000;

/**
 * An error while reading a response body: the limit run out is a timeout, a dropped connection is
 * unreachable; the learner stopping, and errors already mapped, stay as they are.
 */
export function readFailure(error: unknown, base: string, limit: TimeLimit, signal?: AbortSignal) {
  if (limit.expired) return new LlmError("timeout", `${base} stopped answering`);
  if (signal?.aborted || error instanceof LlmError) return error;
  return new LlmError("unreachable", `${base}: the connection broke off`);
}

/** A reply cut at its token limit is kept as it came (a reply carries no mark of it): the log says so. */
export const cutShort = (base: string, model: string) =>
  console.warn(`${base}: ${model}'s reply reached its token limit`);

/** The model declined to answer. */
export const refusal = () => new LlmError("refused", "the model declined to answer");

/** The usual key header: `Authorization: Bearer <key>` (none without a key). */
export const bearer = (apiKey: string | undefined): Record<string, string> =>
  apiKey ? { authorization: `Bearer ${apiKey}` } : {};

/**
 * Requests to one HTTP endpoint with the shared error mapping (unreachable, timeout, unauthorized…).
 * Used by every HTTP provider and by provider-specific APIs (LM Studio, OpenRouter's key).
 */
export function endpointCaller(
  baseUrl: string,
  auth: Record<string, string>,
  fetchFn: typeof fetch,
) {
  const base = baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // OpenRouter shows the app name in its activity log; other servers ignore it.
    "x-title": "SprachAnker",
    ...auth,
  };

  /** A request under a time limit (milliseconds, or a limit the caller extends while reading). */
  return async function call(
    path: string,
    init: RequestInit,
    limit: number | TimeLimit,
    signal?: AbortSignal,
  ): Promise<Response> {
    const time = typeof limit === "number" ? new TimeLimit(limit) : limit;
    let res: Response;
    try {
      res = await fetchFn(`${base}${path}`, {
        ...init,
        headers,
        // A redirect would carry the key to another origin: none is followed.
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, time.signal]) : time.signal,
      });
    } catch (error) {
      if (time.expired) throw new LlmError("timeout", `${base} did not answer in time`);
      if (signal?.aborted) throw error;
      throw new LlmError("unreachable", `${base} is not reachable`);
    }
    if (res.ok) return res;
    const text = await res.text().catch(() => "");
    const message = errorMessage(text) ?? `HTTP ${res.status}`;
    // Gemini refuses a wrong key with 400 and says so.
    if (
      res.status === 401 ||
      res.status === 403 ||
      (res.status === 400 && /api key/i.test(message))
    )
      throw new LlmError("unauthorized", message, res.status);
    if (res.status === 404) throw new LlmError("model_not_found", message, res.status);
    const wait = Number(res.headers.get("retry-after") ?? Number.NaN);
    const retryAfter = Number.isFinite(wait) && wait > 0 ? wait : undefined;
    if (res.status === 429) throw new LlmError("rate_limited", message, res.status, retryAfter);
    // Anthropic's 529, anyone's 503 (OpenAI, Gemini: overloaded, unavailable): no room for now.
    if (res.status === 529 || res.status === 503)
      throw new LlmError("overloaded", message, res.status, retryAfter);
    throw new LlmError("bad_response", message, res.status);
  };
}

function errorMessage(body: string): string | undefined {
  try {
    type Body = { error?: string | { message?: string } };
    const parsed = JSON.parse(body) as Body | Body[];
    // Gemini wraps the error in a list.
    const json = Array.isArray(parsed) ? (parsed[0] ?? {}) : parsed;
    return typeof json.error === "string" ? json.error : json.error?.message;
  } catch {
    return body.trim().slice(0, 200) || undefined;
  }
}

/** The provider refused the request as sent (400, 422): asking again without an option may help. */
const refused = (error: unknown): error is LlmError =>
  error instanceof LlmError && (error.status === 400 || error.status === 422);

/**
 * Sends with the options on, and while the provider refuses the request as sent (not when it is busy
 * or failing) naming one of them (`named`: what its message says), again without that one. Models
 * that always reason reject the switch, some servers reject tools or a schema; a refusal naming
 * none of them (a credit balance too low) is the error it is.
 */
export async function relaxing<O extends Record<string, boolean>, T>(
  on: O,
  send: (on: O) => Promise<T>,
  named: Partial<Record<keyof O & string, RegExp>>,
): Promise<T> {
  let current = { ...on };
  for (;;) {
    try {
      return await send(current);
    } catch (error) {
      if (!refused(error)) throw error;
      const keys = Object.keys(current) as (keyof O & string)[];
      const drop = keys.find((k) => current[k] && named[k]?.test(error.message));
      if (!drop) throw error;
      current = { ...current, [drop]: false };
    }
  }
}

/** A whole JSON reply: not JSON at all is a bad reply; a body that never arrived is a timeout or a
 *  dropped connection. */
export async function readJson<T>(
  res: Response,
  base: string,
  limit: TimeLimit,
  signal?: AbortSignal,
): Promise<T | null> {
  try {
    return JSON.parse(await res.text()) as T | null;
  } catch (error) {
    if (error instanceof SyntaxError) throw new LlmError("bad_response", "no JSON reply");
    throw readFailure(error, base, limit, signal);
  }
}
