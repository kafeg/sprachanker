import { expect, test } from "bun:test";
import type { UnderstandingQuestion, UnderstandingText } from "@sprachanker/schema";
import {
  checkUnderstanding,
  heardFirst,
  understandingExercise,
  understandingStage,
} from "../src/check/understanding.ts";

const TRUE_FALSE: UnderstandingQuestion = {
  phase: "listening",
  question: "Anna möchte drei Brötchen.",
  options: ["Richtig", "Falsch"],
  answer: 1,
};
const PRICE: UnderstandingQuestion = {
  phase: "listening",
  question: "Wie viel kostet das?",
  accepted: ["1,20", "1,20 Euro"],
};
const WHO: UnderstandingQuestion = {
  phase: "reading",
  question: "Wer verkauft?",
  options: ["Anna", "der Verkäufer", "niemand"],
  answer: 1,
};

const text = (kind: UnderstandingText["kind"]): UnderstandingText => ({
  kind,
  title: "At the bakery",
  situation: "",
  lines: [{ speaker: "Anna", text: "Zwei Brötchen, bitte." }],
  glossary: [],
  questions: [TRUE_FALSE, PRICE, WHO],
});

test("a choice is a single choice of its options, an answer typed a gap of what is accepted", () => {
  expect(understandingExercise(TRUE_FALSE, "t-1")).toMatchObject({
    key: "t-1",
    type: "single_choice",
    items: [
      {
        key: "t-1#1",
        prompt: "Anna möchte drei Brötchen.",
        options: [
          { id: "a", text: "Richtig" },
          { id: "b", text: "Falsch" },
        ],
        answer: { optionIds: ["b"] },
      },
    ],
  });
  expect(understandingExercise(PRICE)).toMatchObject({
    type: "gap_text",
    items: [{ segments: [{ gap: "g1" }], answer: { g1: { accepted: ["1,20", "1,20 Euro"] } } }],
  });
});

test.each([
  [TRUE_FALSE, { optionId: "b" }, "correct"],
  [TRUE_FALSE, { optionId: "a" }, "wrong"],
  [PRICE, { g1: "1,20" }, "correct"],
  [PRICE, { g1: " 1,20 Euro " }, "correct"],
  [PRICE, { g1: "2,10" }, "wrong"],
  [WHO, { optionId: "b" }, "correct"],
] as const)("checked as the item it is: %j answered %j is %s", (q, answer, result) => {
  expect(checkUnderstanding(q, answer, "de").result).toBe(result);
});

test("an answer of the wrong shape is refused", () => {
  expect(() => checkUnderstanding(PRICE, { optionId: "a" }, "de")).toThrow();
});

test("listening first (the text hidden), then reading, then done; a text to read is read from the start", () => {
  const heard = text("dialogue");
  expect(heardFirst(heard)).toBe(true);
  const none = understandingStage(heard, () => false);
  expect(none).toEqual({ stage: "listening", listening: [0, 1], reading: [2] });
  expect(understandingStage(heard, (n) => n === 0).stage).toBe("listening");
  expect(understandingStage(heard, (n) => n < 2).stage).toBe("reading");
  expect(understandingStage(heard, () => true).stage).toBe("done");

  const read = text("reading");
  expect(heardFirst(read)).toBe(false);
  expect(understandingStage(read, () => false)).toEqual({
    stage: "reading",
    listening: [],
    reading: [0, 1, 2],
  });
});
