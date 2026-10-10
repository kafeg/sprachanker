// A year of study days as GitHub shows contributions (09, Notebook): a column a week, Monday on top,
// each day shaded by how much was done; the months above, the legend below. Wide on a phone: it
// scrolls sideways and opens on today.
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useDateFormat } from "./format.ts";
import { cn } from "./utils.ts";

/** How many weeks the calendar shows. */
const CALENDAR_WEEKS = 53;

/** The days of the last `weeks` weeks by column, Monday first, up to today (a day's start). */
export function calendarWeeks(today: number, weeks = CALENDAR_WEEKS): number[][] {
  const first = new Date(today);
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7) - 7 * (weeks - 1));
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const day = new Date(first);
      day.setDate(first.getDate() + w * 7 + d);
      return day.getTime();
    }).filter((t) => t <= today),
  );
}

const SHADES = ["bg-muted", "bg-correct/25", "bg-correct/50", "bg-correct/75", "bg-correct"];
/** A day's shade: none, then from 1, 10, 30 and 60 things done. */
export const shadeOf = (count: number) => [0, 1, 10, 30, 60].findLastIndex((n) => count >= n);

const dayKey = (t: number) => new Date(t).toDateString();

export function ActivityCalendar({
  today,
  days,
  describe,
}: {
  today: number;
  /** The days with something done; the others are empty. */
  days: Array<{ start: number; count: number }>;
  /** A day as its title says it. */
  describe(start: number, count: number): string;
}) {
  const { t } = useTranslation();
  const month = useDateFormat("month");
  const weekday = useDateFormat("weekday");
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, []);
  const counts = new Map(days.map((d) => [dayKey(d.start), d.count]));
  const weeks = calendarWeeks(today);
  const cell = "size-3 shrink-0 rounded-sm";
  return (
    <div>
      <div ref={scroller} className="overflow-x-auto pb-1">
        <div
          className="flex min-w-[36rem] gap-[3px]"
          role="img"
          aria-label={t("notebook.calendar")}
        >
          <div className="sticky left-0 z-10 flex flex-col gap-[3px] bg-card pr-1 text-[10px] text-muted-foreground">
            <span className="h-4" />
            {(weeks[1] ?? []).map((d, i) => (
              <span key={d} className="flex flex-1 items-center">
                {i % 2 === 0 ? weekday.format(d) : ""}
              </span>
            ))}
          </div>
          {weeks.map((week, w) => {
            const first = week[0] as number;
            const before = weeks[w - 1]?.[0];
            // A month's name over its first week, when two weeks are left for it to stand over (one
            // at the end would stick out past the calendar).
            const starts =
              before !== undefined &&
              w < weeks.length - 2 &&
              new Date(first).getMonth() !== new Date(before).getMonth();
            return (
              <div key={first} className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="h-4 overflow-visible whitespace-nowrap text-[10px] leading-4 text-muted-foreground">
                  {starts ? month.format(first) : ""}
                </span>
                {week.map((d) => {
                  const count = counts.get(dayKey(d)) ?? 0;
                  return (
                    <span
                      key={d}
                      title={describe(d, count)}
                      className={cn("aspect-square w-full rounded-sm", SHADES[shadeOf(count)])}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex items-center justify-end gap-[3px] text-xs text-muted-foreground">
        <span className="mr-1">{t("notebook.less")}</span>
        {SHADES.map((s) => (
          <span key={s} className={cn(cell, s)} />
        ))}
        <span className="ml-1">{t("notebook.more")}</span>
      </div>
    </div>
  );
}
