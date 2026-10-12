import { expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
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

test("Decks: an imported deck taken is under its language beside the course, left as a course's", async () => {
  const view = await page();
  await waitFor(() => expect(view.getByRole("button", { name: "Mein Deck" })).toBeTruthy());
  expect(view.getByRole("button", { name: "Demo course" })).toBeTruthy();
  // Under the imported deck how its audio stands; it is generated under the decks to take (each of
  // which has words without audio but the course, whose words have their own).
  expect(view.getByText("3 words without audio")).toBeTruthy();
  expect(view.getByText("Audio: 0 of 3")).toBeTruthy();
  expect(view.getAllByRole("button", { name: "Generate audio" })).toHaveLength(2);
  // A card's way to its deck lands on the deck to take.
  expect(document.getElementById("deck-deck-mein-deck-abc123")?.textContent).toContain(
    "Audio: 0 of 3",
  );
  // A course's and an imported deck's leave alike (the language's does not).
  expect(view.getAllByRole("button", { name: "Leave deck…" })).toHaveLength(2);
  fireEvent.click(view.getAllByRole("button", { name: "Leave deck…" })[1] as HTMLElement);
  expect(view.getByText(/^Leave the deck Mein Deck/)).toBeTruthy();
  // The action itself asks nothing more: no ellipsis on it.
  expect(view.getByRole("button", { name: "Leave deck" })).toBeTruthy();
});

test("Decks to take: an imported deck not taken whole, taken or deleted; a deck file to import", async () => {
  const view = await page();
  await waitFor(() => expect(view.getByText("A1 words")).toBeTruthy());
  expect(view.getByText(/5 words · 1 yours already/)).toBeTruthy();
  expect(view.getByRole("button", { name: "Add the other 4" })).toBeTruthy();
  // Taken whole: no more to take, still there to delete — and a course's, to make what its words lack.
  expect(view.getAllByText("Mein Deck")).toHaveLength(2);
  expect(view.getAllByText("Demo course")).toHaveLength(2);
  expect(view.getByText("Audio: 5 of 5")).toBeTruthy();
  expect(view.getAllByRole("button", { name: /^(Take the deck|Add the other \d+)$/ })).toHaveLength(
    1,
  );
  expect(view.getAllByRole("button", { name: "Delete deck" })).toHaveLength(2);
  expect(view.getByRole("button", { name: "Import a deck file (.apkg)" })).toBeTruthy();
  fireEvent.click(view.getAllByRole("button", { name: "Delete deck" })[0] as HTMLElement);
  expect(view.getByText("Delete the deck A1 words?")).toBeTruthy();
});
