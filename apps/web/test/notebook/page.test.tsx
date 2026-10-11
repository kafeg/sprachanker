import { expect, test } from "bun:test";
import { SPANS, spanBars } from "@sprachanker/engine";
import { fireEvent, waitFor } from "@testing-library/react";
import { NotebookPage } from "../../src/notebook/page.tsx";
import { calendarWeeks, shadeOf } from "../../src/ui/activity-calendar.tsx";
import { firstDayOfWeek } from "../../src/ui/format.ts";
import { renderApp } from "../render.tsx";

/** A day's start `n` days before today (4:00, as the study day starts). */
const TODAY = new Date(2026, 9, 8, 4).getTime();
const daysAgo = (n: number) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return d.getTime();
};
const day = (n: number, fields: Partial<Record<string, unknown>>) => ({
  start: daysAgo(n),
  lesson: 0,
  exam: 0,
  review: 0,
  newCards: 0,
  recalled: 0,
  remembered: 0,
  ai: 0,
  time: { lesson: 0, exam: 0, review: 0, ai: 0 },
  ...fields,
});

const count = (id: string, value: number) => ({ id, value });
/** The German deck: its words by state, what is due, the month's answers. */
const DECK = {
  key: "de",
  title: null,
  lastAt: TODAY,
  open: false,
  runCount: 2,
  // The review days it was studied on, each with its answers in the deck.
  runs: [
    {
      id: "01JRRRRRRRRRRRRRRRRRRRRRRR",
      edition: null,
      status: "active",
      endReason: null,
      startedAt: TODAY,
      finishedAt: null,
      count: 25,
      day: TODAY,
    },
    // Begun at 2 AM, two days ago's study day still; ended when today's first answer came.
    {
      id: "01JSSSSSSSSSSSSSSSSSSSSSSS",
      edition: null,
      status: "finished",
      endReason: "completed",
      startedAt: daysAgo(1) - 2 * 3_600_000,
      finishedAt: TODAY + 3_600_000,
      count: 4,
      day: daysAgo(2),
    },
  ],
  figures: [
    count("new", 5),
    count("learning", 2),
    count("review", 7),
    count("mature", 4),
    count("suspended", 1),
    { id: "remembered", value: 0.9, share: true, count: 20 },
    count("dueToday", 3),
    count("dueTomorrow", 6),
    count("dueWeek", 12),
  ],
};
/** The Notebook as the server gives it: the days, each span's bars (a week from English's first
 *  day), every module's standing. */
