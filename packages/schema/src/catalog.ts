// What a catalog says about a course (01, "Catalog"): its kind, level and licence (manifest.ts).
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
