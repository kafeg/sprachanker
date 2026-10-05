// Language-independent course files: course index and lessons (02, "Canonical files").
import { z } from "zod";
import { BlobRef, format, LibraryPath } from "./common.ts";
import { Exercise } from "./exercise/index.ts";
import {
  CourseKey,
  ExamKey,
  Gender,
  GoalKey,
  LessonKey,
  LexemeKey,
  UnitKey,
  VocabKey,
} from "./keys.ts";

export const CANONICAL_FORMAT = 1;

/** `canonical/<course>/course.json` */
export const CourseIndex = z.object({
  format: format(CANONICAL_FORMAT),
  key: CourseKey,
  units: z.array(
    z.object({ key: UnitKey, order: z.number().int().nonnegative(), lessons: z.array(LessonKey) }),
  ),
  exams: z.array(ExamKey),
  goals: z.array(z.object({ key: GoalKey, lessons: z.array(LessonKey) })),
});
export type CourseIndex = z.infer<typeof CourseIndex>;

/** A word or phrase introduced by a lesson; its translation lives in the locale file. */
export const VocabEntry = z.object({
  key: VocabKey,
  lexeme: LexemeKey,
  /** Headword as the source shows it: "die Frau, die Frauen", "(etwas) studieren". */
  target: z.string().min(1),
  gender: Gender.optional(),
  /** Plural form with article, when the source gives one. */
  plural: z.string().optional(),
  /** Target-language forms: "studiert, studierte, hat studiert", "besser, am besten". */
  forms: z.string().optional(),
  /** Target-language usage note: "hier nur Singular". */
  note: z.string().optional(),
  audio: BlobRef.optional(),
  image: BlobRef.optional(),
});
export type VocabEntry = z.infer<typeof VocabEntry>;

/** Source content the provider could not map; listed in the import report (02). */
export const Unmapped = z.object({ path: LibraryPath, reason: z.string().min(1) });

/** `canonical/<course>/lessons/<NN>-<NN>.json` */
export const Lesson = z.object({
  format: format(CANONICAL_FORMAT),
  key: LessonKey,
  unit: UnitKey,
  order: z.number().int().nonnegative(),
  media: z.object({
    video: z
      .object({
        sd: BlobRef.optional(),
        hd: BlobRef.optional(),
        /** Variant with subtitles burned in. */
        subtitled: BlobRef.optional(),
        /** Target-language subtitle track (WebVTT). */
        subtitles: BlobRef.optional(),
      })
      .optional(),
    image: BlobRef.optional(),
  }),
  goals: z.array(GoalKey),
  pages: z.array(z.object({ exercise: Exercise })),
  vocab: z.array(VocabEntry),
  unmapped: z.array(Unmapped),
});
export type Lesson = z.infer<typeof Lesson>;
