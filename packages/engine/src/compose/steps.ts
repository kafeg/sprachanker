// The lesson plan as steps (04, "Lesson composition"): overview → words → a grammar step per grammar
// page → the exercises → a culture step per culture page → AI practice (while an assistant is set up)
// → summary. Built from what the normaliser put into the canonical and locale files, the same way for
// every course; what is done is read from the run's events.
import type { Lesson, LocaleLesson, StepId, StoredEvent } from "@sprachanker/schema";
import { type ExerciseResult, exerciseState } from "../learner/progress.ts";

export type LessonStep =
  | { kind: "overview" }
  | { kind: "words" }
  | { kind: "grammar"; index: number }
  | { kind: "exercise"; index: number }
  | { kind: "culture"; index: number }
  | { kind: "writing" }
  | { kind: "scene" }
  | { kind: "mistakes" }
  | { kind: "summary" };

export type PracticeKind = "writing" | "scene" | "mistakes";
/** AI practice in the order of the plan: going over the mistakes last, once the exercises are done. */
export const PRACTICE: PracticeKind[] = ["writing", "scene", "mistakes"];

/** A step's id: the kind, with the page index for grammar, culture and exercises. */
export const stepId = (step: LessonStep): string =>
  "index" in step ? `${step.kind}:${step.index}` : step.kind;

/** The lesson's steps; `practice`: the AI practice offered (none without an assistant). */
export function lessonSteps(
  lesson: Lesson,
  locale: LocaleLesson | null | undefined,
  practice: PracticeKind[] = [],
): LessonStep[] {
  const tabs = locale?.tabs ?? { grammar: [], culture: [] };
  return [
    { kind: "overview" },
    ...(lesson.vocab.length ? [{ kind: "words" } as const] : []),
    ...tabs.grammar.map((_, index) => ({ kind: "grammar", index }) as const),
    ...lesson.pages.map((_, index) => ({ kind: "exercise", index }) as const),
    ...tabs.culture.map((_, index) => ({ kind: "culture", index }) as const),
    ...PRACTICE.filter((k) => practice.includes(k)).map((kind) => ({ kind }) as const),
    { kind: "summary" },
  ];
}

/** Steps besides exercises recorded as done or skipped in the run (the latest record counts). */
export function stepsDone(events: StoredEvent[]): Map<StepId, "done" | "skipped"> {
  const out = new Map<StepId, "done" | "skipped">();
  for (const e of events) {
    if (e.type !== "step_done") continue;
    const { step, skipped } = e.payload as { step: StepId; skipped?: boolean };
    out.set(step, skipped ? "skipped" : "done");
  }
  return out;
}

/** A step's state in the run: undefined while it is still to do. */
export function stepState(
  step: LessonStep,
  lesson: Lesson,
  results: Record<string, ExerciseResult>,
  done: Map<StepId, "done" | "skipped">,
) {
  if (step.kind === "overview" || step.kind === "summary") return undefined;
  if (step.kind === "exercise") {
    const exercise = lesson.pages[step.index]?.exercise;
    return exercise ? exerciseState(exercise, results[exercise.key]) : undefined;
  }
  return done.get(stepId(step) as StepId);
}

/**
 * The steps worked in the run of those to do (every step but the overview and the summary); the run is
 * completed when all are done or skipped.
 */
export function planCoverage(
  steps: LessonStep[],
  lesson: Lesson,
  results: Record<string, ExerciseResult>,
  done: Map<StepId, "done" | "skipped">,
) {
  const todo = steps.flatMap((s, i) => (s.kind === "overview" || s.kind === "summary" ? [] : [i]));
  const left = todo.filter((i) => !stepState(steps[i] as LessonStep, lesson, results, done));
  return {
    worked: todo.length - left.length,
    total: todo.length,
    complete: !left.length,
    /** Index in `steps` of the first step still to do. */
    firstLeft: left[0],
  };
}
