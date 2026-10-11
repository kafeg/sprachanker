import { expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { ReviewDay } from "../../src/notebook/review-day.tsx";
import { renderApp } from "../render.tsx";

const DAY = new Date(2026, 9, 8, 4).getTime();
const ID = "01JRRRRRRRRRRRRRRRRRRRRRRR";
const answer = (
  id: string,
  minutes: number,
  rating: number,
  interval: number,
  ms: number | null,
  card: unknown,
) => ({
  id,
  ts: DAY + minutes * 60_000,
  cardId: `c${id}`,
  face: "recognition",
  rating,
  interval,
  ms,
  card,
});
const word = (target: string, translation: string, gender?: string) => ({
  display: { target, translation, gender, series: "x", lessonKey: "x/c/00-01" },
  lang: "de",
});

test("a deck's review day: its study day's date and language, what it held, each answer in order — the word, the side, the rating, the interval, the time — and the days around it", async () => {
  const went: Array<string | null> = [];
  const view = await renderApp(<ReviewDay id={ID} lang="de" go={(run) => went.push(run)} />, {
    data: [
      [
        ["notebook", "review", ID, "de"],
        {
          run: {
            id: ID,
            edition: null,
            status: "finished",
            endReason: "completed",
            // Begun at 2 AM the next morning, ended a day later: the study day is its date.
            startedAt: DAY + 22 * 3_600_000,
            finishedAt: DAY + 46 * 3_600_000,
          },
          date: DAY,
          answers: [
            answer("1", 10, 3, 600_000, 4_200, word("der Abend", "evening", "m")),
            answer("2", 11, 1, 60_000, 60_000, word("die Tasse", "cup", "f")),
            // An answer from before answers were timed; a card since left.
            answer("3", 12, 4, 4 * 86_400_000, null, null),
          ],
          day: { answers: 3, newCards: 2, recalled: 1, remembered: 1, ms: 64_200 },
          earlier: "01JQQQQQQQQQQQQQQQQQQQQQQQ",
          later: null,
        },
      ],
    ],
  });
  expect(await view.findByRole("heading", { name: "Review of Oct 8" })).toBeTruthy();
  expect(view.getByText("German")).toBeTruthy();
  const tile = (label: string) =>
    view.getAllByText(label, { selector: "p" })[0]?.parentElement?.firstChild?.textContent;
  expect([
    tile("Cards answered"),
    tile("New cards"),
    tile("Remembered"),
    tile("Time spent"),
  ]).toEqual(["3", "2", "100%", "1 minute"]);
  const rows = view.getAllByRole("listitem").map((li) => li.textContent);
  expect(rows).toHaveLength(3);
  expect(rows[0]).toMatch(/der\sAbend/);
  expect(rows[0]).toContain("evening");
  expect(rows[0]).toContain("Word → meaning");
  expect(rows[0]).toContain("Good");
  expect(rows[0]).toContain("10m");
  expect(rows[0]).toContain("4 sec");
  expect(rows[1]).toContain("Again");
  expect(rows[1]).toContain("60 sec");
  expect(rows[2]).toContain("a card no longer here");
  expect(rows[2]).toContain("Easy");
  expect(rows[2]).toContain("4d");
  expect(rows[2]).toContain("—");
  // The gender colours the word as everywhere.
  expect(view.getByText(/der\sAbend/).className).toContain("text-der");

  expect(view.getByRole("button", { name: "Later day" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(view.getByRole("button", { name: "Earlier day" }));
  fireEvent.click(view.getByRole("button", { name: "Notebook" }));
  expect(went).toEqual(["01JQQQQQQQQQQQQQQQQQQQQQQQ", null]);
});
