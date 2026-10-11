// Language-independent course files: course index and lessons (02, "Canonical files").
import { z } from "zod";
import { format, LibraryPath, MediaPath } from "./common.ts";
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
/** Where a course comes from and on what terms (shown with the course; attribution in its locale). */
export const CourseSource = z.strictObject({
  publisher: z.string().min(1),
  /** The source's home page of the course. */
  url: z.url(),
  /** `free-access`: free to use online, no open licence (personal study only). */
  licence: z.enum(["cc-by-4.0", "public-domain", "free-access"]),
});
export type CourseSource = z.infer<typeof CourseSource>;

export const CourseIndex = z.strictObject({
  format: format(CANONICAL_FORMAT),
  key: CourseKey,
  source: CourseSource.optional(),
  units: z.array(z.strictObject({ key: UnitKey, lessons: z.array(LessonKey) })),
  exams: z.array(ExamKey),
  goals: z.array(z.strictObject({ key: GoalKey, lessons: z.array(LessonKey) })),
});
export type CourseIndex = z.infer<typeof CourseIndex>;

/** A course's lessons in course order: its units in turn. */
export const lessonOrder = (index: CourseIndex): LessonKey[] =>
  index.units.flatMap((u) => u.lessons);

/** A word or phrase introduced by a lesson; its translation lives in the locale file. */
export const VocabEntry = z.strictObject({
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
  /** Its pronunciation as the source writes it (IPA): "/keɪm/". */
  ipa: z.string().optional(),
  /** Example sentences in the target language; their translations are in the locale entry. */
  examples: z.array(z.string().min(1)).optional(),
  audio: MediaPath.optional(),
  image: MediaPath.optional(),
});
export type VocabEntry = z.infer<typeof VocabEntry>;

/** Source content the provider could not map; listed in the import report (02). */
export const Unmapped = z.strictObject({ path: LibraryPath, reason: z.string().min(1) });

/** `canonical/<course>/lessons/<NN>-<NN>.json` */
export const Lesson = z
  .strictObject({
    format: format(CANONICAL_FORMAT),
    key: LessonKey,
    unit: UnitKey,
    media: z.strictObject({
      video: z
        .strictObject({
          sd: MediaPath.optional(),
          hd: MediaPath.optional(),
          /** Target-language subtitle track (WebVTT). */
          subtitles: MediaPath.optional(),
          /** The episode's own still, shown until it plays. */
          poster: MediaPath.optional(),
        })
        .optional(),
      image: MediaPath.optional(),
      /** Lesson-level recording (Deutschtrainer: the lesson's words and phrases read aloud). */
      audio: MediaPath.optional(),
    }),
    goals: z.array(GoalKey),
    pages: z.array(z.strictObject({ exercise: Exercise })),
    vocab: z.array(VocabEntry),
    unmapped: z.array(Unmapped),
  })
  // A lesson's exercises and words each under their own key, under the lesson's (items: the
  // exercise's own check): a key met twice would let one's answers and cards stand for another's.
  .superRefine((lesson, ctx) => {
    for (const [what, keys] of [
      ["exercise", lesson.pages.map((p) => p.exercise.key)],
      ["word", lesson.vocab.map((v) => v.key)],
    ] as const) {
      const seen = new Set<string>();
      for (const key of keys) {
        if (seen.has(key))
          ctx.addIssue({ code: "custom", message: `${what} key ${key} met twice` });
        if (!key.startsWith(`${lesson.key}/`))
          ctx.addIssue({
            code: "custom",
            message: `${what} key ${key} not of lesson ${lesson.key}`,
          });
        seen.add(key);
      }
    }
  });
export type Lesson = z.infer<typeof Lesson>;

/** The lesson's exercise with this key, if the lesson (still) has it. */
export const findExercise = (lesson: Lesson, key: string) =>
  lesson.pages.find((p) => p.exercise.key === key)?.exercise;
