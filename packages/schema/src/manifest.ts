// Series manifest `course.json` (02, "Manifest"). Written last, after normalise and verify.
import { z } from "zod";
import { CefrLevel, CourseKind, Licence } from "./catalog.ts";
import { format, LibraryPath, Sha256, Timestamp } from "./common.ts";
import { SeriesKey } from "./keys.ts";
import { EditionId, Lang } from "./lang.ts";

export const MANIFEST_FORMAT = 1;

export const ManifestFile = z.strictObject({
  sha256: Sha256,
  size: z.number().int().nonnegative(),
  /** Blobs only. */
  mime: z.string().optional(),
  sourceUrl: z.url().optional(),
  durationSec: z.number().nonnegative().optional(),
});

export const Manifest = z.strictObject({
  format: format(MANIFEST_FORMAT),
  series: SeriesKey,
  provider: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  providerVersion: z.string().min(1),
  title: z.string().min(1),
  licence: Licence,
  courses: z.array(
    z.strictObject({
      /** Course id inside the series (`a1`); the course key is `<series>/<id>`. */
      id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      kind: CourseKind,
      level: CefrLevel.optional(),
      target: Lang,
      editions: z.array(
        z.strictObject({
          id: EditionId,
          source: Lang,
          fetchedAt: Timestamp,
          contentVersion: Sha256,
        }),
      ),
    }),
  ),
  files: z.record(LibraryPath, ManifestFile),
});
export type Manifest = z.infer<typeof Manifest>;
