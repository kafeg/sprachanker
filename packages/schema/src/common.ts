// Small building blocks shared by the file formats (02, "Conventions").
import { z } from "zod";
import { Lang } from "./lang.ts";

/** Lowercase hex sha256. */
export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/** Reference to a content-addressed blob in the library: `blob:sha256:<hash>`. */
export const BlobRef = z
  .string()
  .regex(/^blob:sha256:[0-9a-f]{64}$/)
  .meta({ id: "BlobRef", title: "BlobRef" });
export type BlobRef = z.infer<typeof BlobRef>;

/** ISO 8601 UTC timestamp, as written in files. */
export const Timestamp = z.iso.datetime();

/** A path inside a series folder, `/`-separated, never leaving it. */
export const LibraryPath = z
  .string()
  .regex(/^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[^\\]+$/)
  .meta({ title: "LibraryPath" });

/** Text per learner language, e.g. `{ en: "…", ru: "…" }`. */
export const LocalizedText = z.record(Lang, z.string());
export type LocalizedText = z.infer<typeof LocalizedText>;

/** The integer `format` every stored file carries; bumped on breaking changes (02). */
export const format = <const V extends number>(version: V) => z.literal(version);

/** Media attached to a lesson, exercise, item or option; all blobs. */
export const Media = z
  .object({
    image: BlobRef.optional(),
    audio: BlobRef.optional(),
    video: BlobRef.optional(),
  })
  .meta({ id: "Media" });
export type Media = z.infer<typeof Media>;
