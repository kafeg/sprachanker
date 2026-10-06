import { expect, test } from "bun:test";
import type { Run, StoredEvent } from "@sprachanker/schema";
import { lessonProgress, lessonResult, resumePage } from "../src/index.ts";

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
  const progress = lessonProgress([
    run("1", "x/a1/00-01", "finished", 1, 0.6),
    run("2", "x/a1/00-01", "finished", 2, 0.9),
    run("3", "x/a1/00-01", "active", 3),
    run("4", "x/a1/00-02", "active", 4),
    { ...run("5", "x/a1/00-04", "finished", 5, 0), result: { score: 0, scored: 0, answered: 0 } },
  ]);
  expect(progress.get("x/a1/00-01")).toEqual({
    status: "done",
    bestScore: 0.9,
    activeRunId: "3",
    finishedRuns: 2,
  });
  expect(progress.get("x/a1/00-02")).toEqual({
    status: "in_progress",
    activeRunId: "4",
    finishedRuns: 0,
  });
  expect(progress.get("x/a1/00-03")).toBeUndefined();
  // A lesson with nothing to score (words only) is done without a score.
  expect(progress.get("x/a1/00-04")).toEqual({ status: "done", finishedRuns: 1 });
});
