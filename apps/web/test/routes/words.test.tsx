import { expect, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { MyWords } from "../../src/routes/words.tsx";
import { renderApp } from "../render.tsx";

const COURSE = "sprachanker.test/demo";
const word = (id: string, target: string, translation: string, extra: Record<string, unknown>) => ({
  cardId: id,
  lexemeKey: `lex:de:${id}:word`,
  display: { target, translation, series: "sprachanker.test", lessonKey: `${COURSE}/00-01` },
  lang: "de",
  deck: `course:${COURSE}`,
  suspended: false,
  marked: false,
  state: "new",
  due: null,
  ...extra,
});
const WORDS = [
  word("01K0000000000000000000000A", "die Tasse", "cup", { state: "new" }),
  word("01K0000000000000000000000B", "der Kaffee", "coffee", {
    state: "review",
    due: Date.now() + 3 * 86_400_000,
    marked: true,
  }),
  word("01K0000000000000000000000C", "gern", "gladly", { state: "learning", suspended: true }),
];
// The deck's title as the server gives it: the course's in the edition of its cards.
const counts = { new: 1, learning: 1, review: 1 };
const DECKS = {
  decks: [
    {
      scope: "lang:de",
      language: "de",
      counts,
      decks: [
        {
          scope: `course:${COURSE}`,
          title: "Demo course",
          editions: ["en-de"],
          counts,
        },
      ],
    },
  ],
};

const page = () =>
  renderApp(<MyWords />, {
    path: "/review/words",
    data: [
      [["words"], { words: WORDS }],
      [["decks"], DECKS],
    ],
  });
const rows = (view: Awaited<ReturnType<typeof page>>) =>
  view.getAllByRole("listitem").map((li) => li.textContent ?? "");

test("My words: every word with its state; search by word or translation", async () => {
  const view = await page();
  await waitFor(() => expect(rows(view)).toHaveLength(3));
  expect(view.getByRole("button", { name: "Demo course" })).toBeTruthy();
  expect(rows(view)[1]).toContain("der Kaffee");
  expect(rows(view)[1]).toContain("Review");
  expect(rows(view)[2]).toContain("Suspended");
  fireEvent.change(view.getByPlaceholderText("Find a word or translation"), {
    target: { value: "COFF" },
  });
  expect(rows(view)).toHaveLength(1);
  expect(rows(view)[0]).toContain("der Kaffee");
});

test("state filters count the words and narrow the table; a column sorts it", async () => {
  const view = await page();
  await waitFor(() => expect(rows(view)).toHaveLength(3));
  const chip = (name: RegExp) => view.getByRole("button", { name });
  expect(chip(/^New 1$/).getAttribute("aria-pressed")).toBe("false");
  expect(chip(/^Marked 1$/)).toBeTruthy();
  fireEvent.click(chip(/^Suspended 1$/));
  expect(rows(view)).toEqual([expect.stringContaining("gern")]);
  fireEvent.click(chip(/^All 3$/));
  // By the word, its article left aside: gern, Kaffee, Tasse.
  fireEvent.click(view.getByRole("button", { name: "Word" }));
  expect(rows(view).map((r) => r.slice(0, 7))).toEqual(["gernSus", "der Kaf", "die Tas"]);
});

test("a word opens its sheet: each card and the answers given", async () => {
  const view = await page();
  await waitFor(() => expect(rows(view)).toHaveLength(3));
  view.client.setQueryData(["word", WORDS[1]?.cardId], {
    ...WORDS[1],
    faces: [
      {
        face: "recognition",
        stage: "review",
        due: Date.now() + 86_400_000,
        lapses: 1,
        suspended: false,
        flag: 0,
      },
    ],
    answers: [{ ts: Date.now(), face: "recognition", rating: 3 }],
  });
  fireEvent.click(view.getByRole("button", { name: /der Kaffee/ }));
  const sheet = within(await view.findByRole("dialog"));
  // The card type, and the answer given to it.
  expect(sheet.getAllByText("Word → meaning")).toHaveLength(2);
  expect(sheet.getByText("forgotten 1 time")).toBeTruthy();
  expect(sheet.getByText("Good")).toBeTruthy();
  expect(sheet.getByRole("link", { name: /Lesson 0\.1/ })).toBeTruthy();
});
