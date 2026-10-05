import type { AppType } from "@sprachanker/server/app";
import { hc } from "hono/client";

/** Typed client for the server's JSON API (Hono RPC, same origin); mutations carry the client header. */
export const api = hc<AppType>("/", { headers: { "x-sprachanker": "1" } }).api;

/** URL of a library media file. */
export const mediaUrl = (series: string, path: string) => `/library/${series}/${path}`;

export class ApiError extends Error {}

/** JSON of a response, or an ApiError with the server's message. */
export async function json<T>(response: Promise<Response & { json(): Promise<T> }>): Promise<T> {
  const res = await response;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}
