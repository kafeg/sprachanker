import { expect, test } from "bun:test";
import type { TypedEvent } from "@sprachanker/schema";
import { activityByDay, activityTotals, IDLE_MS } from "../src/learner/activity.ts";

const DAY = 86_400_000;
const e = (id: string, day: number, type: string, payload: unknown = {}) =>
  ({ id, runId: "R", ts: day * DAY + 1000, type, itemKey: null, payload }) as TypedEvent;
const none = { lesson: 0, exam: 0, review: 0, ai: 0 };
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
    {
      start: DAY,
      lesson: 2,
      exam: 0,
      review: 1,
      ai: 0,
      newCards: 1,
      recalled: 0,
      remembered: 0,
      time: none,
    },
    {
      start: 3 * DAY,
      lesson: 0,
      exam: 1,
      review: 2,
      newCards: 0,
      recalled: 2,
      remembered: 1,
      ai: 4,
      time: none,
    },
  ]);
  expect(activityTotals(days)).toEqual({
    activeDays: 2,
    lesson: 2,
    exam: 1,
    review: 3,
    newCards: 1,
    ai: 4,
    recalled: 2,
    remembered: 0.5,
    time: none,
    timeAll: 0,
  });
  expect(activityTotals(days, 2 * DAY)).toMatchObject({ activeDays: 1, lesson: 0, review: 2 });
  expect(activityTotals([]).remembered).toBeUndefined();
});

test("time spent: a card answer's own, capped at a minute, none before it was measured; elsewhere the gaps between a run's events, each at most IDLE_MS, on the later one's day", () => {
  const card = (id: string, day: number, ms?: number) =>
    e(id, day, "card_review", { rating: 3, stateBefore: null, ...(ms !== undefined && { ms }) });
  const at = (runId: string, day: number, seconds: number) => ({
    runId,
    ts: day * DAY + seconds * 1000,
  });
  const days = activityByDay(
    [
      card("c1", 1, 12_000),
      // An answer left open longer than a minute counts a minute.
      card("c2", 1, 3_600_000),
      // Before answers were timed: no time known.
      card("c3", 1),
      card("c4", 1, 8_000),
      e("u", 1, "card_undo", { review: "c4" }),
    ],
    (ts) => Math.floor(ts / DAY) * DAY,
    (runId) => ({ L: "lesson", X: "exam", C: "ai", R: "review" })[runId] as never,
    [
      // A lesson: 30 s, then an hour away (counts IDLE_MS), then 20 s.
      at("L", 1, 0),
      at("L", 1, 30),
      at("L", 1, 3630),
      at("L", 1, 3650),
      // A chat across midnight: the gap counts on the later day.
      at("C", 1, 86_390),
      at("C", 2, 10),
      // An exam's answers.
      at("X", 2, 100),
      at("X", 2, 160),
      // The day's review run: its time is its answers' own, never its gaps.
      at("R", 1, 0),
      at("R", 1, 50),
    ],
  );
  expect(days.map((d) => [d.start / DAY, d.time])).toEqual([
    [1, { lesson: 50_000 + IDLE_MS, exam: 0, review: 72_000, ai: 0 }],
    [2, { lesson: 0, exam: 60_000, review: 0, ai: 20_000 }],
  ]);
  const totals = activityTotals(days);
  expect(totals.time).toEqual({
    lesson: 50_000 + IDLE_MS,
    exam: 60_000,
    review: 72_000,
    ai: 20_000,
  });
  expect(totals.timeAll).toBe(50_000 + IDLE_MS + 60_000 + 72_000 + 20_000);
  // Before `to`: only the first day.
  expect(activityTotals(days, undefined, 2 * DAY).timeAll).toBe(50_000 + IDLE_MS + 72_000);
});
