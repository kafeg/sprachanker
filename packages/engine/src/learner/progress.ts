// Lesson progress derived from runs and events (04, "Learner model"; 05, "Derived state"). The server and
// the web player both read a run through these functions, so the course map, the lesson plan and the
// summary always agree on what is done.
import {
  type Exercise,
  type ItemKey,
  type Lesson,
  type LessonResult,
  type Outcome,
  parseItemKey,
  type Run,
  type StoredEvent,
} from "@sprachanker/schema";
import { itemScored } from "../check/index.ts";

export interface LessonProgress {
  /** What the lesson is now: `in_progress` while a run with work in it is open (also when the lesson is
   *  being done again), else `done` once a run was completed, else `new`. */
  status: "new" | "in_progress" | "done";
  /** Completed runs; more than 0 means the lesson counts as done for the course. */
  finishedRuns: number;
  /** Best score of finished runs that scored any item, 0..1; absent when none did (e.g. a lesson of
   *  words only). */
  bestScore?: number;
  activeRunId?: string;
  /** Time of the latest answer or skip in the active run. */
  activeAt?: number;
}

/** A lesson counts as done once any run of it was completed. */
export const lessonDone = (p: LessonProgress | undefined) => (p?.finishedRuns ?? 0) > 0;

export interface ExerciseResult {
  /** First-attempt outcomes by item key (they count for the score). */
  first: Record<string, Outcome>;
  /** The latest answer of each item, with its outcome: what the exercise shows when reopened. */
  last: Record<string, { answer: unknown; outcome?: Outcome }>;
  /** Items the learner moved on from without an answer (and has not answered since). */
  skipped: string[];
}

interface Answered {
  answer?: unknown;
  outcome?: Outcome;
}

const exerciseOf = (itemKey: string) => itemKey.slice(0, itemKey.lastIndexOf("#"));

/** Answers and skips of a run per exercise key. */
export function exerciseResults(events: StoredEvent[]): Record<string, ExerciseResult> {
  const results: Record<string, ExerciseResult> = {};
  for (const e of events) {
    if ((e.type !== "answered" && e.type !== "item_skipped") || !e.itemKey) continue;
    results[exerciseOf(e.itemKey)] ??= { first: {}, last: {}, skipped: [] };
    const r = results[exerciseOf(e.itemKey)] as ExerciseResult;
    if (e.type === "item_skipped") {
      if (!r.skipped.includes(e.itemKey)) r.skipped.push(e.itemKey);
      continue;
    }
    const { answer, outcome } = e.payload as Answered;
    if (outcome && !(e.itemKey in r.first)) r.first[e.itemKey] = outcome;
    r.last[e.itemKey] = { answer, outcome };
    r.skipped = r.skipped.filter((k) => k !== e.itemKey);
  }
  return results;
}

/** Items skipped without an answer that would have been scored: they count as wrong (score 0). */
const missed = (exercise: Exercise, r: ExerciseResult) =>
  r.skipped.filter(
    (k) => !(k in r.first) && itemScored(exercise, parseItemKey(k as ItemKey).n - 1),
  );

/**
 * An exercise's state in a run: not worked yet (undefined), `skipped` (moved on without an answer and
 * nothing in it is scored), `done` (answered, nothing scored — self-rated, a free answer without a
 * rubric), `correct` (every scored item right at the first attempt) or `wrong` (a mistake, or a
 * scored item skipped: skipping what is checked is not knowing it).
 */
export function exerciseState(exercise: Exercise, r: ExerciseResult | undefined) {
  if (!r) return undefined;
  const scored = Object.values(r.first).filter((o) => o.result !== "unscored");
  const skippedScored = missed(exercise, r);
  if (!scored.length && !skippedScored.length) {
    if (Object.keys(r.last).length) return "done";
    return r.skipped.length ? "skipped" : undefined;
  }
  return scored.every((o) => o.result === "correct") && !skippedScored.length ? "correct" : "wrong";
}
export type ExerciseState = NonNullable<ReturnType<typeof exerciseState>>;

/** Exercises of the lesson worked in the run; a run can be completed only when all of them are. */
export function lessonCoverage(lesson: Lesson, results: Record<string, ExerciseResult>) {
  const total = lesson.pages.length;
  const left = lesson.pages.flatMap(({ exercise }, i) =>
    exerciseState(exercise, results[exercise.key]) ? [] : [i],
  );
  return { worked: total - left.length, total, complete: !left.length, firstLeft: left[0] };
}

/**
 * Score of a lesson run (05, "Lifecycle"): mean first-attempt score of its scored items, a scored item
 * skipped without an answer counting 0. `scored` counts those items, `answered` the items answered.
 */
export function lessonResult(lesson: Lesson, events: StoredEvent[]): LessonResult {
  const results = exerciseResults(events);
  let sum = 0;
  let scored = 0;
  let answered = 0;
  for (const { exercise } of lesson.pages) {
    const r = results[exercise.key];
    if (!r) continue;
    for (const o of Object.values(r.first)) {
      answered++;
      if (o.result === "unscored") continue;
      scored++;
      sum += o.score;
    }
    scored += missed(exercise, r).length;
  }
  return { score: scored ? sum / scored : 0, scored, answered };
}

/** Page to continue a run on: the last page shown. */
export function resumePage(events: StoredEvent[]): number {
  let page = 0;
  for (const e of events)
    if (e.type === "page_shown") page = (e.payload as { pageIndex: number }).pageIndex;
  return page;
}

/**
 * Progress per lesson key over all lesson runs. `activity` gives, per active run, the time of its
 * latest answer or skip; active runs without any (a lesson opened or started over) are not progress.
 */
export function lessonProgress(
  runs: Run[],
  activity: ReadonlyMap<string, number>,
): Map<string, LessonProgress> {
  const out = new Map<string, LessonProgress>();
  for (const run of [...runs].sort((a, b) => a.startedAt - b.startedAt)) {
    if (run.kind !== "lesson" || !run.contextKey) continue;
    const p = out.get(run.contextKey) ?? { status: "new", finishedRuns: 0 };
    if (run.status === "finished") {
      p.finishedRuns++;
      if (run.result?.scored) p.bestScore = Math.max(p.bestScore ?? 0, run.result.score);
    } else if (run.status === "active" && activity.has(run.id)) {
      p.activeRunId = run.id;
      p.activeAt = activity.get(run.id);
    }
    out.set(run.contextKey, p);
  }
  for (const p of out.values()) {
    p.status = p.activeRunId ? "in_progress" : p.finishedRuns ? "done" : "new";
  }
  return out;
}
