import { expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { NotebookPage } from "../../src/notebook/page.tsx";
import { calendarWeeks, shadeOf } from "../../src/ui/activity-calendar.tsx";
import { renderApp } from "../render.tsx";

/** A day's start `n` days before today (4:00, as the study day starts). */
const TODAY = new Date(2026, 9, 8, 4).getTime();
const daysAgo = (n: number) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return d.getTime();
};
const day = (n: number, fields: Partial<Record<string, number>>) => ({
  start: daysAgo(n),
  lesson: 0,
  review: 0,
  newCards: 0,
  recalled: 0,
  remembered: 0,
  ai: 0,
  ...fields,
});

const overview = (days: unknown[], courses: unknown[] = []) => ({
  days,
  today: TODAY,
  wordsKnown: 42,
  lessonsDone: 3,
  courses,
});

test("the calendar: a year of weeks by column, Monday on top, up to today; shades by work done", () => {
  const weeks = calendarWeeks(TODAY);
  expect(weeks).toHaveLength(53);
  // 8 Oct 2026 is a Thursday: the last column runs Monday to Thursday.
  expect(weeks.at(-1)?.map((t) => new Date(t).getDate())).toEqual([5, 6, 7, 8]);
  expect(
    weeks.slice(0, -1).every((w) => w.length === 7 && new Date(w[0] as number).getDay() === 1),
  ).toBe(true);
  expect([0, 1, 9, 10, 29, 30, 60, 500].map(shadeOf)).toEqual([0, 1, 1, 2, 2, 3, 4, 4]);
});

test("the Notebook: progress, the study days with totals by span, then the lessons by course", async () => {
  const view = await renderApp(<NotebookPage />, {
    path: "/notebook",
    data: [
      [
        ["notebook"],
        overview(
          [
            day(40, { lesson: 10, review: 20, newCards: 5, recalled: 4, remembered: 4 }),
            day(2, { review: 8, recalled: 8, remembered: 6, ai: 2 }),
            day(0, { lesson: 3 }),
          ],
          [
            {
              key: "sprachanker.test/demo",
              title: "Demo course",
              lastAt: TODAY,
              lessons: [
                {
                  key: "sprachanker.test/demo/00-01",
                  course: "sprachanker.test/demo",
                  title: "Hallo",
                  passes: 2,
                  best: 0.75,
                  open: false,
                  lastAt: TODAY,
                },
              ],
            },
          ],
        ),
      ],
    ],
  });
  const tile = (label: string) => view.getByText(label).parentElement?.firstChild?.textContent;
  expect(await view.findByText("Words known")).toBeTruthy();
  expect([tile("Words known"), tile("Lessons done")]).toEqual(["42", "3"]);
  // All time, then the last 7 days.
  expect([tile("Study days"), tile("Cards answered"), tile("Remembered")]).toEqual([
    "3",
    "28",
    "83%",
  ]);
  fireEvent.click(view.getByRole("button", { name: "7 days" }));
  expect([
    tile("Study days"),
    tile("Cards answered"),
    tile("New cards"),
    tile("AI practice"),
  ]).toEqual(["2", "8", "0", "2"]);
  // Each day of the calendar says what it held.
  expect(view.getAllByTitle(/: cards 8, AI 2$/)).toHaveLength(1);
  expect(view.getAllByTitle(/: nothing done$/).length).toBeGreaterThan(300);

  const lesson = view.getByRole("button", { name: /0\.1 Hallo/ });
  expect(lesson.textContent).toContain("2 passes");
  expect(lesson.textContent).toContain("75%");
  fireEvent.click(lesson);
  await waitFor(() =>
    expect(view.router?.state.location.pathname).toBe("/notebook/sprachanker.test/demo/00-01"),
  );
});

test("an empty Notebook says what will appear; nothing remembered yet is a dash", async () => {
  const view = await renderApp(<NotebookPage />, {
    path: "/notebook",
    data: [[["notebook"], overview([])]],
  });
  expect(await view.findByText(/Nothing yet/)).toBeTruthy();
  expect(view.getByText("Remembered").parentElement?.firstChild?.textContent).toBe("—");
});
