import { type CardDisplay, CLIENT_HEADERS } from "@sprachanker/schema";
import type { AppType } from "@sprachanker/server/app";
import { hc } from "hono/client";

/** Typed client for the server's JSON API (Hono RPC, same origin); mutations carry the client header. */
export const api = hc<AppType>("/", { headers: { ...CLIENT_HEADERS } }).api;

/** Queries whose data no learner action changes (content, the course's files, the app, the standing
 *  prompts): a progress reset leaves them (their `meta`). */
export const STATIC = { static: true } as const;

/** In the phone app (apps/mobile sets `sprachankerPhone`): what moves files between machines —
 *  courses' and profiles' files, decks imported, a course's upkeep — is not there yet. */
export const inPhoneApp = !!(globalThis as { sprachankerPhone?: boolean }).sprachankerPhone;

/** Where a file the server serves is played from: the path itself, or what the phone app makes of
 *  it (apps/mobile serves media and recordings from its own files: `sprachankerFileUrl`). */
export const fileUrl = (path: string) =>
  (globalThis as { sprachankerFileUrl?: (path: string) => string }).sprachankerFileUrl?.(path) ??
  path;

/** URL of a library media file. */
export const mediaUrl = (series: string, path: string) => fileUrl(`/library/${series}/${path}`);

/** URL of a card's media file: in its course's library, or in its imported deck's folder. */
export const cardMediaUrl = (display: CardDisplay, path: string) =>
  "deck" in display ? fileUrl(`/decks/${display.deck}/${path}`) : mediaUrl(display.series, path);

/** URL of a card's recording: its own, else its word read aloud for its deck (in a deck's folder),
 *  else the recording of the card's word where it was made. */
export const cardAudioUrl = (display: CardDisplay) =>
  display.audio
    ? cardMediaUrl(display, display.audio)
    : display.readAudio
      ? fileUrl(`/decks/${display.readAudio}`)
      : display.recordingPath && fileUrl(`/${display.recordingPath}`);

export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status of the response, when the error came from one. */
    readonly status?: number,
    /** Seconds to wait before asking again, when the server says (a provider's limit). */
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/** A refusal that sending again cannot change; a lost session (401), a request that reached the wrong
 *  host (421), a timeout (408), a busy server (429) or a run whose course is not on this computer any
 *  more (`course_gone`: downloaded again, it takes them) is not one — the events wait to be sent again. */
export const refusedByServer = (e: unknown) =>
  e instanceof ApiError &&
  !!e.status &&
  e.status < 500 &&
  ![401, 408, 421, 429].includes(e.status) &&
  e.message !== "course_gone";

/** What `json` reads of a response: its status and its body (a Hono RPC response is no more). */
interface JsonResponse<T> {
  ok: boolean;
  status: number;
  json(): Promise<T>;
}

/** The error a failed response answered with (`{ error: <code> }`), as an ApiError. */
export async function apiError(res: { status: number; json(): Promise<unknown> }) {
  return errorOf(await res.json().catch(() => ({})), `HTTP ${res.status}`, res.status);
}

/** An error body (`{ error: <code>, retryAfter? }`) as an ApiError; `fallback` without a code. */
export function errorOf(body: unknown, fallback: string, status?: number) {
  const { error, retryAfter } = (body ?? {}) as { error?: unknown; retryAfter?: unknown };
  return new ApiError(
    typeof error === "string" ? error : fallback,
    status,
    typeof retryAfter === "number" ? retryAfter : undefined,
  );
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
