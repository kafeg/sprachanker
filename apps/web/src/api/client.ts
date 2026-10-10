import { CLIENT_HEADERS } from "@sprachanker/schema";
import type { AppType } from "@sprachanker/server/app";
import { hc } from "hono/client";

/** Typed client for the server's JSON API (Hono RPC, same origin); mutations carry the client header. */
export const api = hc<AppType>("/", { headers: { ...CLIENT_HEADERS } }).api;

/** Queries whose data no learner action changes (content, the course's files, the app, the standing
 *  prompts): a progress reset leaves them (their `meta`). */
export const STATIC = { static: true } as const;

/** URL of a library media file. */
export const mediaUrl = (series: string, path: string) => `/library/${series}/${path}`;

export class ApiError extends Error {
  /** HTTP status of the response, when the error came from one. */
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** A refusal that sending again cannot change; a lost session (401), a request that reached the wrong
 *  host (421), a timeout (408) or a busy server (429) is not one — the events wait to be sent again. */
export const refusedByServer = (e: unknown) =>
  e instanceof ApiError && !!e.status && e.status < 500 && ![401, 408, 421, 429].includes(e.status);

/** What `json` reads of a response: its status and its body (a Hono RPC response is no more). */
interface JsonResponse<T> {
  ok: boolean;
  status: number;
  json(): Promise<T>;
}

/** The error a failed response answered with (`{ error: <code> }`, 06), as an ApiError. */
export async function apiError(res: { status: number; json(): Promise<unknown> }) {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new ApiError(body.error ?? `HTTP ${res.status}`, res.status);
}

/** JSON of a response, or an ApiError with the server's code. */
export async function json<T>(response: Promise<JsonResponse<T>>): Promise<T> {
  const res = await response;
  if (!res.ok) throw await apiError(res);
  return res.json();
}

/** A request with a binary body (not through the RPC client): its JSON, or an ApiError. */
export async function sendBinary<T>(
  url: string,
  body: Blob | Uint8Array<ArrayBuffer>,
  type: string,
) {
  const res = await fetch(url, {
    method: "POST",
    headers: { ...CLIENT_HEADERS, "content-type": type },
    body,
  });
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as T;
}
