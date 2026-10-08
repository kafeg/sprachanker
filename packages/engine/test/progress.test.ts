import { expect, test } from "bun:test";
import type { Exercise, Lesson, Run, TypedEvent } from "@sprachanker/schema";
import {
  answerAt,
  exerciseResults,
  exerciseState,
  firstAttempts,
  itemTries,
  lessonCoverage,
  lessonProgress,
  lessonResult,
  resumePage,
  shownExercises,
} from "../src/index.ts";

const ev = (
  n: number,
  type: TypedEvent["type"],
  itemKey: string | null,
  payload: unknown,
): TypedEvent => ({ id: `E${n}`, runId: "R", ts: n, type, itemKey, payload }) as TypedEvent;
const outcome = (result: string, score: number) => ({ result, score, ruleIds: [], lexemes: [] });

/** A lesson of exercises `key:type` (items are not needed by the progress functions). */
const lessonOf = (...pages: string[]) =>
  ({
    pages: pages.map((p) => {
      const [key, type = "single_choice"] = p.split(":");
      return { exercise: { key, type, items: [] } };
    }),
  }) as unknown as Lesson;

test("first attempts count; unscored items are left out; scored items skipped count 0", () => {
  const events = [
    ev(1, "page_shown", null, { pageIndex: 0 }),
    ev(2, "answered", "a#1", { attempt: 1, outcome: outcome("wrong", 0) }),
    ev(3, "answered", "a#1", { attempt: 2, outcome: outcome("correct", 1) }),
    ev(4, "answered", "a#2", { attempt: 1, outcome: outcome("partial", 0.5) }),
    ev(5, "answered", "a#3", { attempt: 1, outcome: outcome("unscored", 0) }),
    ev(6, "page_shown", null, { pageIndex: 3 }),
  ];
  const lesson = lessonOf("a", "b", "s:speech_selfrate");
  expect(lessonResult(lesson, events)).toEqual({ score: 0.25, scored: 2, answered: 3 });
  expect(resumePage(events)).toBe(3);
  // Skipping a checked item is not knowing it; skipping a self-rated one costs nothing.
  const skipped = [...events, ev(7, "item_skipped", "b#1", {}), ev(8, "item_skipped", "s#1", {})];
  expect(lessonResult(lesson, skipped)).toEqual({ score: 0.5 / 3, scored: 3, answered: 3 });
  // What the summary and the mistakes step count: right at the first attempt of all scored.
  expect(firstAttempts(lesson, exerciseResults(skipped))).toEqual({
    sum: 0.5,
    scored: 3,
    correct: 0,
    answered: 3,
  });
  const right = [
    ...events,
    ev(9, "answered", "b#1", { attempt: 1, outcome: outcome("correct", 1) }),
  ];
  expect(firstAttempts(lesson, exerciseResults(right))).toMatchObject({ scored: 3, correct: 1 });
});

test("a skip before the first answer is the first attempt: answering after it does not count", () => {
  const lesson = lessonOf("b");
  const events = [
    ev(1, "item_skipped", "b#1", {}),
    ev(2, "answered", "b#1", { attempt: 1, outcome: outcome("correct", 1) }),
  ];
  const results = exerciseResults(events);
  expect(results.b?.first).toEqual({});
  expect(results.b?.last["b#1"]?.outcome?.result).toBe("correct");
  expect(exerciseState({ key: "b", type: "single_choice", items: [{}] } as never, results.b)).toBe(
    "wrong",
  );
  expect(lessonResult(lesson, events)).toEqual({ score: 0, scored: 1, answered: 0 });
});

test("lesson status and best score over runs", () => {
  const run = (id: string, key: string, status: Run["status"], startedAt: number, score?: number) =>
    ({
      id,
      kind: "lesson",
      contextKey: key,
      status,
      startedAt,
      result: score === undefined ? null : { score, scored: 1, answered: 1 },
    }) as Run;
  const progress = lessonProgress(
    [
      run("1", "x/a1/00-01", "finished", 1, 0.6),
      run("2", "x/a1/00-01", "finished", 2, 0.9),
      run("3", "x/a1/00-01", "active", 3),
      run("4", "x/a1/00-02", "active", 4),
      { ...run("5", "x/a1/00-04", "finished", 5, 0), result: { score: 0, scored: 0, answered: 0 } },
      run("6", "x/a1/00-05", "active", 6),
    ],
    new Map([
      ["3", 30],
      ["4", 40],
    ]),
  );
  // Done before and being done again: in progress, still counted as done, best score kept.
  expect(progress.get("x/a1/00-01")).toEqual({
    status: "in_progress",
    bestScore: 0.9,
    activeRunId: "3",
    activeAt: 30,
    finishedRuns: 2,
  });
  expect(progress.get("x/a1/00-02")).toEqual({
    status: "in_progress",
    activeRunId: "4",
    activeAt: 40,
    finishedRuns: 0,
  });
  expect(progress.get("x/a1/00-03")).toBeUndefined();
  // A lesson with nothing to score (words only) is done without a score.
  expect(progress.get("x/a1/00-04")).toEqual({ status: "done", finishedRuns: 1 });
  // Opened, nothing worked: not progress.
  expect(progress.get("x/a1/00-05")).toEqual({ status: "new", finishedRuns: 0 });
});

