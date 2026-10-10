// Stable content keys (02, "Keys and identity"). Keys are built and parsed only here.
import { z } from "zod";
import type { Lang } from "./lang.ts";

const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const NN = "\\d{2,}";
const N = "[1-9]\\d*";
const LANG = "[a-z]{2,3}";
const LEMMA_PART = "[\\p{Ll}\\p{Lo}\\p{Lm}\\p{M}\\p{Nd}]+";
const LEMMA = `${LEMMA_PART}(?:-${LEMMA_PART})*`;

export const PARTS_OF_SPEECH = ["noun", "verb", "adj", "phrase", "word"] as const;
export const PartOfSpeech = z.enum(PARTS_OF_SPEECH);
export type PartOfSpeech = z.infer<typeof PartOfSpeech>;

/** Grammatical gender of a noun; `pl` = plural-only noun (die Eltern). */
export const Gender = z.enum(["m", "f", "n", "pl"]);
export type Gender = z.infer<typeof Gender>;

const SERIES = `${SLUG}\\.${SLUG}`;
const COURSE = `${SERIES}/${SLUG}`;
const LESSON = `${COURSE}/${NN}-${NN}`;
const EXERCISE = `${LESSON}/(?:ex|x)-${NN}`;
const EXAM = `${COURSE}/exam-${SLUG}`;

function key<const B extends string>(brand: B, pattern: string, description: string) {
  return z
    .string()
    .regex(new RegExp(`^(?:${pattern})$`, "u"))
    .meta({ id: brand, title: brand, description })
    .brand<B>();
}

export const SeriesKey = key("SeriesKey", SERIES, "<publisher>.<series>");
/** A course's id within its series (the `<course>` of a course key). */
export const CourseSlug = z.string().regex(new RegExp(`^${SLUG}$`));
export const CourseKey = key("CourseKey", COURSE, "<series>/<course>");
export const UnitKey = key("UnitKey", `${COURSE}/u${NN}`, "<course>/u<NN>");
export const LessonKey = key("LessonKey", LESSON, "<course>/<unit NN>-<lesson NN>");
export const ExerciseKey = key(
  "ExerciseKey",
  EXERCISE,
  "<lesson>/ex-<NN> (source order) or <lesson>/x-<NN> (ours)",
);
export const ItemKey = key("ItemKey", `${EXERCISE}#${N}`, "<exercise>#<n>, 1-based");
export const ExamKey = key("ExamKey", EXAM, "<course>/exam-<slug>");
export const ExamSectionKey = key("ExamSectionKey", `${EXAM}/s-${SLUG}`, "<exam>/s-<slug>");
export const ExamItemKey = key("ExamItemKey", `${EXAM}/q-${SLUG}`, "<exam>/q-<id>");
export const GoalKey = key(
  "GoalKey",
  `${LESSON}/goal-${N}|${COURSE}/goal-${SLUG}`,
  "<lesson>/goal-<n> or <course>/goal-<slug>",
);
export const VocabKey = key(
  "VocabKey",
  `${LESSON}/v-${LEMMA}(?:\\.(?:[2-9]|[1-9]\\d+))?`,
  "<lesson>/v-<lemma-slug>[.<n>]; .<n> (n ≥ 2) tells apart entries with the same lemma in a lesson",
);
export const LexemeKey = key(
  "LexemeKey",
  `lex:${LANG}:${LEMMA}:(?:${PARTS_OF_SPEECH.join("|")})(?::(?:m|f|n|pl))?`,
  "lex:<lang>:<lemma-slug>:<pos>[:<gender>]",
);
export const RuleId = key("RuleId", `${LANG}\\.${SLUG}\\.${SLUG}`, "<lang>.<area>.<slug>");
export const SceneKey = key("SceneKey", `${SERIES}/scene-${SLUG}`, "<series>/scene-<slug>");

export type SeriesKey = z.infer<typeof SeriesKey>;
export type CourseKey = z.infer<typeof CourseKey>;
export type UnitKey = z.infer<typeof UnitKey>;
export type LessonKey = z.infer<typeof LessonKey>;
export type ExerciseKey = z.infer<typeof ExerciseKey>;
export type ItemKey = z.infer<typeof ItemKey>;
export type ExamKey = z.infer<typeof ExamKey>;
export type ExamSectionKey = z.infer<typeof ExamSectionKey>;
export type ExamItemKey = z.infer<typeof ExamItemKey>;
export type GoalKey = z.infer<typeof GoalKey>;
export type VocabKey = z.infer<typeof VocabKey>;
export type LexemeKey = z.infer<typeof LexemeKey>;
export type RuleId = z.infer<typeof RuleId>;
export type SceneKey = z.infer<typeof SceneKey>;

const nn = (n: number) => String(n).padStart(2, "0");

/** NFC, lowercase, punctuation removed, spaces and hyphens → `-`; letters of any script kept. */
export function lemmaSlug(lemma: string): string {
  return lemma
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{Nd}\s-]/gu, "")
    .trim()
    .replace(/[\s-]+/gu, "-")
    .replace(/^-|-$/g, "");
}

export const seriesKey = (publisher: string, series: string) =>
  SeriesKey.parse(`${publisher}.${series}`);
