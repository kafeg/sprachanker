import { expect, test } from "bun:test";
import { switchLanguage } from "../../src/i18n/index.ts";
import { ActivityCalendar, calendarWeeks } from "../../src/ui/activity-calendar.tsx";
import { firstDayOfWeek } from "../../src/ui/format.ts";
import { renderApp } from "../render.tsx";

/** 8 Oct 2026, a Thursday. */
const TODAY = new Date(2026, 9, 8, 4).getTime();

test("a week starts where the language is spoken: Monday in German, Sunday in English, Saturday in Persian and Arabic", () => {
  expect(["de", "ru", "en", "fa", "ar", "not a tag"].map(firstDayOfWeek)).toEqual([
    1, 1, 0, 6, 6, 1,
  ]);
  // From Saturday: the last column runs Saturday 3 to Thursday 8 October.
  const weeks = calendarWeeks(TODAY, 6);
  expect(weeks.at(-1)?.map((t) => new Date(t).getDate())).toEqual([3, 4, 5, 6, 7, 8]);
  expect(weeks.slice(0, -1).every((w) => new Date(w[0] as number).getDay() === 6)).toBe(true);
});

test("the calendar in Persian and Arabic: Saturday on top, the months Gregorian (they stand over Gregorian weeks)", async () => {
  for (const [lang, saturday, september, persianMonths] of [
    ["fa", "شنبه", "سپتامبر", ["شهریور", "مهر"]],
    ["ar", "سبت", "سبتمبر", []],
  ] as const) {
    await switchLanguage(lang);
    const view = await renderApp(
      <ActivityCalendar today={TODAY} days={[]} describe={(d) => String(d)} />,
    );
    const labels = [...view.container.querySelectorAll("span")].map((s) => s.textContent);
    // The weekdays' column: every other day named, from the first.
    const weekdays = new Intl.DateTimeFormat(lang, { weekday: "short" }).format(
      new Date(2026, 9, 3),
    );
    expect(weekdays).toContain(saturday);
    expect(labels).toContain(weekdays);
    expect(labels).toContain(september);
    for (const m of persianMonths) expect(labels).not.toContain(m);
    view.unmount();
  }
  await switchLanguage("en");
});
