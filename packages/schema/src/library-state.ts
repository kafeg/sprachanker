// What the importers and the server keep beside a series' content: the media
// index (`media.json`), the key map (`keys.json`) and a download's marker (`.downloads/<course>.json`).
// Their own state, not content: checked when read, no `format` (one that does not read stops the import,
// a marker cut short reads as an interrupted download).
import { z } from "zod";
import { MediaPath, Sha256 } from "./common.ts";

export const MediaKind = z.enum(["audio", "image", "video", "subtitles", "pdf"]);
export type MediaKind = z.infer<typeof MediaKind>;

/** The extensions a media file of each kind may have, lower case: what
 *  browsers play or show — never a document that runs scripts (HTML, SVG, XML). Goethe's recordings
 *  are MP4 audio. */
export const MEDIA_EXTENSIONS: Record<MediaKind, readonly string[]> = {
  audio: ["mp3", "m4a", "aac", "ogg", "opus", "wav", "mp4"],
  image: ["jpg", "jpeg", "png", "webp", "gif"],
  video: ["mp4", "webm", "m4v"],
  subtitles: ["vtt", "srt"],
  pdf: ["pdf"],
};

/** Windows' device names, with any extension. */
const DEVICE = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$/i;
const NAME_BYTES = 255;

const utf8Bytes = (text: string) => {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
};

/** A file or folder name every disk takes as it is: no separator, control character or
 *  character Windows refuses (`<>:"|?*`), not `.` or `..`, no trailing dot or space, no device name
 *  (CON, NUL, …), at most 255 bytes (UTF-8). */
export function portableName(name: string) {
  return (
    name !== "" &&
    name !== "." &&
    name !== ".." &&
    !/[\\/<>:"|?*\p{Cc}]/u.test(name) &&
    !/[. ]$/.test(name) &&
    !DEVICE.test(name) &&
    utf8Bytes(name) <= NAME_BYTES
  );
}

/** A media file as the media store keeps it, `<kind>/<name>` under `media/`: a portable name with an
 *  extension of its kind's. */
export function storableMedia(path: string) {
  const [kind, name, ...rest] = path.split("/");
  const parsed = MediaKind.safeParse(kind);
  if (!parsed.success || name === undefined || rest.length || !portableName(name)) return false;
  const dot = name.lastIndexOf(".");
  return dot > 0 && MEDIA_EXTENSIONS[parsed.data].includes(name.slice(dot + 1));
}

/** A source URL's stored file (path, sha256 and size for integrity checks), or why it is not. */
const MediaIndexEntry = z.union([
  z.strictObject({
    kind: MediaKind,
    path: MediaPath,
    sha256: Sha256,
    size: z.number().int().nonnegative(),
    mime: z.string(),
  }),
  z.strictObject({ kind: MediaKind, error: z.string() }),
]);

/** `media.json`: every media URL a series references, by URL. */
export const MediaIndex = z.record(z.string(), MediaIndexEntry);
export type MediaIndex = z.infer<typeof MediaIndex>;

/** `keys.json`: by scope (a course's unit, a lesson), each source id's number. */
export const KeyMapFile = z.record(z.string(), z.record(z.string(), z.number().int().positive()));
export type KeyMapFile = z.infer<typeof KeyMapFile>;

/** A download's marker: written when it starts; `failed` once it ended with media of the course
 *  missing; `error` when it stopped with an error (then it waits for the learner, not resumed). */
export const DownloadMarker = z.strictObject({
  startedAt: z.number(),
  failed: z.number().int().positive().optional(),
  error: z.string().optional(),
});
export type DownloadMarker = z.infer<typeof DownloadMarker>;
