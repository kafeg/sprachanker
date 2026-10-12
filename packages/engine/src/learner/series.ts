// The Notebook's pictures over time: a span of study days cut into bars — days, weeks or months —
// and what each bar holds: the study days' totals (cards, the share remembered, time spent) and how
// many things had come to count by then (lessons done). The server cuts the bars (its study days),
// the web sums them. Pure: the caller passes today's start, the first study day and the day a week
// starts on where the learner's language is spoken.
import type { DayActivity } from "@sprachanker/schema";
import { studyDay } from "../srs/index.ts";
import { activityTotals } from "./activity.ts";

/** What the Notebook's totals and pictures cover: all time, the last 30 days or the last 7. */
export const SPANS = ["all", "month", "week"] as const;
export type Span = (typeof SPANS)[number];
/** What one bar of a picture stands for. */
export type BarSize = "day" | "week" | "month";

/** All time is drawn by week while that is no more than this many bars, then by month. */
const MOST_WEEKS = 26;
const SPAN_DAYS = { month: 30, week: 7 } as const;

/** The start of the bar holding `t`: its study day's start (the day starts at 4 AM), going back to the
 *  week's first day (`firstDay`: 0 Sunday … 6 Saturday) or the month's first. */
export function barStart(t: number, size: BarSize, firstDay = 1) {
  const d = new Date(studyDay(t).start);
  if (size === "week") d.setDate(d.getDate() - ((d.getDay() - firstDay + 7) % 7));
  if (size === "month") d.setDate(1);
  return d.getTime();
}

/** `n` bars on from the bar starting at `start` (back with a negative `n`). */
function shift(start: number, size: BarSize, n: number) {
  const d = new Date(start);
  if (size === "month") d.setMonth(d.getMonth() + n);
  else d.setDate(d.getDate() + n * (size === "week" ? 7 : 1));
  return d.getTime();
}

/** The bars of a span, oldest first, each its start: the last 7 or 30 days by day; all time from the
 *  first study day (none: today) — within the last 30 days, those 30 by day; else by week, by month
 *  once that is more than 26 weeks. */
export function spanBars(
  span: Span,
  today: number,
  first: number | undefined,
  firstDay = 1,
): { size: BarSize; starts: number[] } {
  const day = barStart(today, "day");
  const back = (size: BarSize, from: number) => {
    const starts = [barStart(today, size, firstDay)];
    while ((starts[0] as number) > from) starts.unshift(shift(starts[0] as number, size, -1));
    return { size, starts };
  };
  if (span !== "all") return back("day", shift(day, "day", 1 - SPAN_DAYS[span]));
  const since = first === undefined ? day : barStart(first, "day");
  if (since > shift(day, "day", -SPAN_DAYS.month)) return spanBars("month", today, first, firstDay);
  const weeks = back("week", barStart(since, "week", firstDay));
  return weeks.starts.length <= MOST_WEEKS ? weeks : back("month", barStart(since, "month"));
}

/** Each bar's totals of the study days in it (`activityTotals`). */
export function activityBars(days: DayActivity[], starts: number[]) {
  return starts.map((start, i) => ({ start, ...activityTotals(days, start, starts[i + 1]) }));
}

/** Of things that came to count at these times (a lesson first done), how many came in each bar and
 *  how many by its end. */
export function countBars(at: number[], starts: number[]) {
  return starts.map((start, i) => {
    const end = starts[i + 1] ?? Number.POSITIVE_INFINITY;
    return {
      start,
      within: at.filter((t) => t >= start && t < end).length,
      total: at.filter((t) => t < end).length,
    };
  });
}
