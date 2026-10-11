// Our corrections of DW's own errors in learner-language texts (03, research "source errors").
import {
  type CourseKey,
  ExerciseKey,
  ItemRef,
  type LocaleLesson,
  lessonOf,
  parseLessonKey,
} from "@sprachanker/schema";
import { z } from "zod";
import data from "./corrections.json" with { type: "json" };

const fix = {
  exercise: ExerciseKey,
  /** The source's text as normalised: the exact phrase replaced, never more of it. */
  from: z.string().min(1),
  /** Ours; null drops the whole field (a box that gives the answers away). */
  to: z.string().nullable(),
  why: z.string().min(1),
};

/** A text of an exercise, or of one of its items. */
export const Correction = z.union([
  z.strictObject({ ...fix, field: z.enum(["title", "instructionHtml", "textHtml"]) }),
  z.strictObject({ ...fix, item: ItemRef, field: z.enum(["prompt", "hintHtml"]) }),
]);
export type Correction = z.infer<typeof Correction>;

export const CORRECTIONS: readonly Correction[] = z.array(Correction).parse(data);

/** How a correction is named in the report. */
const correctionName = (c: Correction) => `${c.exercise}${"item" in c ? c.item : ""} ${c.field}`;

/** Applies to a lesson's locale texts the corrections whose `from` is there (a source fixed since
 *  is left alone); returns those applied. */
function correct(locale: LocaleLesson, corrections: readonly Correction[]): Correction[] {
  return corrections.filter((c) => {
    const exercise = locale.exercises[c.exercise];
    const owner = ("item" in c ? exercise?.items[c.item] : exercise) as
      | Record<string, unknown>
      | undefined;
    const text = owner?.[c.field];
    // Not there, or already as corrected (a `to` that holds its `from` is not applied twice).
    if (!owner || typeof text !== "string" || !text.includes(c.from)) return false;
    if (c.to?.includes(c.from) && text.includes(c.to)) return false;
    if (c.to !== null) owner[c.field] = text.replaceAll(c.from, c.to);
    else delete owner[c.field];
    if ("item" in c && exercise && !Object.keys(owner).length) delete exercise.items[c.item];
    return true;
  });
}

/** A course's corrections applied lesson by lesson; those never applied are stale (reported). */
export function courseCorrections(course: CourseKey, all: readonly Correction[] = CORRECTIONS) {
  const mine = all.filter((c) => parseLessonKey(lessonOf(c.exercise)).course === course);
  const applied = new Set<Correction>();
  return {
    lesson(locale: LocaleLesson) {
      for (const c of correct(locale, mine)) applied.add(c);
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
