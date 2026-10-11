import { expect, test } from "bun:test";
import { courseProgress } from "../src/index.ts";

const lessons = ["c/00-01", "c/00-02", "c/00-03", "c/00-04"];

test("the next lesson is the one worked on most recently, else the first not done", () => {
  expect(courseProgress(lessons, {})).toEqual({
    done: 0,
    doneAt: undefined,
    next: "c/00-01",
    nextStarted: false,
    started: false,
  });
  const progress = {
    "c/00-01": { status: "in_progress", finishedRuns: 0, activeRunId: "a", activeAt: 10 },
    "c/00-02": { status: "in_progress", finishedRuns: 1, activeRunId: "b", activeAt: 30 },
    "c/00-03": { status: "done", finishedRuns: 1 },
  } as const;
  expect(courseProgress(lessons, progress)).toEqual({
    done: 2,
    doneAt: undefined,
    next: "c/00-02",
    nextStarted: true,
    started: true,
  });
  const { "c/00-01": _, "c/00-02": __, ...rest } = progress;
  expect(courseProgress(lessons, rest)).toEqual({
    done: 1,
    doneAt: undefined,
    next: "c/00-01",
    nextStarted: false,
    // A lesson done: the course is begun though nothing is in progress.
    started: true,
  });
});

test("a course is done when its last lesson is first done, once every one is", () => {
  const done = (doneAt: number) => ({ status: "done", finishedRuns: 1, doneAt }) as const;
  const three = { "c/00-01": done(5), "c/00-02": done(9), "c/00-03": done(2) };
  expect(courseProgress(lessons, three).doneAt).toBeUndefined();
  expect(courseProgress(lessons, { ...three, "c/00-04": done(7) }).doneAt).toBe(9);
  expect(courseProgress([], {}).doneAt).toBeUndefined();
});
