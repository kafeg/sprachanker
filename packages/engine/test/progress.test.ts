import { expect, test } from "bun:test";
import type { Lesson, Run, StoredEvent } from "@sprachanker/schema";
import {
  exerciseResults,
  exerciseState,
  lessonCoverage,
  lessonProgress,
  lessonResult,
  resumePage,
} from "../src/index.ts";

const ev = (
  n: number,
  type: StoredEvent["type"],
  itemKey: string | null,
  payload: unknown,
): StoredEvent => ({ id: `E${n}`, runId: "R", ts: n, type, itemKey, payload }) as StoredEvent;
const outcome = (result: string, score: number) => ({ result, score, ruleIds: [], lexemes: [] });

test("first attempts count; unscored items are left out", () => {
  const events = [
    ev(1, "page_shown", null, { pageIndex: 0 }),
    ev(2, "answered", "a#1", { attempt: 1, outcome: outcome("wrong", 0) }),
    ev(3, "answered", "a#1", { attempt: 2, outcome: outcome("correct", 1) }),
    ev(4, "answered", "a#2", { attempt: 1, outcome: outcome("partial", 0.5) }),
    ev(5, "answered", "a#3", { attempt: 1, outcome: outcome("unscored", 0) }),
    ev(6, "page_shown", null, { pageIndex: 3 }),
  ];
  expect(lessonResult(events)).toEqual({ score: 0.25, scored: 2, answered: 3 });
  expect(resumePage(events)).toBe(3);
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
  const lesson = {
    pages: ["a", "b", "c", "d"].map((key) => ({ exercise: { key } })),
  } as unknown as Lesson;
  const results = exerciseResults([
    ev(1, "answered", "a#1", { answer: 1, outcome: outcome("correct", 1) }),
    ev(2, "answered", "b#1", { answer: 1, outcome: outcome("wrong", 0) }),
    ev(3, "answered", "b#1", { answer: 2, outcome: outcome("correct", 1) }),
    ev(4, "item_skipped", "c#1", {}),
    ev(5, "item_skipped", "c#2", {}),
    ev(6, "answered", "c#2", { answer: 3, outcome: outcome("unscored", 0) }),
  ]);
  expect(exerciseState(results.a)).toBe("correct");
  expect(exerciseState(results.b)).toBe("wrong");
  expect(results.b?.last["b#1"]?.answer).toBe(2);
  expect(results.c?.skipped).toEqual(["c#1"]);
  expect(exerciseState(results.c)).toBe("done");
  expect(exerciseState(results.d)).toBeUndefined();
  expect(lessonCoverage(lesson, results)).toEqual({
    worked: 3,
    total: 4,
    complete: false,
    firstLeft: 3,
  });
});
