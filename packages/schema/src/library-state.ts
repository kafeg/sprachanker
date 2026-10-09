// What the importers and the server keep beside a series' content (02, "Library layout"): the media
// index (`media.json`), the key map (`keys.json`) and a download's marker (`.downloads/<course>.json`).
// Their own state, not content: checked when read, no `format` (one that does not read stops the import,
// a marker cut short reads as an interrupted download).
import { z } from "zod";
import { MediaPath, Sha256 } from "./common.ts";

export const MediaKind = z.enum(["audio", "image", "video", "subtitles", "pdf"]);
export type MediaKind = z.infer<typeof MediaKind>;

/** A source URL's stored file (path, sha256 and size for integrity checks), or why it is not. */
export const MediaIndexEntry = z.union([
  z.strictObject({
    kind: MediaKind,
    path: MediaPath,
    sha256: Sha256,
    size: z.number().int().nonnegative(),
    mime: z.string(),
  }),
  z.strictObject({ kind: MediaKind, error: z.string() }),
]);
export type MediaIndexEntry = z.infer<typeof MediaIndexEntry>;

/** `media.json`: every media URL a series references, by URL. */
export const MediaIndex = z.record(z.string(), MediaIndexEntry);
export type MediaIndex = z.infer<typeof MediaIndex>;

/** `keys.json`: by scope (a course's unit, a lesson), each source id's number (02, "Keys"). */
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