test("exercise states and coverage of a run", () => {
  const lesson = lessonOf("a", "b", "c:speech_selfrate", "d", "e:speech_selfrate", "f");
  const [a, b, c, d, e, f] = lesson.pages.map((p) => p.exercise) as [
    Exercise,
    Exercise,
    Exercise,
    Exercise,
    Exercise,
    Exercise,
  ];
  const results = exerciseResults([
    ev(1, "answered", "a#1", { answer: 1, outcome: outcome("correct", 1) }),
    ev(2, "answered", "b#1", { answer: 1, outcome: outcome("wrong", 0) }),
    ev(3, "answered", "b#1", { answer: 2, outcome: outcome("correct", 1) }),
    ev(4, "item_skipped", "c#1", {}),
    ev(5, "item_skipped", "c#2", {}),
    ev(6, "answered", "c#2", { answer: 3, outcome: outcome("unscored", 0) }),
    ev(7, "item_skipped", "e#1", {}),
    ev(8, "item_skipped", "f#1", {}),
  ]);
  expect(exerciseState(a, results.a)).toBe("correct");
  expect(exerciseState(b, results.b)).toBe("wrong");
  expect(results.b?.last["b#1"]?.answer).toBe(2);
  expect(results.c?.skipped).toEqual(["c#1"]);
  expect(exerciseState(c, results.c)).toBe("done");
  expect(exerciseState(d, results.d)).toBeUndefined();
  // Skipped: neutral where nothing is scored, wrong where it is.
  expect(exerciseState(e, results.e)).toBe("skipped");
  expect(exerciseState(f, results.f)).toBe("wrong");
  // Skipped counts as worked: the lesson can be completed without answering everything.
  expect(lessonCoverage(lesson, results)).toEqual({
    worked: 5,
    total: 6,
    complete: false,
    firstLeft: 3,
  });
});

test("the answer an item got at one attempt", () => {
  const events = [
    ev(1, "answered", "a#1", { answer: "x", attempt: 1, outcome: outcome("wrong", 0) }),
    ev(2, "answered", "a#2", { answer: "y", attempt: 1, outcome: outcome("correct", 1) }),
    ev(3, "answered", "a#1", { answer: "z", attempt: 2, outcome: outcome("correct", 1) }),
  ];
  expect(answerAt(events, "a#1", 2)?.answer).toBe("z");
  expect(answerAt(events, "a#1", 1)?.answer).toBe("x");
  expect(answerAt(events, "a#1", 3)).toBeUndefined();
});

test("a lesson changed since: the run resumes on the exercise it showed and keeps its snapshots by key", () => {
  const shown = (n: number, pageIndex: number, key: string, snapshot = false) =>
    ev(n, "page_shown", null, {
      pageIndex,
      exerciseKey: key,
      ...(snapshot && {
        snapshot: { exercise: { key, type: "single_choice", items: [] }, locale: null },
      }),
    });
  const events = [shown(1, 0, "a", true), shown(2, 1, "b", true)];
  // The source put a new exercise first: "b" is the third page now.
  const now = lessonOf("n", "a", "b");
  expect(resumePage(events, now)).toBe(2);
  expect(shownExercises(events, now).map((s) => `${s.pageIndex}:${s.exercise.key}`)).toEqual([
    "0:n",
    "1:a",
    "2:b",
  ]);
  // Without the lesson, or an exercise it no longer has: the page number as recorded.
  expect(resumePage(events)).toBe(1);
  expect(resumePage([shown(3, 4, "gone")], now)).toBe(4);
});

test("how an item went in a run: right at a later attempt, or only tries, or skipped", () => {
  const events = [
    ev(1, "answered", "a#1", { attempt: 1, outcome: outcome("wrong", 0) }),
    ev(2, "answered", "a#1", { attempt: 2, outcome: outcome("correct", 1) }),
    ev(3, "answered", "a#2", { attempt: 1, outcome: outcome("wrong", 0) }),
    ev(4, "item_skipped", "a#3", {}),
  ];
  const r = exerciseResults(events).a;
  expect(itemTries(events, r, "a#1")).toEqual({ tries: 2, skipped: false, rightAt: 2 });
  expect(itemTries(events, r, "a#2")).toEqual({ tries: 1, skipped: false, rightAt: undefined });
  expect(itemTries(events, r, "a#3")).toEqual({ tries: 0, skipped: true, rightAt: undefined });
});
