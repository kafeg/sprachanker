// A course's kind, level and licence: the licence in every course index (`source.licence`), kind and
// level in the planned manifest (manifest.ts; 02, "Manifest").
import { z } from "zod";

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
