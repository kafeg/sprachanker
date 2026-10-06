// Lesson progress derived from runs and events (04, "Learner model"; 05, "Derived state"). The server and
// the web player both read a run through these functions, so the course map, the lesson plan and the
// summary always agree on what is done.
import type { Lesson, LessonResult, Outcome, Run, StoredEvent } from "@sprachanker/schema";

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

/**
 * An exercise's state in a run: not worked yet (undefined), `done` (worked, nothing scored — rated,
 * unscored or skipped), `correct` (every scored first attempt right, nothing skipped) or `wrong`.
 */
export function exerciseState(r: ExerciseResult | undefined) {
  if (!r) return undefined;
  const scored = Object.values(r.first).filter((o) => o.result !== "unscored");
  if (!scored.length) return Object.keys(r.last).length || r.skipped.length ? "done" : undefined;
  return scored.every((o) => o.result === "correct") && !r.skipped.length ? "correct" : "wrong";
}
export type ExerciseState = NonNullable<ReturnType<typeof exerciseState>>;

/** Exercises of the lesson worked in the run; a run can be completed only when all of them are. */
export function lessonCoverage(lesson: Lesson, results: Record<string, ExerciseResult>) {
  const total = lesson.pages.length;
  const left = lesson.pages.flatMap(({ exercise }, i) =>
    exerciseState(results[exercise.key]) ? [] : [i],
  );
  return { worked: total - left.length, total, complete: !left.length, firstLeft: left[0] };
}

/** Score of a lesson run: mean first-attempt score of its scored items (05, "Lifecycle"). */
export function lessonResult(events: StoredEvent[]): LessonResult {
  const first = Object.values(exerciseResults(events)).flatMap((r) => Object.values(r.first));
  const scored = first.filter((o) => o.result !== "unscored");
  const score = scored.length ? scored.reduce((sum, o) => sum + o.score, 0) / scored.length : 0;
  return { score, scored: scored.length, answered: first.length };
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
