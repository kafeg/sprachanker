import { expect, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { ReviewPage } from "../../src/routes/review.tsx";
import { renderApp } from "../render.tsx";

const COURSE = "sprachanker.test/demo";
const counts = { new: 2, learning: 0, review: 1 };
const DECKS = {
  decks: [
    {
      scope: "lang:de",
      language: "de",
      counts,
      decks: [
        { scope: `course:${COURSE}`, title: "Demo course", editions: ["en-de"], counts },
        { scope: "deck:mein-deck-abc123", title: "Mein Deck", editions: ["ru-de"], counts },
      ],
    },
  ],
};
const OFFERS = {
  courses: [
    // Taken whole: still listed, what is made for its words is made here.
    {
      scope: `course:${COURSE}`,
      series: "sprachanker.test",
      course: "demo",
      edition: "en-de",
      title: "Demo course",
      words: 5,
      mine: 5,
    },
  ],
  imported: [
    {
      scope: "deck:a1-words-def456",
      deck: "a1-words-def456",
      edition: "en-de",
      title: "A1 words",
      words: 5,
      withAudio: 0,
      mine: 1,
    },
    // Taken whole.
    {
      scope: "deck:mein-deck-abc123",
      deck: "mein-deck-abc123",
      edition: "ru-de",
      title: "Mein Deck",
      words: 3,
      withAudio: 3,
      mine: 3,
    },
  ],
};

/** Each deck's words and their audio: the course's all its own, the imported deck's three without. */
const audio = (own: number, missing: number) => ({
  lang: "de",
  words: own + missing,
  own,
  read: 0,
  missing,
  reader: { engine: "piper", voice: "de_DE-thorsten-medium" },
  job: null,
});

const page = () =>
  renderApp(<ReviewPage tab="decks" go={() => {}} />, {
    path: "/review/decks",
    data: [
      [["decks"], DECKS],
      [["deck-offers"], OFFERS],
      [["deck-audio", `course:${COURSE}`], audio(5, 0)],
      [["deck-audio", "deck:mein-deck-abc123"], audio(0, 3)],
      [["deck-audio", "deck:a1-words-def456"], audio(0, 5)],
    ],
  });

/** A row's menu ("More"), opened as a keyboard opens it. */
function openMenu(view: Awaited<ReturnType<typeof page>>, row: HTMLElement) {
  const more = within(row).getByRole("button", { name: "More" });
  fireEvent.keyDown(more, { key: "Enter" });
  return view;
}

test("Decks: each deck one row under its language — counts, Study, a menu to leave it; how its audio stands in a line that opens what makes it", async () => {
  const view = await page();
  await waitFor(() => expect(view.getByRole("button", { name: "Mein Deck" })).toBeTruthy());
  // Once each: a deck taken is not listed again among the decks to take.
  expect(view.getAllByText("Mein Deck")).toHaveLength(1);
  expect(view.getAllByText("Demo course")).toHaveLength(1);
  const row = document.getElementById("deck-deck-mein-deck-abc123") as HTMLElement;
  expect(row.textContent).toContain("3 words without audio");
  // What makes its audio opens from its line.
  expect(within(row).queryByRole("button", { name: "Generate audio" })).toBeNull();
  fireEvent.click(within(row).getByRole("button", { name: "Audio and examples" }));
  expect(within(row).getByText("Audio: 0 of 3")).toBeTruthy();
  expect(within(row).getByRole("button", { name: "Generate audio" })).toBeTruthy();
  // Left from its menu, asked first; the action itself asks nothing more: no ellipsis on it.
  openMenu(view, row);
  fireEvent.click(await view.findByRole("menuitem", { name: "Leave deck…" }));
  expect(view.getByText(/^Leave the deck Mein Deck/)).toBeTruthy();
  expect(view.getByRole("button", { name: "Leave deck" })).toBeTruthy();
});

test("Decks to take: only those not taken, the rest of a deck added where some of its words are cards already, an imported one deleted; a deck file to import", async () => {
  const view = await page();
  await waitFor(() => expect(view.getByText("A1 words")).toBeTruthy());
  expect(view.getByText("Decks to take")).toBeTruthy();
  expect(view.getByText(/5 words · 1 yours already/)).toBeTruthy();
  expect(view.getByRole("button", { name: "Add the other 4" })).toBeTruthy();
  // The name and count keep their room (14rem) beside the button, which wraps under them on a phone.
  expect(view.getByText("A1 words").closest("[data-deck-name]")?.className.split(" ")).toContain(
    "flex-[1_1_14rem]",
  );
  // Taken whole (the course, Mein Deck): nothing to add.
  expect(view.getAllByRole("button", { name: /^(Take the deck|Add the other \d+)$/ })).toHaveLength(
    1,
  );
  expect(view.getByRole("button", { name: "Import a deck file (.apkg)" })).toBeTruthy();
  const row = document.getElementById("deck-deck-a1-words-def456") as HTMLElement;
  openMenu(view, row);
  fireEvent.click(await view.findByRole("menuitem", { name: "Delete deck…" }));
  expect(view.getByText("Delete the deck A1 words?")).toBeTruthy();
});
