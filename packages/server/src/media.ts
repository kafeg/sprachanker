// Range responses for media (video seeking, audio): runtime-agnostic over Blob; request bodies limited
// (JSON, audio) or announced (files: deck packages, profile files).
import type { ErrorCode } from "@sprachanker/schema";
import { bodyLimit } from "hono/body-limit";

/** A Blob that can be sliced (Bun.file, Node's Blob, the web Blob). */
export type MediaBlob = Blob & { slice(start: number, end?: number): Blob };

export function blobResponse(blob: MediaBlob, range: string | undefined): Response {
  const headers: Record<string, string> = {
    "accept-ranges": "bytes",
    "content-type": blob.type || "application/octet-stream",
    "cache-control": "private, max-age=86400",
  };
  const m = /^bytes=(\d*)-(\d*)$/.exec(range ?? "");
  if (!m || (!m[1] && !m[2]))
    return new Response(blob, { headers: { ...headers, "content-length": String(blob.size) } });
  const size = blob.size;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    return new Response(null, {
      status: 416,
      headers: { ...headers, "content-range": `bytes */${size}` },
    });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      ...headers,
      "content-range": `bytes ${start}-${end}/${size}`,
      "content-length": String(end - start + 1),
    },
  });
}

/** A small request body up to `max` bytes: refused with 413 and `error` before it is read when
 *  announced larger; one not announced is held in memory while it is counted, so never for a file
 *  (those take `announcedLength`). */
export const limitedBody = (max: number, error: ErrorCode) =>
  bodyLimit({ maxSize: max, onError: (c) => c.json({ error }, 413) });

/** A file's body length as the request announces it (Content-Length, no Transfer-Encoding); undefined
 *  when it does not: the file is then refused (411 `length_required`), never held to be counted. */
export function announcedLength(headers: Headers) {
  const length = headers.get("content-length");
  return length && /^\d{1,16}$/.test(length) && !headers.has("transfer-encoding")
    ? Number(length)
    : undefined;
}

/** The largest body of a request that sends JSON (every API route but those taking files). */
export const JSON_BODY_MAX = 1024 * 1024;

/** A request body of audio up to `max` bytes. */
export const audioBody = (max: number) => limitedBody(max, "recording_too_large");
