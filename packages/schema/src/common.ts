// Small building blocks shared by the file formats (02, "Conventions").
import { z } from "zod";
import { Lang } from "./lang.ts";

/** Lowercase hex sha256. */
export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/** ISO 8601 UTC timestamp, as written in files. */
export const Timestamp = z.iso.datetime();

/** A path inside a series folder, `/`-separated, never leaving it. */
export const LibraryPath = z
  .string()
  .regex(/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[^\\]+$/)
  .meta({ title: "LibraryPath" });

/** A media file of the series folder: `media/<kind>/<name>`, e.g. `media/video/A1_E0_L1_F1_sd.mp4`. */
export const MediaPath = LibraryPath.regex(/^media\/[^/]+\/.+$/).meta({
  id: "MediaPath",
  title: "MediaPath",
});
export type MediaPath = z.infer<typeof MediaPath>;

/** Text per learner language, e.g. `{ en: "…", ru: "…" }`. */
export const LocalizedText = z.record(Lang, z.string());
export type LocalizedText = z.infer<typeof LocalizedText>;

/** The integer `format` every stored file carries; bumped on breaking changes (02). */
export const format = <const V extends number>(version: V) => z.literal(version);

/** Media attached to a lesson, exercise, item or option. */
export const Media = z
  .object({
    image: MediaPath.optional(),
    audio: MediaPath.optional(),
    video: MediaPath.optional(),
  })
  .meta({ id: "Media" });
export type Media = z.infer<typeof Media>;
