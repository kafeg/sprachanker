import { expect, test } from "bun:test";
import type { StoredEvent } from "@sprachanker/schema";
import { mistakesOf } from "../src/index.ts";

const answered = (ts: number, itemKey: string, result: string, answer: unknown): StoredEvent =>
  ({
    id: `E${ts}`,
    runId: "R",
    ts,
    type: "answered",
    itemKey,
    payload: { answer, outcome: { result, score: result === "correct" ? 1 : 0 } },
  }) as StoredEvent;

const A = "s/c/00-01/ex-01#1";
const B = "s/c/00-01/ex-02#2";

test("the first answer of the latest run that answered an item decides; later answers fix it", () => {
  const first = { events: [answered(1, A, "wrong", "x"), answered(2, A, "correct", "y")] };
  const mistakes = mistakesOf([first, { events: [answered(3, B, "partial", "z")] }]);
  expect(mistakes.map((m) => [m.itemKey, m.result, m.fixed, m.index, m.answer])).toEqual([
    [B, "partial", false, 1, "z"],
    [A, "wrong", true, 0, "x"],
  ]);
  expect(mistakes[1]?.lessonKey).toBe("s/c/00-01");
  // Done again and right at the first attempt: no longer a mistake.
  expect(mistakesOf([first, { events: [answered(4, A, "correct", "y")] }])).toEqual([]);
});

const spoken = (ts: number, itemKey: string, transcript: string): StoredEvent =>
  ({
    id: `E${ts}`,
    runId: "R",
    ts,
    type: "answered",
    itemKey,
    payload: { answer: { transcript }, outcome: { result: "unscored", score: 0 } },
  }) as StoredEvent;
const checked = (ts: number, itemKey: string, input: string, verdict: string): StoredEvent =>
  ({
    id: `V${ts}`,
    runId: "R",
    ts,
    type: "llm_verdict",
    itemKey,
    payload: {
      task: "speaking",
      input,
      result: { verdict, corrected: `${input}!`, corrections: [], feedback: "" },
      model: "m",
      latencyMs: 1,
    },
  }) as StoredEvent;

test("an answer said aloud is read by the model's check of what was heard; unchecked, no mistake", () => {
  const run = {
    events: [
      spoken(1, A, "Hallo ich heisse"),
      checked(2, A, "Hallo ich heisse", "minor_errors"),
      spoken(3, B, "Tschüss"),
      checked(4, B, "Tschüss", "off_task"),
      spoken(5, B, "Guten Tag"),
      checked(6, B, "Guten Tag", "good"),
      spoken(7, "s/c/00-01/ex-03#1", "Ja"),
    ],
  };
  expect(mistakesOf([run]).map((m) => [m.itemKey, m.result, m.corrected, m.fixed])).toEqual([
    [B, "wrong", "Tschüss!", true],
    [A, "partial", "Hallo ich heisse!", false],
  ]);
  // Checked good at once: no mistake.
  expect(mistakesOf([{ events: [spoken(1, A, "Ja"), checked(2, A, "Ja", "good")] }])).toEqual([]);
});
