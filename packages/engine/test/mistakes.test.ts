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
