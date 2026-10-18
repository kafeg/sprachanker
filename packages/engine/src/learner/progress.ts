// Lesson progress derived from runs and events. The server and
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
  type SpokenCheck,
  type TypedEvent,
} from "@sprachanker/schema";
import { checkItem, type HeardTexts, itemScored } from "../check/index.ts";

export interface LessonProgress {
  /** What the lesson is now: `in_progress` while a run with work in it is open (also when the lesson is
   *  being done again), else `done` once a run was completed, else `new`. */
  status: "new" | "in_progress" | "done";
  /** Completed runs; more than 0 means the lesson counts as done for the course. */
  finishedRuns: number;
  /** When it was first done: the earliest end of a completed run. */
  doneAt?: number;
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

/** A model's verdict on an answer said aloud, as an item's result. */
export const SPOKEN_RESULT: Record<SpokenCheck["verdict"], "correct" | "partial" | "wrong"> = {
  good: "correct",
  minor_errors: "partial",
  major_errors: "wrong",
  off_task: "wrong",
};

/** The model's checks of spoken answers in a run, by item and what was heard; the latest counts. */
export function spokenChecks(events: TypedEvent[]) {
  const checks = new Map<string, SpokenCheck>();
  for (const e of events)
    if (e.type === "llm_verdict" && e.itemKey && e.payload.task === "speaking")
      checks.set(`${e.itemKey}\n${e.payload.input}`, e.payload.result);
  return checks;
}

/** What was heard of an answer said aloud, if anything. */
const transcriptOf = (answer: unknown) => {
  const t = (answer as { transcript?: unknown } | undefined)?.transcript;
  return typeof t === "string" ? t : undefined;
};

/** What answers said aloud are judged by as a run is read: the language they are said in, the
 *  source's answers as heard (by media path), and the exercise each was given to. */
export interface SpokenJudge {
  lang: string;
  heard?: HeardTexts;
  exercise(exerciseKey: string): Exercise | undefined;
}

/**
 * An answer said aloud as the engine judges it now: one kept with what was heard but without the
 * engine's verdict (`spoken`) — given before the engine judged such answers, or before it judged
 * them all — judged from what was heard and its item by the check a new answer gets (`checkItem`),
 * so runs from before are marked as runs now are. Any other outcome as it was kept.
 */
export function judgedOutcome(
  judge: SpokenJudge,
  itemKey: string,
  answer: unknown,
  outcome: Outcome,
): Outcome {
  if (outcome.result !== "unscored" || outcome.spoken || !transcriptOf(answer)?.trim())
    return outcome;
  const { exercise: key, n } = parseItemKey(itemKey as ItemKey);
  const exercise = judge.exercise(key);
  if (exercise?.type !== "speech_selfrate") return outcome;
  try {
    const now = checkItem(exercise, n - 1, answer, judge.lang, judge.heard);
    return now.spoken ? now : outcome;
  } catch {
    // An answer that no longer fits its item (the lesson changed): as it was kept.
    return outcome;
  }
}

/** A run's events with its answers said aloud judged (`judgedOutcome`) against the exercise as the
 *  run showed it (its snapshot), else as the lesson has it now. */
export function judgedEvents(
  events: TypedEvent[],
  judge: Omit<SpokenJudge, "exercise"> & { lesson?: Lesson | null },
): TypedEvent[] {
  const shown = new Map<string, Exercise>();
  for (const e of events)
    if (e.type === "page_shown" && e.payload.snapshot)
      shown.set(e.payload.snapshot.exercise.key, e.payload.snapshot.exercise);
  const full: SpokenJudge = {
    ...judge,
    exercise: (key) =>
      shown.get(key) ?? judge.lesson?.pages.find((p) => p.exercise.key === key)?.exercise,
  };
  return events.map((e) => {
    if (e.type !== "answered" || !e.itemKey) return e;
    const outcome = judgedOutcome(full, e.itemKey, e.payload.answer, e.payload.outcome);
    return outcome === e.payload.outcome ? e : { ...e, payload: { ...e.payload, outcome } };
  });
}

/**
 * What an answer marks its item as: its outcome's result; for one said aloud (unscored, in no
 * score), the engine's judgement of what was heard (`spoken`; a run read through `judgedEvents`
 * has it for answers from before), else the model's check of the same words — the engine decides
 * where it can, the model only where nothing could (owner, 2026-10-18). Undefined: nothing marks it
 * (recorded only).
 */
export function answerMark(
  itemKey: string,
  answer: unknown,
  outcome: Outcome,
  checks: Map<string, SpokenCheck>,
): Outcome["result"] | undefined {
  return outcome.result !== "unscored"
    ? outcome.result
    : spokenMark(itemKey, answer, outcome, checks);
}

function spokenMark(
  itemKey: string,
  answer: unknown,
  outcome: Outcome,
  checks: Map<string, SpokenCheck>,
) {
  if (outcome.spoken) return outcome.spoken;
  const heard = transcriptOf(answer);
  const check = heard !== undefined ? checks.get(`${itemKey}\n${heard}`) : undefined;
  return check && SPOKEN_RESULT[check.verdict];
}

/** Whether an answer takes the place of an item's first attempt so far: an answer said aloud kept
 *  before it was heard (a take heard late) gives way to the item's first answer that was heard. One
 *  reading for the exercise's mark and the mistakes. */
export const replacesFirst = (first: { answer: unknown; outcome?: Outcome }, answer: unknown) =>
  first.outcome?.result === "unscored" &&
  transcriptOf(first.answer) === undefined &&
  transcriptOf(answer) !== undefined;

/** Answers and skips of a run per exercise key. The first attempt is the item's first answer, or
 *  the one that replaces it (`replacesFirst`). Its first attempt marked by the model's check of it
 *  carries that mark as `spoken`. */
export function exerciseResults(events: TypedEvent[]): Record<string, ExerciseResult> {
  const results: Record<string, ExerciseResult> = {};
  const firstAnswers = new Map<string, unknown>();
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
    const unheard =
      e.itemKey in r.first &&
      replacesFirst({ answer: firstAnswers.get(e.itemKey), outcome: r.first[e.itemKey] }, answer);
    // Only the first attempt counts; skipping an item first is its first attempt.
    if (outcome && (unheard || (!(e.itemKey in r.first) && !r.skippedFirst.includes(e.itemKey)))) {
      r.first[e.itemKey] = outcome;
      firstAnswers.set(e.itemKey, answer);
    }
    r.last[e.itemKey] = { answer, outcome };
    r.skipped = r.skipped.filter((k) => k !== e.itemKey);
  }
  const checks = spokenChecks(events);
  if (checks.size)
    for (const r of Object.values(results))
      for (const [key, o] of Object.entries(r.first)) {
        const mark =
          o.result === "unscored" && !o.spoken && spokenMark(key, firstAnswers.get(key), o, checks);
        if (mark) r.first[key] = { ...o, spoken: mark };
      }
  return results;
}

