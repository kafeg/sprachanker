// Range responses for media (video seeking, audio): runtime-agnostic over Blob; request bodies limited
// (JSON, audio) or announced (files: deck packages, profile files).
import type { ErrorCode } from "@sprachanker/schema";
import { bodyLimit } from "hono/body-limit";

/** A Blob that can be sliced (Bun.file, Node's Blob, the web Blob). */
export type MediaBlob = Blob & { slice(start: number, end?: number): Blob };

/** The type a media file is served as, by its extension only: what browsers play or
 *  show, never a document that runs scripts (HTML, SVG, XML, JavaScript) — anything else is bytes to
 *  save. Library media, a deck's (an .apkg's names are anyone's), recordings. */
const MEDIA_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  oga: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  vtt: "text/vtt",
  srt: "text/plain; charset=utf-8",
  pdf: "application/pdf",
};
export const mediaType = (name: string) =>
  MEDIA_TYPES[/\.([^./]+)$/.exec(name)?.[1]?.toLowerCase() ?? ""] ?? "application/octet-stream";

/** A media file opened on its own (not as an `<img>`, `<video>`) is a document of our origin: it runs
 *  nothing and loads nothing. PDFs are left out: browsers show them with a viewer that a sandbox
 *  refuses (Chrome blocks it in a sandboxed document) — a PDF is only ever shown by that viewer,
 *  whose scripts never run on our origin; the app's own CSP applies to it (host.ts). */
const MEDIA_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/** A media file's response, its type by `name`'s extension (`mediaType`), with ranges. */
export function blobResponse(blob: MediaBlob, range: string | undefined, name: string): Response {
  const type = mediaType(name);
  const headers: Record<string, string> = {
    "accept-ranges": "bytes",
    "content-type": type,
    "x-content-type-options": "nosniff",
    "cache-control": "private, max-age=86400",
    ...(type === "application/pdf" ? {} : { "content-security-policy": MEDIA_CSP }),
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

/** The headers of a file downloaded under its own name (a zip: a profile file, a course bundle), its
 *  length known before it is streamed. */
export const attachment = (file: { fileName: string; bytes: number }) => ({
  "content-type": "application/zip",
  "content-length": String(file.bytes),
  "content-disposition": `attachment; filename="${file.fileName.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
  "cache-control": "no-store",
});

/** The largest body of a request that sends JSON (every API route but those taking files). */
export const JSON_BODY_MAX = 1024 * 1024;

/** A request body of audio up to `max` bytes. */
export const audioBody = (max: number) => limitedBody(max, "recording_too_large");
