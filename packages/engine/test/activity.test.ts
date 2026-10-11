import { expect, test } from "bun:test";
import type { TypedEvent } from "@sprachanker/schema";
import {
  activityByDay,
  activityTotals,
  BREAK_MS,
  IDLE_MS,
  type Moment,
  pauseMs,
} from "../src/learner/activity.ts";

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
      // A Dialogue's summary comes with its end, not asked for: not counted.
      e("d", 3, "llm_verdict", { task: "dialogue" }),
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

const card = (id: string, day: number, ms?: number) =>
  e(id, day, "card_review", { rating: 3, stateBefore: null, ...(ms !== undefined && { ms }) });
const MODULE_OF = { L: "lesson", M: "lesson", X: "exam", C: "ai", R: "review" } as const;
const byDay = (ts: number) => Math.floor(ts / DAY) * DAY;
/** Every event of every run as one timeline, as the store reads it: in time order, each with the
 *  pause since the one before (`[id, run, day, second of the day]`). */
const timeline = (list: Array<[string, keyof typeof MODULE_OF, number, number]>): Moment[] =>
  list.map(([id, runId, day, s], i) => {
    const ts = day * DAY + s * 1000;
    const before = list[i - 1];
    return { id, runId, ts, gap: before ? ts - (before[2] * DAY + before[3] * 1000) : null };
  });

test("a pause's time: in full up to IDLE_MS, IDLE_MS up to a session break, none past it", () => {
  expect(pauseMs(40_000)).toBe(40_000);
  expect(pauseMs(IDLE_MS)).toBe(IDLE_MS);
  expect(pauseMs(IDLE_MS + 1)).toBe(IDLE_MS);
  expect(pauseMs(BREAK_MS)).toBe(IDLE_MS);
  expect(pauseMs(BREAK_MS + 1)).toBe(0);
});

test("time spent: a card answer's own, capped at a minute, none before it was measured; elsewhere each pause in the later event's module, on its day", () => {
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
    byDay,
    (runId) => MODULE_OF[runId as keyof typeof MODULE_OF],
    timeline([
      // A lesson: 30 s, then an hour away (a new session: none), 20 s, ten minutes (IDLE_MS).
      ["l1", "L", 1, 0],
      ["l2", "L", 1, 30],
      ["l3", "L", 1, 3630],
      ["l4", "L", 1, 3650],
      ["l5", "L", 1, 4250],
      // The day's review run: its answers' own time, an answer taken back none.
      ["c1", "R", 1, 4262],
      ["c2", "R", 1, 4400],
      ["c3", "R", 1, 4410],
      ["c4", "R", 1, 4418],
      ["u", "R", 1, 4420],
      // A chat across midnight: the pause counts on the later day.
      ["t1", "C", 1, 86_390],
      ["t2", "C", 2, 10],
      // An exam after it: from the chat's last message on, then between its answers.
      ["x1", "X", 2, 100],
      ["x2", "X", 2, 160],
    ]),
  );
  const lesson = 30_000 + 20_000 + IDLE_MS;
  expect(days.map((d) => [d.start / DAY, d.time])).toEqual([
    [1, { lesson, exam: 0, review: 72_000, ai: 0 }],
    [2, { lesson: 0, exam: 150_000, review: 0, ai: 20_000 }],
  ]);
  const totals = activityTotals(days);
  expect(totals.time).toEqual({ lesson, exam: 150_000, review: 72_000, ai: 20_000 });
  expect(totals.timeAll).toBe(lesson + 150_000 + 72_000 + 20_000);
  // Before `to`: only the first day.
  expect(activityTotals(days, undefined, 2 * DAY).timeAll).toBe(lesson + 72_000);
});

test("time spent with runs open together — a lesson, its tutor chat, its words as cards, a second tab — counts each pause once", () => {
  const moments = timeline([
    ["l1", "L", 1, 0],
    ["t1", "C", 1, 10],
    ["l2", "L", 1, 20],
    ["t2", "C", 1, 25],
    // A card shown 30 s, but the chat's message was 15 s before: the 15 s since count, once.
    ["k1", "R", 1, 40],
    ["l3", "L", 1, 50],
    // The same lesson in another tab, its own run.
    ["m1", "M", 1, 55],
    ["l4", "L", 1, 60],
  ]);
  const [day] = activityByDay(
    [card("k1", 1, 30_000)],
    byDay,
    (runId) => MODULE_OF[runId as keyof typeof MODULE_OF],
    moments,
  );
  expect(day?.time).toEqual({ lesson: 30_000, exam: 0, review: 15_000, ai: 15_000 });
  // Never more than the time from the first event to the last.
  expect(activityTotals(day ? [day] : []).timeAll).toBe(60_000);
});
