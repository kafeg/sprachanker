// Our corrections of DW's own errors: learner-language texts, German texts and grammar and culture
// pages (03, research "source errors").
import { fingerprint } from "@sprachanker/course-kit";
import {
  type CourseKey,
  ExerciseKey,
  findExercise,
  ItemRef,
  type Lesson,
  LessonKey,
  type LocaleLesson,
  lessonOf,
  parseLessonKey,
} from "@sprachanker/schema";
import { z } from "zod";
import data from "./corrections.json" with { type: "json" };

const phrase = {
  /** The source's text as normalised: the exact phrase replaced, never more of it. */
  from: z.string().min(1),
  why: z.string().min(1),
};
/** Ours; null drops the whole field (a box that gives the answers away). */
const fix = { exercise: ExerciseKey, ...phrase, to: z.string().nullable() };

export const Correction = z.union([
  /** A learner-language text of an exercise, or of one of its items. */
  z.strictObject({ ...fix, field: z.enum(["title", "instructionHtml", "textHtml"]) }),
  z.strictObject({ ...fix, item: ItemRef, field: z.enum(["prompt", "hintHtml"]) }),
  /** The German texts of an exercise, or of one of its items (the canonical file): the phrase
   *  replaced in each — text, prompts, options, gapped text, accepted and model answers alike. */
  z.strictObject({
    exercise: ExerciseKey,
    item: ItemRef.optional(),
    field: z.literal("canonical"),
    ...phrase,
    to: z.string(),
  }),
  /** A lesson's grammar or culture pages. */
  z.strictObject({
    lesson: LessonKey,
    tab: z.enum(["grammar", "culture"]),
    ...phrase,
    to: z.string(),
  }),
]);
export type Correction = z.infer<typeof Correction>;

export const CORRECTIONS: readonly Correction[] = z.array(Correction).parse(data);

/** How a correction is named in the report. */
export const correctionName = (c: Correction) =>
  "tab" in c ? `${c.lesson} ${c.tab}` : `${c.exercise}${("item" in c && c.item) || ""} ${c.field}`;

const courseOf = (c: Correction) =>
  parseLessonKey("tab" in c ? c.lesson : lessonOf(c.exercise)).course;

/** The text with the phrase replaced; undefined when it is not there or already as corrected (a
 *  `to` that holds its `from` is not applied twice). */
function replaced(text: string, c: { from: string; to: string }) {
  if (!text.includes(c.from) || (c.to.includes(c.from) && text.includes(c.to))) return undefined;
  return text.replaceAll(c.from, c.to);
}

/** Fields of an exercise and its items that hold target-language text (strings or lists of them). */
const TEXTS = new Set(["text", "prompt", "segments", "accepted", "reference", "anyOf"]);

/** The phrase replaced in every target-language text under a node (keys, ids and media untouched). */
function replaceTexts(node: object, c: { from: string; to: string }, texts = false): boolean {
  let changed = false;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === "string") {
      const out = texts || TEXTS.has(k) ? replaced(v, c) : undefined;
      if (out === undefined) continue;
      (node as Record<string, unknown>)[k] = out;
      changed = true;
    } else if (v && typeof v === "object" && k !== "media")
      changed = replaceTexts(v, c, Array.isArray(v) && TEXTS.has(k)) || changed;
  }
  return changed;
}

/** Whether the correction applied to the lesson (its phrase found and replaced). */
function apply(c: Correction, lesson: Lesson, locale: LocaleLesson): boolean {
  if ("tab" in c)
    return (c.lesson === locale.lesson ? locale.tabs[c.tab] : []).reduce((changed, tab) => {
      const out = replaced(tab.bodyHtml, c);
      if (out !== undefined) tab.bodyHtml = out;
      return out !== undefined || changed;
    }, false);
  if (c.field === "canonical") {
    const ex = findExercise(lesson, c.exercise);
    if (!ex) return false;
    const owner = c.item ? ex.items.find((it) => it.key === `${c.exercise}${c.item}`) : ex;
    if (!owner || !replaceTexts(owner, c)) return false;
    // Changed text, changed exercise (02, "Keys and identity").
    ex.fingerprint = fingerprint(ex);
    return true;
  }
  const exercise = locale.exercises[c.exercise];
  const owner = ("item" in c ? exercise?.items[c.item] : exercise) as
    | Record<string, unknown>
    | undefined;
  const text = owner?.[c.field];
  if (!owner || typeof text !== "string") return false;
  if (c.to === null) {
    if (!text.includes(c.from)) return false;
    delete owner[c.field];
  } else {
    const out = replaced(text, { from: c.from, to: c.to });
    if (out === undefined) return false;
    owner[c.field] = out;
  }
  if ("item" in c && exercise && !Object.keys(owner).length) delete exercise.items[c.item];
  return true;
}

/** A course's corrections applied lesson by lesson, each where its phrase is found (a source fixed
 *  since is left alone); those never applied are stale (reported). */
export function courseCorrections(course: CourseKey, all: readonly Correction[] = CORRECTIONS) {
  const mine = all.filter((c) => courseOf(c) === course);
  const applied = new Set<Correction>();
  return {
    lesson(out: { lesson: Lesson; locale: LocaleLesson }) {
      for (const c of mine) if (apply(c, out.lesson, out.locale)) applied.add(c);
    },
    report: () =>
      mine.length
        ? {
            applied: applied.size,
            stale: mine.filter((c) => !applied.has(c)).map(correctionName),
          }
        : undefined,
  };
}
