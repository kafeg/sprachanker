// Lesson progress derived from runs and events (04, "Learner model"; 05, "Derived state"). The server and
// the web player both read a run through these functions, so the course map, the lesson plan and the
// summary always agree on what is done.
import {
  type AnsweredPayload,
  type Exercise,
  type ItemKey,
  type Lesson,
  type LessonResult,
  type LocaleExercise,
  type LocaleLesson,
  type Outcome,
  parseItemKey,
  type Run,
  type TypedEvent,
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
  /** Items skipped before their first answer: the skip was their first attempt (an answer after it
   *  is shown, but does not count). */
  skippedFirst: string[];
}

const exerciseOf = (itemKey: string) => parseItemKey(itemKey as ItemKey).exercise;

/** Answers and skips of a run per exercise key. */
export function exerciseResults(events: TypedEvent[]): Record<string, ExerciseResult> {
  const results: Record<string, ExerciseResult> = {};
  for (const e of events) {
    if ((e.type !== "answered" && e.type !== "item_skipped") || !e.itemKey) continue;
    results[exerciseOf(e.itemKey)] ??= { first: {}, last: {}, skipped: [], skippedFirst: [] };
    const r = results[exerciseOf(e.itemKey)] as ExerciseResult;
    if (e.type === "item_skipped") {
      if (!r.skipped.includes(e.itemKey)) r.skipped.push(e.itemKey);
      if (!(e.itemKey in r.last) && !r.skippedFirst.includes(e.itemKey))
        r.skippedFirst.push(e.itemKey);
      continue;
    }
    const { answer, outcome } = e.payload;
    // Only the first attempt counts (04); skipping an item first is its first attempt.
    if (outcome && !(e.itemKey in r.first) && !r.skippedFirst.includes(e.itemKey))
      r.first[e.itemKey] = outcome;
    r.last[e.itemKey] = { answer, outcome };
    r.skipped = r.skipped.filter((k) => k !== e.itemKey);
  }
  return results;
}

/** Items that would have been scored but were skipped at their first attempt (answered later or
 *  not): they count as wrong (score 0). */
