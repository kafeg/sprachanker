import { expect, test } from "bun:test";
import type { ExamItem, Outcome } from "@sprachanker/schema";
import { questionState, runTally } from "../../src/exams/run-state.ts";

const items = ["a", "b", "c", "d"].map((key) => ({ key }) as ExamItem);
const outcome = (result: Outcome["result"]) => ({ result }) as Outcome;
const answers = new Map([
  ["a", { answer: 1, outcome: outcome("correct") }],
  ["b", { answer: 2, outcome: outcome("wrong") }],
  ["c", { answer: "text", outcome: outcome("unscored") }],
]);

test("the tally counts answered questions, of them right and wrong; an unscored one is neither", () => {
  expect(runTally(items, answers)).toEqual({ answered: 3, right: 1, wrong: 1 });
});

test("practice marks a question right or wrong, a mock exam only answered", () => {
  expect(questionState(answers.get("a"), "practice")).toBe("right");
  expect(questionState(answers.get("b"), "practice")).toBe("wrong");
  expect(questionState(answers.get("c"), "practice")).toBe("answered");
  expect(questionState(answers.get("b"), "test")).toBe("answered");
  expect(questionState(undefined, "test")).toBe("open");
});
