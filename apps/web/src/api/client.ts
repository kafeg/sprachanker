import { CLIENT_HEADERS } from "@sprachanker/schema";
import type { AppType } from "@sprachanker/server/app";
import { hc } from "hono/client";

/** Typed client for the server's JSON API (Hono RPC, same origin); mutations carry the client header. */
export const api = hc<AppType>("/", { headers: { ...CLIENT_HEADERS } }).api;

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

/** What `json` reads of a response: its status and its body (a Hono RPC response is no more). */
interface JsonResponse<T> {
  ok: boolean;
  status: number;
  json(): Promise<T>;
}

/** JSON of a response, or an ApiError with the server's message. */
export async function json<T>(response: Promise<JsonResponse<T>>): Promise<T> {
  const res = await response;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status);
  }
  return res.json();
}
