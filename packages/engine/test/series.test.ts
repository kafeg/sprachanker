import { expect, test } from "bun:test";
import type { DayActivity } from "@sprachanker/schema";
import { activityBars, barStart, countBars, spanBars } from "../src/learner/series.ts";
import { answerMs } from "../src/srs/index.ts";

// Study days start at 4 AM local time.
const day = (y: number, m: number, d: number, h = 4) => new Date(y, m - 1, d, h).getTime();
const today = day(2026, 10, 11); // a Sunday

test("a bar's start: its study day's, its week's first day, its month's first", () => {
  // 2 AM still belongs to the day before.
  expect(barStart(day(2026, 10, 11, 2), "day")).toBe(day(2026, 10, 10));
  expect(barStart(today, "week")).toBe(day(2026, 10, 5)); // Monday
  expect(barStart(today, "week", 0)).toBe(today); // Sunday
  expect(barStart(today, "week", 6)).toBe(day(2026, 10, 10)); // Saturday
  expect(barStart(today, "month")).toBe(day(2026, 10, 1));
});

test("a span's bars: 7 or 30 days by day; all time by day, week or month by how long it is", () => {
  const week = spanBars("week", today, undefined);
  expect(week.size).toBe("day");
  expect(week.starts).toHaveLength(7);
  expect(week.starts[0]).toBe(day(2026, 10, 5));
  expect(week.starts.at(-1)).toBe(today);
  const month = spanBars("month", today, undefined);
  expect(month.starts).toHaveLength(30);
  expect(month.starts[0]).toBe(day(2026, 9, 12));
  // Nothing yet, or begun within the last 30 days: those 30 days.
  expect(spanBars("all", today, undefined)).toEqual(month);
  expect(spanBars("all", today, day(2026, 9, 20))).toEqual(month);
  // Begun ten weeks ago: by week from the week it began.
  const weeks = spanBars("all", today, day(2026, 8, 3, 18));
  expect(weeks.size).toBe("week");
  expect(weeks.starts[0]).toBe(day(2026, 8, 3));
  expect(weeks.starts.at(-1)).toBe(day(2026, 10, 5));
  expect(weeks.starts).toHaveLength(10);
  // Begun more than 26 weeks ago: by month.
  const months = spanBars("all", today, day(2025, 11, 20));
  expect(months.size).toBe("month");
  expect(months.starts[0]).toBe(day(2025, 11, 1));
  expect(months.starts).toHaveLength(12);
});

test("each bar's totals of its days, and things counted within a bar and by its end", () => {
  const none = { lesson: 0, exam: 0, review: 0, ai: 0 };
  const of = (start: number, review: number, recalled: number, remembered: number) =>
    ({
      start,
      lesson: 0,
      exam: 0,
      review,
      ai: 0,
      newCards: review - recalled,
      recalled,
      remembered,
      time: { ...none, review: review * 10_000 },
    }) satisfies DayActivity;
  const starts: [number, number] = [day(2026, 9, 28), day(2026, 10, 5)];
  const bars = activityBars(
    [of(day(2026, 9, 27), 5, 5, 5), of(day(2026, 9, 29), 10, 4, 3), of(today, 6, 2, 1)],
    starts,
  );
  expect(bars.map((b) => [b.start, b.review, b.newCards, b.remembered, b.timeAll])).toEqual([
    [starts[0], 10, 6, 0.75, 100_000],
    [starts[1], 6, 4, 0.5, 60_000],
  ]);
  expect(countBars([day(2026, 9, 1), day(2026, 9, 30), day(2026, 10, 6), today], starts)).toEqual([
    { start: starts[0], within: 1, total: 2 },
    { start: starts[1], within: 2, total: 4 },
  ]);
});

test("an answer's time as kept: whole ms, at most a minute", () => {
  expect(answerMs(12_345.6)).toBe(12_346);
  expect(answerMs(3_600_000)).toBe(60_000);
  expect(answerMs(-5)).toBe(0);
});