/** What an exercise's first attempt marks an item as (`answerMark`, its model's check carried in). */
const markOf = (o: Outcome) => (o.result !== "unscored" ? o.result : o.spoken);

/** Items that would have been scored but were skipped at their first attempt (answered later or
 *  not): they count as wrong (score 0). */
const missed = (exercise: Exercise, r: ExerciseResult) =>
  [...new Set([...r.skipped, ...r.skippedFirst])].filter(
    (k) => !(k in r.first) && itemScored(exercise, parseItemKey(k as ItemKey).n - 1),
  );

/**
 * An exercise's state in a run: not worked yet (undefined), `skipped` (moved on without an answer and
 * nothing in it is scored), `done` (answered, nothing marked — recorded only, a free answer without
 * a rubric), `correct` (every marked item right at the first attempt) or `wrong` (a mistake, or a
 * scored item skipped: skipping what is checked is not knowing it). An answer said aloud is marked
 * by its check (`answerMark`) though it scores nothing.
 */
export function exerciseState(exercise: Exercise, r: ExerciseResult | undefined) {
  if (!r) return undefined;
  const marks = Object.values(r.first).flatMap((o) => markOf(o) ?? []);
  const skippedScored = missed(exercise, r);
  if (!marks.length && !skippedScored.length) {
    if (Object.keys(r.last).length) return "done";
    return r.skipped.length ? "skipped" : undefined;
  }
  return marks.every((m) => m === "correct") && !skippedScored.length ? "correct" : "wrong";
}
export type ExerciseState = NonNullable<ReturnType<typeof exerciseState>>;

/** Exercises of the lesson worked in the run — `skipped` of them moved past without an answer —; a
 *  run can be completed only when all of them are. */
export function lessonCoverage(lesson: Lesson, results: Record<string, ExerciseResult>) {
  const total = lesson.pages.length;
  const states = lesson.pages.map(({ exercise }) => exerciseState(exercise, results[exercise.key]));
  const left = states.flatMap((s, i) => (s ? [] : [i]));
  return {
    worked: total - left.length,
    skipped: states.filter((s) => s === "skipped").length,
    total,
    complete: !left.length,
    firstLeft: left[0],
  };
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

/** An exercise's mark wherever it is shown — the lesson's plan and summary, going over mistakes,
 *  the Notebook —: its state, `partial` for one with mistakes where some scored items were right at
 *  the first try. */
export function exerciseMark(exercise: Exercise, r: ExerciseResult | undefined) {
  const state = exerciseState(exercise, r);
  const someRight = Object.values(r?.first ?? {}).some((o) => markOf(o) === "correct");
  return state === "wrong" && someRight ? ("partial" as const) : state;
}
export type ExerciseMark = NonNullable<ReturnType<typeof exerciseMark>>;

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
 * Score of a lesson run: mean first-attempt score of its scored items, a scored item
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
 * A run's exercises as they were shown: each exercise's snapshot from the first time
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
 *  number when it is no longer there, or the event names none). An event from before pages named
 *  their exercise names it by its snapshot. */
export function resumePage(events: TypedEvent[], lesson?: Lesson): number {
  let page = 0;
  for (const e of events) {
    if (e.type !== "page_shown") continue;
    const { pageIndex, snapshot } = e.payload;
    const exerciseKey = e.payload.exerciseKey ?? snapshot?.exercise.key;
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
      const at = run.finishedAt ?? run.startedAt;
      p.doneAt = Math.min(p.doneAt ?? at, at);
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
    /** When the course was done: its last lesson first done, once every one is. */
    doneAt:
      lessons.length && done === lessons.length
        ? Math.max(...lessons.map((k) => progress[k]?.doneAt ?? 0))
        : undefined,
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
