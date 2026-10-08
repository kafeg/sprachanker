import { expect, test } from "bun:test";
import type { Exercise } from "@sprachanker/schema";
import { answerComplete, isChecked, spokenFreely } from "../src/index.ts";

const ex = (type: string, items: unknown[]) =>
  ({ key: "s/c/00-01/ex-01", type, items }) as unknown as Exercise;

test("checked: everything but speaking oneself, scenes and unknown mechanics", () => {
  expect(
    ["single_choice", "respond", "dictation", "speech_repeat"].map((t) => isChecked(t as never)),
  ).toEqual([true, true, true, true]);
  expect(["speech_selfrate", "scene", "unknown"].map((t) => isChecked(t as never))).toEqual([
    false,
    false,
    false,
  ]);
});

test("complete enough to check: every pair and part, one typed gap, text typed", () => {
  const match = ex("match", [{ left: [{ id: "a" }, { id: "b" }] }]);
  expect(answerComplete(match, 0, { pairs: [["a", "x"]] })).toBe(false);
  expect(
    answerComplete(match, 0, {
      pairs: [
        ["a", "x"],
        ["b", "y"],
      ],
    }),
  ).toBe(true);
  const gaps = ex("gap_text", [{ segments: ["a", { gap: "g1" }, { gap: "g2" }] }]);
  expect(answerComplete(gaps, 0, { g1: " ", g2: "" })).toBe(false);
  expect(answerComplete(gaps, 0, { g1: "der", g2: "" })).toBe(true);
  expect(answerComplete(ex("respond", [{}]), 0, { text: "  " })).toBe(false);
  expect(answerComplete(ex("single_choice", [{}]), 0, undefined)).toBe(false);
});

test("what was heard of an answer said aloud with no phrase to say", () => {
  const speaking = ex("speech_selfrate", [{ text: "Guten Tag!" }, {}]);
  expect(spokenFreely(speaking, 1, { transcript: "Hallo" })).toBe("Hallo");
  expect(spokenFreely(speaking, 1, { transcript: " " })).toBeUndefined();
  expect(spokenFreely(speaking, 0, { transcript: "Guten Tag" })).toBeUndefined();
  expect(spokenFreely(ex("respond", [{}]), 0, { transcript: "Hallo" })).toBeUndefined();
});
