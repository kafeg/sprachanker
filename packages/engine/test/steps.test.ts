import { expect, test } from "bun:test";
import type { Lesson, LocaleLesson, TypedEvent } from "@sprachanker/schema";
import {
  exerciseResults,
  hasMistakesToGoOver,
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
  const ids = lessonSteps(lesson, locale, ["speaking", "writing"]).map(stepId);
  expect(ids).toEqual([
    "overview",
    "words",
    "grammar:0",
    ...lesson.pages.map((_, i) => `exercise:${i}`),
    "culture:0",
    "writing",
    "speaking",
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
  expect(cover).toMatchObject({ complete: true, worked: cover.total, reached: cover.total });
  expect(stepState({ kind: "writing" }, lesson, {}, done)).toBe("skipped");
  // Done after a skip: done.
  const later = stepsDone([...events, ev(104, "step_done", null, { step: "writing" })]);
  expect(stepState({ kind: "writing" }, lesson, {}, later)).toBe("done");
});

test("reached: the step shown counts while still to do, so the count moves by one on every kind", () => {
  const steps = lessonSteps(lesson, locale);
  const at = (id: string) => steps.map(stepId).indexOf(id);
  const done = new Map([
    ["words", "done"],
    ["grammar:0", "done"],
  ] as const);
  const reached = (events: TypedEvent[], id: string) =>
    planCoverage(steps, lesson, exerciseResults(events), done, at(id)).reached;
  // A page counts once opened: no more for being shown.
  expect(reached([], "grammar:0")).toBe(2);
  // An exercise not worked yet (one to check, or one said aloud that counts once left) counts at once,
  // and the same once worked; the next one adds one.
  expect(reached([], "exercise:0")).toBe(3);
  const first = [ev(1, "item_skipped", "s.x/c/01-01/ex-01#1", {})];
  expect(reached(first, "exercise:0")).toBe(3);
  expect(reached(first, "exercise:1")).toBe(4);
  // The overview and the summary are no steps to do.
  expect(reached(first, "overview")).toBe(3);
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

test("opening a step records what it is: a page shown, a page read once", () => {
  const run = { done: new Map(), fresh: false };
  expect(openingRecord({ kind: "exercise", index: 1 }, run)).toEqual({ pageShown: 1 });
  expect(openingRecord({ kind: "grammar", index: 0 }, run)).toEqual({ stepDone: "grammar:0" });
  const read = { ...run, done: new Map([["grammar:0", "done"]] as const) };
  expect(openingRecord({ kind: "grammar", index: 0 }, read)).toEqual({});
  // A run just started records it again (its `done` may still be the old run's).
  expect(openingRecord({ kind: "grammar", index: 0 }, { ...read, fresh: true })).toEqual({
    stepDone: "grammar:0",
  });
  // Practice is done by its own work, never by being opened.
  expect(openingRecord({ kind: "speaking" }, run)).toEqual({});
  expect(openingRecord({ kind: "words" }, run)).toEqual({});
});

test("a run has mistakes to go over (the summary offers them): an item or an Understanding question answered wrong", () => {
  // A choice, and a free answer the model rates (no item type to go over).
  const choice = {
    key: "s.x/c/01-01/ex-01#1",
    options: [
      { id: "a", text: "ja" },
      { id: "b", text: "nein" },
    ],
    answer: { optionIds: ["a"] },
  };
  const graded = {
    ...lesson,
    pages: [
      { exercise: { key: "s.x/c/01-01/ex-01", type: "single_choice", items: [choice] } },
      { exercise: { key: "s.x/c/01-01/ex-02", type: "respond", items: [{}] } },
    ],
  } as unknown as Lesson;
  const has = (events: TypedEvent[]) => hasMistakesToGoOver(events, graded, null, "de");
  const given = (result: string, answer: unknown) => ({
    outcome: { result, score: result === "correct" ? 1 : 0 },
    attempt: 1,
    ms: 1,
    answer,
  });
  expect(has([])).toBe(false);
  expect(has([ev(1, "answered", "s.x/c/01-01/ex-01#1", given("correct", { optionId: "a" }))])).toBe(
    false,
  );
  expect(has([ev(1, "answered", "s.x/c/01-01/ex-01#1", given("wrong", { optionId: "b" }))])).toBe(
    true,
  );
  // Nothing the step could go over: a free answer, an exercise no longer in the lesson, an answer
  // that does not read as its type's.
  expect(has([ev(1, "answered", "s.x/c/01-01/ex-02#1", given("wrong", { text: "x" }))])).toBe(
    false,
  );
  expect(has([ev(1, "answered", "s.x/c/01-01/ex-09#1", given("wrong", { optionId: "b" }))])).toBe(
    false,
  );
  expect(has([ev(1, "answered", "s.x/c/01-01/ex-01#1", given("wrong", { sequence: ["a"] }))])).toBe(
    false,
  );
  // An Understanding question answered wrong: a mistake to go over too.
  const text = {
    task: "understanding",
    input: "",
    model: "m",
    latencyMs: 1,
    result: {
      kind: "reading",
      title: "t",
      situation: "",
      lines: [{ text: "Kaffee 2 Euro" }],
      glossary: [],
      questions: [{ phase: "reading", question: "Kaffee?", options: ["2", "3"], answer: 0 }],
    },
  };
  const answered = (result: string) => ({
    verdict: "E1",
    question: 0,
    answer: { optionId: "b" },
    outcome: { result, score: 0 },
  });
  const read = [ev(1, "llm_verdict", null, text)];
  expect(has([...read, ev(2, "practice_answered", null, answered("correct"))])).toBe(false);
  expect(has([...read, ev(2, "practice_answered", null, answered("wrong"))])).toBe(true);
});

test("a picture chosen wrong is gone over by the edition's description of it; undescribed, it is not", () => {
  const pictures = {
    ...lesson,
    pages: [
      {
        exercise: {
          key: "s.x/c/01-01/ex-01",
          type: "single_choice",
          items: [
            {
              key: "s.x/c/01-01/ex-01#1",
              options: [
                { id: "a", media: { image: "lena.jpg" } },
                { id: "b", media: { image: "tom.jpg" } },
              ],
              answer: { optionIds: ["b"] },
            },
          ],
        },
      },
    ],
  } as unknown as Lesson;
  const described = {
    exercises: {
      "s.x/c/01-01/ex-01": {
        sourceId: "x",
        items: { "#1": { alt: { a: "A woman with a book", b: "A man in a cap" } } },
      },
    },
  } as unknown as LocaleLesson;
  const wrong = [
    ev(1, "answered", "s.x/c/01-01/ex-01#1", {
      outcome: { result: "wrong", score: 0 },
      attempt: 1,
      ms: 1,
      answer: { optionId: "a" },
    }),
  ];
  expect(hasMistakesToGoOver(wrong, pictures, described, "de")).toBe(true);
  expect(hasMistakesToGoOver(wrong, pictures, null, "de")).toBe(false);
});

test("a step recorded as Understanding, before Reading and Listening, counts as both", () => {
  const done = stepsDone([ev(1, "step_done", null, { step: "understanding" })]);
  expect([done.get("reading"), done.get("listening")]).toEqual(["done", "done"]);
});

test("a step recorded as the Dialogue, before Speaking, counts as Speaking", () => {
  const done = stepsDone([ev(1, "step_done", null, { step: "scene" })]);
  expect(done.get("speaking")).toBe("done");
});