const FIRST_DAY = firstDayOfWeek("en");
const overview = (
  days: Array<{ start: number }>,
  lessons: unknown[] = [],
  exams: unknown[] = [],
  decks = [DECK],
) => ({
  days,
  today: TODAY,
  spans: Object.fromEntries(
    SPANS.map((span) => [span, spanBars(span, TODAY, days[0]?.start, FIRST_DAY)]),
  ),
  modules: [
    { module: "review", figures: [count("wordsKnown", 42)], entries: decks },
    {
      module: "lesson",
      figures: [
        { id: "lessonsDone", value: 3, at: [daysAgo(40), daysAgo(2), daysAgo(2)] },
        { id: "coursesDone", value: 0, at: [] },
      ],
      entries: lessons,
    },
    { module: "exam", figures: [], entries: exams },
  ],
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
        ["notebook", FIRST_DAY],
        overview(
          [
            day(40, { lesson: 10, review: 20, newCards: 5, recalled: 4, remembered: 4 }),
            day(2, {
              review: 8,
              recalled: 8,
              remembered: 6,
              ai: 2,
              time: { lesson: 0, exam: 0, review: 240_000, ai: 60_000 },
            }),
            day(1, { time: { lesson: 60_000, exam: 0, review: 0, ai: 0 } }),
            day(0, { lesson: 3 }),
          ],
          [
            {
              key: "sprachanker.test/demo/00-01",
              title: "Hallo",
              group: { key: "sprachanker.test/demo", title: "Demo course" },
              lastAt: TODAY,
              open: false,
              runCount: 2,
              figures: [{ id: "best", value: 0.75, share: true }],
              runs: [],
            },
          ],
        ),
      ],
    ],
  });
  // A tile's value by its label (a picture's heading may say the same).
  const tile = (label: string) =>
    view.getAllByText(label, { selector: "p" })[0]?.parentElement?.firstChild?.textContent;
  expect(await view.findByText("Words known")).toBeTruthy();
  expect([tile("Words known"), tile("Lessons done"), tile("Courses done")]).toEqual([
    "42",
    "3",
    "0",
  ]);
  // Each language's deck: its words by state, what is due, the month's answers.
  expect([tile("Learnt"), tile("Remembered, 30 days")]).toEqual(["4", "90%"]);
  expect(view.getByText("20 answers")).toBeTruthy();
  expect([tile("Due today"), tile("Due by tomorrow"), tile("Due within a week")]).toEqual([
    "3",
    "6",
    "12",
  ]);
  expect(view.getByText("Demo course")).toBeTruthy();
  // Its words by state as one bar, each state named with its count.
  expect(
    view.getByRole("img", {
      name: "Words by state: New 5, Learning 2, Review 7, Learnt 4, Suspended 1",
    }),
  ).toBeTruthy();
  // All time, then the last 7 days.
  expect([
    tile("Study days"),
    tile("Cards answered"),
    tile("Remembered"),
    tile("Time spent"),
  ]).toEqual(["3", "28", "83%", "6 minutes"]);
  // All time began 40 days ago: the pictures go by week, the cards answered with the new ones apart.
  expect(view.getAllByText(/by week/)).toHaveLength(4);
  const cards = view.getByRole("img", { name: "Cards answered" });
  expect(cards.children).toHaveLength(7);
  expect(view.getAllByTitle(/^week of .*: 20 cards, 5 new$/)).toHaveLength(1);
  expect(view.getAllByTitle(/: 75% of 8 answers$/)).toHaveLength(1);
  expect(
    view.getAllByTitle(/: 6 minutes \(lessons 1 minute, cards 4 minutes, AI 1 minute\)$/),
  ).toHaveLength(1);
  // Lessons done by the end of each week: one, then three.
  expect(view.getAllByTitle(/: 2 lessons done, 3 in all$/)).toHaveLength(1);
  fireEvent.click(view.getByRole("button", { name: "7 days" }));
  expect([
    tile("Study days"),
    tile("Cards answered"),
    tile("New cards"),
    tile("AI practice"),
  ]).toEqual(["2", "8", "0", "2"]);
  // Seven days, a bar each.
  expect(view.getAllByText(/by day/)).toHaveLength(4);
  expect(view.getByRole("img", { name: "Cards answered" }).children).toHaveLength(7);
  // Each day of the calendar says what it held.
  expect(view.getAllByTitle(/: cards 8, AI 2$/)).toHaveLength(1);
  expect(view.getAllByTitle(/: nothing done$/).length).toBeGreaterThan(300);

  // The deck's review days, each dated by its study day, not by when it ended.
  expect(view.getByRole("button", { name: /4 answers/ }).textContent).toContain("Oct 6");
  expect(view.getByRole("button", { name: /25 answers/ }).textContent).toContain("Oct 8");
  // A review day of the deck opens its answers in it.
  fireEvent.click(view.getByRole("button", { name: /25 answers/ }));
  await waitFor(() =>
    expect(view.router?.state.location.pathname).toBe(
      "/notebook/review/01JRRRRRRRRRRRRRRRRRRRRRRR",
    ),
  );
  expect(view.router?.state.location.search).toEqual({ lang: "de" });

  const lesson = view.getByRole("button", { name: /0\.1 Hallo/ });
  expect(lesson.textContent).toContain("2 passes");
  expect(lesson.textContent).toContain("75%");
  fireEvent.click(lesson);
  await waitFor(() =>
    expect(view.router?.state.location.pathname).toBe("/notebook/sprachanker.test/demo/00-01"),
  );
});

test("an empty Notebook says under each section what will appear; nothing remembered yet is a dash", async () => {
  const view = await renderApp(<NotebookPage />, {
    path: "/notebook",
    data: [[["notebook", FIRST_DAY], overview([], [], [], [])]],
  });
  for (const heading of ["Review", "Lessons", "Exams"])
    expect(await view.findByRole("heading", { name: heading })).toBeTruthy();
  expect(view.getByText(/No cards yet/)).toBeTruthy();
  expect(view.getByText(/No lesson worked on yet/)).toBeTruthy();
  expect(view.getByText(/Nothing handed in yet/)).toBeTruthy();
  expect(view.getByText("Remembered").parentElement?.firstChild?.textContent).toBe("—");
});

test("the mock exams handed in, by exam: each its date, points and whether it passed; one opens its result", async () => {
  const run = (id: string, points: number, passed: boolean) => ({
    id,
    edition: "de-de",
    status: "finished",
    endReason: "completed",
    startedAt: TODAY,
    finishedAt: TODAY,
    mode: "test",
    points,
    max: 33,
    passed,
  });
  const view = await renderApp(<NotebookPage />, {
    path: "/notebook",
    data: [
      [
        ["notebook", FIRST_DAY],
        overview(
          [],
          [],
          [
            {
              key: "bamf.lid/lid/exam-test",
              title: "Leben in Deutschland",
              lastAt: TODAY,
              open: false,
              runCount: 2,
              figures: [],
              runs: [
                run("01JAAAAAAAAAAAAAAAAAAAAAAA", 29, true),
                run("01JBBBBBBBBBBBBBBBBBBBBBBB", 12, false),
              ],
            },
          ],
        ),
      ],
    ],
  });
  expect(await view.findByText("Exams")).toBeTruthy();
  const [best, worst] = view.getAllByRole("button", { name: /of 33/ });
  expect(best?.textContent).toContain("29 of 33");
  expect(best?.textContent).toContain("Passed");
  expect(worst?.textContent).toContain("Not passed");
  fireEvent.click(best as HTMLElement);
  await waitFor(() =>
    expect(view.router?.state.location.pathname).toBe(
      "/exam/bamf.lid/lid/test/run/01JAAAAAAAAAAAAAAAAAAAAAAA",
    ),
  );
});
