import { expect, test } from "bun:test";
import type { Lesson, LocaleLesson, StoredEvent } from "@sprachanker/schema";
import {
  exerciseResults,
  lessonSteps,
  planCoverage,
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

const ev = (n: number, type: StoredEvent["type"], itemKey: string | null, payload: unknown) =>
  ({ id: `E${n}`, runId: "R", ts: n, type, itemKey, payload }) as StoredEvent;

test("steps: overview, words, grammar, exercises, culture, AI practice offered, summary", () => {
  const ids = lessonSteps(lesson, locale, ["review", "writing"]).map(stepId);
  expect(ids).toEqual([
    "overview",
    "words",
    "grammar:0",
    ...lesson.pages.map((_, i) => `exercise:${i}`),
    "culture:0",
    "writing",
    "review",
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
