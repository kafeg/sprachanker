// Catalog entries declared statically by providers (01, "Catalog").
import { z } from "zod";
import { CourseKey, SeriesKey } from "./keys.ts";
import { EditionId, Lang } from "./lang.ts";

export const CourseKind = z.enum(["course", "exam"]);
export type CourseKind = z.infer<typeof CourseKind>;

export const CefrLevel = z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]);

export const Licence = z.object({
  /** SPDX id for open licences (`CC-BY-4.0`); `proprietary-personal-use` for closed sources. */
  id: z.string().min(1),
  attribution: z.string().min(1),
  url: z.url(),
});
export type Licence = z.infer<typeof Licence>;

export const CatalogEntry = z.object({
  course: CourseKey,
  series: SeriesKey,
  kind: CourseKind,
  level: CefrLevel.optional(),
  target: Lang,
  editions: z.array(z.object({ id: EditionId, source: Lang })).min(1),
  licence: Licence,
  homepage: z.url(),
  /** Rough download size of one edition with media, for the UI. */
  approxSizeMb: z.number().int().nonnegative(),
});
export type CatalogEntry = z.infer<typeof CatalogEntry>;