const missed = (exercise: Exercise, r: ExerciseResult) =>
  [...new Set([...r.skipped, ...r.skippedFirst])].filter(
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
 * First attempts of one exercise's scored items in a run: `scored` counts them, a scored item skipped
 * without an answer included; `correct` those right; `sum` their scores; `answered` the items answered.
 */
export function firstTry(exercise: Exercise, r: ExerciseResult | undefined) {
  const out = { sum: 0, scored: 0, correct: 0, answered: 0 };
  if (!r) return out;
  for (const o of Object.values(r.first)) {
    out.answered++;
    if (o.result === "unscored") continue;
    out.scored++;
    out.sum += o.score;
    if (o.result === "correct") out.correct++;
  }
  out.scored += missed(exercise, r).length;
  return out;
}

/** The same over every exercise of the lesson (the summary, the lesson score). */
export function firstAttempts(lesson: Lesson, results: Record<string, ExerciseResult>) {
  const total = { sum: 0, scored: 0, correct: 0, answered: 0 };
  for (const { exercise } of lesson.pages) {
    const one = firstTry(exercise, results[exercise.key]);
    total.sum += one.sum;
    total.scored += one.scored;
    total.correct += one.correct;
    total.answered += one.answered;
  }
  return total;
}

/**
 * Score of a lesson run (05, "Lifecycle"): mean first-attempt score of its scored items, a scored item
 * skipped without an answer counting 0. `scored` counts those items, `answered` the items answered.
 */
export function lessonResult(lesson: Lesson, events: TypedEvent[]): LessonResult {
  const { sum, scored, answered } = firstAttempts(lesson, exerciseResults(events));
  return { score: scored ? sum / scored : 0, scored, answered };
}

/** What an item was answered at one attempt in a run (1 = its first answer), if it was. */
export function answerAt(
  events: TypedEvent[],
  itemKey: string,
  attempt: number,
): AnsweredPayload | undefined {
  const e = events.find(
    (e): e is Extract<TypedEvent, { type: "answered" }> =>
      e.type === "answered" && e.itemKey === itemKey && e.payload.attempt === attempt,
  );
  return e?.payload;
}

/**
 * A run's exercises as they were shown (05, "Lifecycle"): each exercise's snapshot from the first time
 * it was shown — by its key, so a page the lesson moved since still finds its own —, the lesson's
 * current exercise where none was kept; in the lesson's order (in the order shown when the lesson is
 * no longer installed).
 */
export function shownExercises(
  events: TypedEvent[],
  lesson?: Lesson | null,
  locale?: LocaleLesson | null,
): Array<{ pageIndex: number; exercise: Exercise; locale: LocaleExercise | null }> {
  const snapshots = new Map<
    string,
    { pageIndex: number; exercise: Exercise; locale: LocaleExercise | null }
  >();
  for (const e of events) {
    if (e.type !== "page_shown") continue;
    const { pageIndex, snapshot } = e.payload;
    if (snapshot && !snapshots.has(snapshot.exercise.key))
      snapshots.set(snapshot.exercise.key, {
        pageIndex,
        exercise: snapshot.exercise,
        locale: snapshot.locale ?? null,
      });
  }
  if (!lesson) return [...snapshots.values()].sort((a, b) => a.pageIndex - b.pageIndex);
  return lesson.pages.map(({ exercise }, pageIndex) => {
    const shown = snapshots.get(exercise.key);
    return {
      pageIndex,
      exercise: shown?.exercise ?? exercise,
      locale: shown ? shown.locale : (locale?.exercises[exercise.key] ?? null),
    };
  });
}

/** Page to continue a run on: the last exercise shown, where it is in the lesson now (its page
 *  number when it is no longer there, or the event names none). */
export function resumePage(events: TypedEvent[], lesson?: Lesson): number {
  let page = 0;
  for (const e of events) {
    if (e.type !== "page_shown") continue;
    const { pageIndex, exerciseKey } = e.payload;
    const now = exerciseKey
      ? (lesson?.pages.findIndex((p) => p.exercise.key === exerciseKey) ?? -1)
      : -1;
    page = now >= 0 ? now : pageIndex;
  }
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

/** Lessons done in a course and the lesson to go on with: the one worked on most recently, else the
 *  first not done yet. */
export function courseProgress(
  lessons: string[],
  progress: Record<string, LessonProgress | undefined>,
) {
  const active = lessons
    .filter((k) => progress[k]?.activeAt !== undefined)
    .sort((a, b) => (progress[b]?.activeAt ?? 0) - (progress[a]?.activeAt ?? 0))[0];
  const next = active ?? lessons.find((k) => !lessonDone(progress[k])) ?? lessons[0];
  const done = lessons.filter((k) => lessonDone(progress[k])).length;
  return {
    done,
    next: next ?? null,
    nextStarted: !!active,
    /** The course is begun (it belongs in "My courses"): a lesson done, or one in progress. */
    started: done > 0 || !!active,
  };
}

/** How an item went in a run (the Notebook's pass): its answers counted, skipped without one, and
 *  the attempt it was right at when the first was not. */
export function itemTries(
  events: TypedEvent[],
  result: ExerciseResult | undefined,
  itemKey: string,
) {
  const tries = events.filter((e) => e.type === "answered" && e.itemKey === itemKey).length;
  const right =
    tries > 1 &&
    answerAt(events, itemKey, 1)?.outcome.result !== "correct" &&
    result?.last[itemKey]?.outcome?.result === "correct";
  return {
    tries,
    skipped:
      !tries && !!(result?.skipped.includes(itemKey) || result?.skippedFirst.includes(itemKey)),
    rightAt: right ? tries : undefined,
  };
}
