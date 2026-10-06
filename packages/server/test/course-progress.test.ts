import { expect, test } from "bun:test";
import { courseProgress } from "../src/services/runs.ts";

const lessons = ["c/00-01", "c/00-02", "c/00-03", "c/00-04"];

test("the next lesson is the one worked on most recently, else the first not done", () => {
  expect(courseProgress(lessons, {})).toEqual({ done: 0, next: "c/00-01", nextStarted: false });
  const progress = {
    "c/00-01": { status: "in_progress", finishedRuns: 0, activeRunId: "a", activeAt: 10 },
    "c/00-02": { status: "in_progress", finishedRuns: 1, activeRunId: "b", activeAt: 30 },
    "c/00-03": { status: "done", finishedRuns: 1 },
  } as const;
  expect(courseProgress(lessons, progress)).toEqual({
    done: 2,
    next: "c/00-02",
    nextStarted: true,
  });
  const { "c/00-01": _, "c/00-02": __, ...rest } = progress;
  expect(courseProgress(lessons, rest)).toEqual({ done: 1, next: "c/00-01", nextStarted: false });
});
