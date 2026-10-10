// Learner-language texts of one edition, at the same key paths as the canonical files (02).
import { z } from "zod";
import { format, MediaPath } from "./common.ts";
import { GapId, OptionId } from "./exercise/index.ts";
import {
  CourseKey,
  ExamItemKey,
  ExamKey,
  ExamSectionKey,
  ExerciseKey,
  GoalKey,
  LessonKey,
  UnitKey,
  VocabKey,
} from "./keys.ts";
import { EditionId } from "./lang.ts";

export const LOCALE_FORMAT = 1;

/** Source id of the localised object in this edition; editions differ (02, "Keys and identity"). */
const SourceId = z.string().min(1);

/** Item reference inside an exercise: `#1`, `#2`… */
export const ItemRef = z.string().regex(/^#[1-9]\d*$/);

/** Learner-language strings of one item; every field mirrors a canonical one. */
export const LocaleItem = z.strictObject({
  prompt: z.string().optional(),
  /** Help or tip shown with the item ("Справка: …"). */
  hintHtml: z.string().optional(),
  /** Option, part or match-entry texts in the learner's language, by id. */
  options: z.record(OptionId, z.string()).optional(),
  /** Image descriptions for accessibility, by option id or `item`. */
  alt: z.record(z.string(), z.string()).optional(),
  gaps: z.record(GapId, z.string()).optional(),
  /** `respond` answered in the learner's language: its model answers. */
  reference: z.array(z.string().min(1)).optional(),
  /** An exam's open answer: its criteria named, and what each level means (best first). */
  criteria: z
    .record(
      z.string(),
      z.strictObject({ title: z.string(), levels: z.array(z.string()).optional() }),
    )
    .optional(),
});

export const LocaleExercise = z.strictObject({
  sourceId: SourceId,
  /** Absent when the source gives none (the player numbers the exercise), never empty. */
  title: z.string().min(1).optional(),
  instructionHtml: z.string().optional(),
  /** Learner-language stimulus text. */
  textHtml: z.string().optional(),
  items: z.record(ItemRef, LocaleItem),
});
export type LocaleExercise = z.infer<typeof LocaleExercise>;
export type LocaleItem = z.infer<typeof LocaleItem>;

/** Grammar, culture or script page of a lesson; may mix languages. Its title is the source's, when the
 *  source gives one (none: the app names the page by its kind). */
export const Tab = z.strictObject({
  sourceId: SourceId.optional(),
  title: z.string().optional(),
  bodyHtml: z.string(),
  /** A topic continued from an earlier lesson: the part it starts with here (2, 3, …). */
  part: z.number().int().min(2).optional(),
});
export type Tab = z.infer<typeof Tab>;

/** `locale/<edition>/<course>/course.json` */
export const LocaleCourse = z.strictObject({
  format: format(LOCALE_FORMAT),
  edition: EditionId,
  course: CourseKey,
  sourceId: SourceId,
  title: z.string().min(1),
  descriptionHtml: z.string().optional(),
  units: z.record(UnitKey, z.strictObject({ title: z.string() })),
  goals: z.record(GoalKey, z.strictObject({ text: z.string().min(1) })),
});
export type LocaleCourse = z.infer<typeof LocaleCourse>;

/** `locale/<edition>/<course>/lessons/<NN>-<NN>.json` */
export const LocaleLesson = z.strictObject({
  format: format(LOCALE_FORMAT),
  edition: EditionId,
  lesson: LessonKey,
  sourceId: SourceId,
  title: z.string().min(1),
  synopsisHtml: z.string().optional(),
  exercises: z.record(ExerciseKey, LocaleExercise),
  vocab: z.record(
    VocabKey,
    z.strictObject({
      translation: z.string().min(1),
      /** Translations of the entry's `examples`, in the same order. */
      examples: z.array(z.string()).optional(),
    }),
  ),
  tabs: z.strictObject({
    grammar: z.array(Tab),
    culture: z.array(Tab),
    script: Tab.optional(),
    /** Tasks to do outside the app (homework of the source) that have no answers to check. */
    homework: z.array(Tab).optional(),
  }),
  /** Printable material of this edition (script with vocabulary, worksheets). */
  downloads: z.array(z.strictObject({ title: z.string().min(1), path: MediaPath })),
});
export type LocaleLesson = z.infer<typeof LocaleLesson>;

/** `locale/<edition>/<course>/exams/<slug>.json` */
export const LocaleExam = z.strictObject({
  format: format(LOCALE_FORMAT),
  edition: EditionId,
  exam: ExamKey,
  title: z.string().min(1),
  sections: z.record(
    ExamSectionKey,
    z.strictObject({
      title: z.string(),
      instructions: z.string().optional(),
      /** Descriptions of its letters' pictures, by letter. */
      alt: z.record(z.string(), z.string()).optional(),
    }),
  ),
  /** The modules' titles ("Hören"). */
  modules: z.record(z.string(), z.strictObject({ title: z.string() })).optional(),
  thresholds: z.record(z.string(), z.strictObject({ title: z.string() })),
  items: z.record(ExamItemKey, LocaleItem),
});
export type LocaleExam = z.infer<typeof LocaleExam>;
