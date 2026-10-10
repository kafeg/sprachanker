import { expect, test } from "bun:test";
import type { TypedEvent } from "@sprachanker/schema";
import { activityByDay, activityTotals } from "../src/learner/activity.ts";

const DAY = 86_400_000;
const e = (id: string, day: number, type: string, payload: unknown = {}) =>
  ({ id, runId: "R", ts: day * DAY + 1000, type, itemKey: null, payload }) as TypedEvent;
const review = (id: string, day: number, rating: number, state: number | null) =>
  e(id, day, "card_review", { rating, stateBefore: state === null ? null : { state } });

test("each study day by module: lesson work, exam answers, reviews without the ones taken back, new cards, remembered, AI in any run", () => {
  const days = activityByDay(
    [
      e("a", 1, "answered"),
      e("b", 1, "step_done"),
      review("r1", 1, 3, null),
      review("r2", 1, 1, null),
      e("u", 1, "card_undo", { review: "r2" }),
      review("r3", 3, 3, 2),
      review("r4", 3, 1, 2),
      e("t", 3, "llm_turn", { role: "user" }),
      e("m", 3, "llm_turn", { role: "assistant" }),
      e("v", 3, "llm_verdict"),
      // An exam run's answers: exam work, not a lesson's.
      { ...e("x", 3, "answered"), runId: "X" },
      // The model's proposal and a conversation's line in an exam run: AI practice, as anywhere.
      { ...e("xv", 3, "llm_verdict"), runId: "X" },
      { ...e("xt", 3, "llm_turn", { role: "user" }), runId: "X" },
      { ...e("xm", 3, "llm_turn", { role: "assistant" }), runId: "X" },
    ],
    (ts) => Math.floor(ts / DAY) * DAY,
    (runId) => (runId === "X" ? "exam" : "lesson"),
  );
  expect(days).toEqual([
    { start: DAY, lesson: 2, exam: 0, review: 1, ai: 0, newCards: 1, recalled: 0, remembered: 0 },
    {
      start: 3 * DAY,
      lesson: 0,
      exam: 1,
      review: 2,
      newCards: 0,
      recalled: 2,
      remembered: 1,
      ai: 4,
    },
  ]);
  expect(activityTotals(days)).toEqual({
    activeDays: 2,
    lesson: 2,
    exam: 1,
    review: 3,
    newCards: 1,
    ai: 4,
    remembered: 0.5,
  });
  expect(activityTotals(days, 2 * DAY)).toMatchObject({ activeDays: 1, lesson: 0, review: 2 });
  expect(activityTotals([]).remembered).toBeUndefined();
});
