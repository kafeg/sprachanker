// Learner-language texts of one edition, at the same key paths as the canonical files (02).
import { z } from "zod";
import { format } from "./common.ts";
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
export const LocaleItem = z.object({
  prompt: z.string().optional(),
  /** Help or tip shown with the item ("Справка: …"). */
  hintHtml: z.string().optional(),
  /** Option, part or match-entry texts in the learner's language, by id. */
  options: z.record(OptionId, z.string()).optional(),
  /** Image descriptions for accessibility, by option id or `item`. */
  alt: z.record(z.string(), z.string()).optional(),
  gaps: z.record(GapId, z.string()).optional(),
});

export const LocaleExercise = z.object({
  sourceId: SourceId,
  title: z.string().optional(),
  instructionHtml: z.string().optional(),
  /** Learner-language stimulus text. */
  textHtml: z.string().optional(),
  items: z.record(ItemRef, LocaleItem),
});

/** Grammar, culture or script page of a lesson; may mix languages. */
export const Tab = z.object({
  sourceId: SourceId.optional(),
  title: z.string(),
  bodyHtml: z.string(),
});

/** `locale/<edition>/<course>/course.json` */
export const LocaleCourse = z.object({
  format: format(LOCALE_FORMAT),
  edition: EditionId,
  course: CourseKey,
  sourceId: SourceId,
  title: z.string().min(1),
  descriptionHtml: z.string().optional(),
  units: z.record(UnitKey, z.object({ title: z.string() })),
  goals: z.record(GoalKey, z.object({ text: z.string().min(1) })),
});
export type LocaleCourse = z.infer<typeof LocaleCourse>;

/** `locale/<edition>/<course>/lessons/<NN>-<NN>.json` */
export const LocaleLesson = z.object({
  format: format(LOCALE_FORMAT),
  edition: EditionId,
  lesson: LessonKey,
  sourceId: SourceId,
  title: z.string().min(1),
  synopsisHtml: z.string().optional(),
  exercises: z.record(ExerciseKey, LocaleExercise),
  vocab: z.record(VocabKey, z.object({ translation: z.string().min(1) })),
  tabs: z.object({
    grammar: z.array(Tab),
    culture: z.array(Tab),
    script: Tab.optional(),
  }),
});
export type LocaleLesson = z.infer<typeof LocaleLesson>;

/** `locale/<edition>/<course>/exams/<slug>.json` */
export const LocaleExam = z.object({
  format: format(LOCALE_FORMAT),
  edition: EditionId,
  exam: ExamKey,
  title: z.string().min(1),
  sections: z.record(ExamSectionKey, z.object({ title: z.string() })),
  thresholds: z.record(z.string(), z.object({ title: z.string() })),
  items: z.record(ExamItemKey, LocaleItem),
});
export type LocaleExam = z.infer<typeof LocaleExam>;