export const courseKey = (series: SeriesKey, course: string) =>
  CourseKey.parse(`${series}/${course}`);
export const unitKey = (course: CourseKey, unit: number) => UnitKey.parse(`${course}/u${nn(unit)}`);
export const lessonKey = (course: CourseKey, unit: number, lesson: number) =>
  LessonKey.parse(`${course}/${nn(unit)}-${nn(lesson)}`);
export const exerciseKey = (lesson: LessonKey, n: number, origin: "source" | "ours" = "source") =>
  ExerciseKey.parse(`${lesson}/${origin === "source" ? "ex" : "x"}-${nn(n)}`);
export const itemKey = (exercise: ExerciseKey, n: number) => ItemKey.parse(`${exercise}#${n}`);
export const examKey = (course: CourseKey, slug: string) => ExamKey.parse(`${course}/exam-${slug}`);
export const examSectionKey = (exam: ExamKey, slug: string) =>
  ExamSectionKey.parse(`${exam}/s-${slug}`);
export const examItemKey = (exam: ExamKey, id: string) => ExamItemKey.parse(`${exam}/q-${id}`);
export const lessonGoalKey = (lesson: LessonKey, n: number) => GoalKey.parse(`${lesson}/goal-${n}`);
export const vocabKey = (lesson: LessonKey, lemma: string, n = 1) =>
  VocabKey.parse(`${lesson}/v-${lemmaSlug(lemma)}${n > 1 ? `.${n}` : ""}`);
export const lexemeKey = (lang: Lang, lemma: string, pos: PartOfSpeech, gender?: Gender) =>
  LexemeKey.parse(`lex:${lang}:${lemmaSlug(lemma)}:${pos}${gender ? `:${gender}` : ""}`);
export const ruleId = (lang: Lang, area: string, slug: string) =>
  RuleId.parse(`${lang}.${area}.${slug}`);
export const sceneKey = (series: SeriesKey, slug: string) =>
  SceneKey.parse(`${series}/scene-${slug}`);

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
/** Id of a choice option by its 0-based position: `a`…`z`, then `aa`…`zz` (`OptionId`). */
export function optionId(i: number): string {
  if (!Number.isInteger(i) || i < 0 || i >= 26 + 26 * 26)
    throw new RangeError(`no option id for position ${i}`);
  if (i < 26) return LETTERS[i] as string;
  const n = i - 26;
  return `${LETTERS[Math.floor(n / 26)]}${LETTERS[n % 26]}`;
}

/** A course key's id inside its series: `dw.nicos-weg/a1` → `a1` (its folder in the library). */
export const courseIdOf = (course: CourseKey | string) => course.slice(course.lastIndexOf("/") + 1);

/**
 * The parts of a lesson key: `dw.nicos-weg/a1/02-03` → course `dw.nicos-weg/a1`, its id `a1`, the
 * lesson's name `02-03` (its file name and URL segment), unit 2 and lesson 3.
 */
export function parseLessonKey(key: LessonKey | string): {
  course: CourseKey;
  courseId: string;
  name: string;
  unit: number;
  lesson: number;
} {
  const slash = key.lastIndexOf("/");
  const course = key.slice(0, slash) as CourseKey;
  const name = key.slice(slash + 1);
  const [unit = "", lesson = ""] = name.split("-");
  return {
    course,
    courseId: courseIdOf(course),
    name,
    unit: Number(unit),
    lesson: Number(lesson),
  };
}

/** The parts of an exam key: `bamf.lid/lid/exam-test` → course `bamf.lid/lid`, its id `lid`, the
 *  exam's slug `test` (its file name and URL segment). */
export function parseExamKey(key: ExamKey | string): {
  course: CourseKey;
  courseId: string;
  slug: string;
} {
  const slash = key.lastIndexOf("/");
  const course = key.slice(0, slash) as CourseKey;
  return { course, courseId: courseIdOf(course), slug: key.slice(slash + 1).replace(/^exam-/, "") };
}

/** The series a course, lesson, exercise, item or exam key belongs to (every such key starts with
 *  it). */
export const seriesOf = (
  key: CourseKey | LessonKey | ExerciseKey | ItemKey | ExamKey | ExamItemKey,
) => key.slice(0, key.indexOf("/")) as SeriesKey;

/** The lesson an exercise belongs to. */
export const lessonOf = (exercise: ExerciseKey) =>
  exercise.slice(0, exercise.lastIndexOf("/")) as LessonKey;

/** The exercise an item belongs to, and the item's 1-based position. */
export function parseItemKey(key: ItemKey): { exercise: ExerciseKey; n: number } {
  const hash = key.lastIndexOf("#");
  return { exercise: key.slice(0, hash) as ExerciseKey, n: Number(key.slice(hash + 1)) };
}

export function parseLexemeKey(key: LexemeKey): {
  lang: Lang;
  lemma: string;
  pos: PartOfSpeech;
  gender?: Gender;
} {
  const [, lang = "", lemma = "", pos, gender] = key.split(":");
  return {
    lang,
    lemma,
    pos: PartOfSpeech.parse(pos),
    ...(gender ? { gender: Gender.parse(gender) } : {}),
  };
}
