import { expect, test } from "bun:test";
import type { Lesson, LocaleLesson, TypedEvent } from "@sprachanker/schema";
import {
  exerciseResults,
  lessonSteps,
  openingRecord,
  planCoverage,
  resumeStep,
  stepId,
  stepState,
  stepsDone,
} from "../src/index.ts";

/** A lesson of two exercises and a word, with one grammar and one culture page (items not needed). */
const lesson = {
  key: "s.x/c/01-01",
  vocab: [{ key: "s.x/c/01-01/v-a", lexeme: "lex:de:a:word", target: "a" }],
  pages: ["s.x/c/01-01/ex-01", "s.x/c/01-01/ex-02"].map((key) => ({
    exercise: { key, type: "single_choice", items: [{}] },
  })),
} as unknown as Lesson;
const page = { title: "t", bodyHtml: "<p>b</p>" };
const locale = { tabs: { grammar: [page], culture: [page] } } as unknown as LocaleLesson;

const ev = (n: number, type: TypedEvent["type"], itemKey: string | null, payload: unknown) =>
  ({ id: `E${n}`, runId: "R", ts: n, type, itemKey, payload }) as TypedEvent;

test("steps: overview, words, grammar, exercises, culture, AI practice offered, summary", () => {
  const ids = lessonSteps(lesson, locale, ["mistakes", "writing"]).map(stepId);
  expect(ids).toEqual([
    "overview",
    "words",
    "grammar:0",
    ...lesson.pages.map((_, i) => `exercise:${i}`),
    "culture:0",
    "writing",
    "mistakes",
    "summary",
  ]);
  // No assistant, no practice; no locale, no reading pages.
  expect(lessonSteps(lesson, null).map(stepId)).not.toContain("grammar:0");
  expect(lessonSteps(lesson, locale).map(stepId)).not.toContain("writing");
});

test("coverage: complete when every step is done or skipped; the latest record of a step counts", () => {
  const steps = lessonSteps(lesson, locale, ["writing"]);
  const answers = lesson.pages.map(({ exercise }, i) =>
    ev(i, "item_skipped", `${exercise.key}#1`, {}),
  );
  let events = [...answers, ev(100, "step_done", null, { step: "words" })];
  let cover = planCoverage(steps, lesson, exerciseResults(events), stepsDone(events));
  expect(cover.complete).toBe(false);
  expect(steps[cover.firstLeft as number]).toEqual({ kind: "grammar", index: 0 });
  events = [
    ...events,
    ev(101, "step_done", null, { step: "grammar:0" }),
    ev(102, "step_done", null, { step: "culture:0" }),
    ev(103, "step_done", null, { step: "writing", skipped: true }),
  ];
  const done = stepsDone(events);
  cover = planCoverage(steps, lesson, exerciseResults(events), done);
  expect(cover).toMatchObject({ complete: true, worked: cover.total });
  expect(stepState({ kind: "writing" }, lesson, {}, done)).toBe("skipped");
  // Done after a skip: done.
  const later = stepsDone([...events, ev(104, "step_done", null, { step: "writing" })]);
  expect(stepState({ kind: "writing" }, lesson, {}, later)).toBe("done");
});

test("resume: the exercise last shown while it is not worked, else the first step still to do", () => {
  const steps = lessonSteps(lesson, locale);
  const none = new Map();
  expect(resumeStep(steps, lesson, {}, none, 1)).toBe("exercise:1");
  const worked = exerciseResults([ev(1, "item_skipped", "s.x/c/01-01/ex-02#1", {})]);
  // The exercise shown was worked: the first step still to do is the words.
  expect(resumeStep(steps, lesson, worked, none, 1)).toBe("words");
  const all = new Map([
    ["words", "done"],
    ["grammar:0", "done"],
    ["culture:0", "done"],
  ] as const);
  const both = exerciseResults([
    ev(1, "item_skipped", "s.x/c/01-01/ex-01#1", {}),
    ev(2, "item_skipped", "s.x/c/01-01/ex-02#1", {}),
  ]);
  // Nothing left: back on that exercise.
  expect(resumeStep(steps, lesson, both, new Map(all), 1)).toBe("exercise:1");
  expect(resumeStep(steps, lesson, {}, none, 9)).toBeUndefined();
});

test("opening a step records what it is: a page shown, a page read once, mistakes when there are none", () => {
  const run = { lesson, results: {}, done: new Map(), mistakes: 0, fresh: false };
  expect(openingRecord({ kind: "exercise", index: 1 }, run)).toEqual({ pageShown: 1 });
  expect(openingRecord({ kind: "grammar", index: 0 }, run)).toEqual({ stepDone: "grammar:0" });
  const read = { ...run, done: new Map([["grammar:0", "done"]] as const) };
  expect(openingRecord({ kind: "grammar", index: 0 }, read)).toEqual({});
  // A run just started records it again (its `done` may still be the old run's).
  expect(openingRecord({ kind: "grammar", index: 0 }, { ...read, fresh: true })).toEqual({
    stepDone: "grammar:0",
  });
  // Mistakes: only with every exercise worked and none to go over.
  expect(openingRecord({ kind: "mistakes" }, run)).toEqual({});
  const worked = exerciseResults([
    ev(1, "item_skipped", "s.x/c/01-01/ex-01#1", {}),
    ev(2, "item_skipped", "s.x/c/01-01/ex-02#1", {}),
  ]);
  expect(openingRecord({ kind: "mistakes" }, { ...run, results: worked })).toEqual({
    stepDone: "mistakes",
  });
  expect(openingRecord({ kind: "mistakes" }, { ...run, results: worked, mistakes: 2 })).toEqual({});
  expect(openingRecord({ kind: "words" }, run)).toEqual({});
});
