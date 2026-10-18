import { expect, test } from "bun:test";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DecksTab } from "../../src/routes/decks.tsx";
import { ReviewPage } from "../../src/routes/review.tsx";
import { deckAnchor } from "../../src/study/deck-link.tsx";
import { server } from "../llm/practice-lesson.ts";
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
  other: 0,
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

/** The Decks tab alone, its downloads kept (`made`: what was made for the course's words). */
function decksTab(made = false) {
  const downloads: Array<[string, string]> = [];
  const offers = { ...OFFERS, courses: OFFERS.courses.map((c) => ({ ...c, made })) };
  const view = renderApp(
    <DecksTab open={() => {}} download={(url, name) => downloads.push([url, name])} />,
    {
      path: "/review/decks",
      data: [
        [["decks"], DECKS],
        [["deck-offers"], offers],
        [["deck-audio", `course:${COURSE}`], audio(5, 0)],
        [["deck-audio", "deck:mein-deck-abc123"], audio(0, 3)],
        [["deck-audio", "deck:a1-words-def456"], audio(0, 5)],
      ],
    },
  );
  return { view, downloads };
}

test("Export: a deck's file made ready by the server from its row's menu, asked after, then downloaded under its name", async () => {
  const asked = server((path) =>
    path === "/api/decks/export"
      ? {
          id: "7a1c2a3b-0000-4000-8000-000000000000",
          fileName: "mein-deck.sprachanker-deck",
          bytes: 2048,
        }
      : {},
  );
  const { view: rendered, downloads } = decksTab();
  const view = await rendered;
  await waitFor(() => expect(view.getByRole("button", { name: "Mein Deck" })).toBeTruthy());
  openMenu(view, document.getElementById("deck-deck-mein-deck-abc123") as HTMLElement);
  fireEvent.click(await view.findByRole("menuitem", { name: "Export to a file" }));
  await waitFor(() =>
    expect(downloads).toEqual([
      ["/api/decks/export/7a1c2a3b-0000-4000-8000-000000000000", "mein-deck.sprachanker-deck"],
    ]),
  );
  expect(asked).toEqual([
    'POST /api/decks/export {"scope":"deck:mein-deck-abc123"}',
    "HEAD /api/decks/export/7a1c2a3b-0000-4000-8000-000000000000",
  ]);
  expect(view.getByRole("status").textContent).toBe(
    "Downloading \u201cmein-deck.sprachanker-deck\u201d (2 kB).",
  );
});

test("Export for Anki: every deck, a course's in each of its editions, named as the app names it; made ready, asked after, downloaded; what it holds said", async () => {
  const asked = server((path) =>
    path === "/api/decks/apkg"
      ? {
          id: "7a1c2a3b-0000-4000-8000-000000000001",
          fileName: "sprachanker.test-demo-en-2026-10-19.apkg",
          bytes: 4096,
          notes: 5,
          withAudio: 3,
        }
      : {},
  );
  // A course's words, nothing made for them yet: for Anki all the same.
  const { view: rendered, downloads } = decksTab(false);
  const view = await rendered;
  await waitFor(() => expect(view.getByText("Demo course")).toBeTruthy());
  openMenu(view, document.getElementById(deckAnchor(`course:${COURSE}`)) as HTMLElement);
  fireEvent.click(await view.findByRole("menuitem", { name: "Export for Anki (.apkg)" }));
  await waitFor(() =>
    expect(downloads).toEqual([
      [
        "/api/decks/apkg/7a1c2a3b-0000-4000-8000-000000000001",
        "sprachanker.test-demo-en-2026-10-19.apkg",
      ],
    ]),
  );
  expect(asked).toEqual([
    `POST /api/decks/apkg {"scope":"course:${COURSE}","edition":"en-de","title":"Demo course"}`,
    "HEAD /api/decks/apkg/7a1c2a3b-0000-4000-8000-000000000001",
  ]);
  expect(view.getByRole("status").textContent).toBe(
    "Downloading “sprachanker.test-demo-en-2026-10-19.apkg” (4 kB): 5 words, 3 with audio, as new cards — your progress here is not in it.",
  );
  // A deck to take has it too.
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
  openMenu(view, document.getElementById("deck-deck-a1-words-def456") as HTMLElement);
  expect(await view.findByRole("menuitem", { name: "Export for Anki (.apkg)" })).toBeTruthy();
});

test("Export: a course's words' file only once audio or examples were made for them", async () => {
  const before = await decksTab(false).view;
  await waitFor(() => expect(before.getByText("Demo course")).toBeTruthy());
  openMenu(before, document.getElementById(deckAnchor(`course:${COURSE}`)) as HTMLElement);
  await before.findByRole("menuitem", { name: "Leave deck…" });
  expect(before.queryByRole("menuitem", { name: "Export to a file" })).toBeNull();
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
  before.unmount();
  const after = await decksTab(true).view;
  await waitFor(() => expect(after.getByText("Demo course")).toBeTruthy());
  openMenu(after, document.getElementById(deckAnchor(`course:${COURSE}`)) as HTMLElement);
  expect(await after.findByRole("menuitem", { name: "Export to a file" })).toBeTruthy();
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
  expect(view.getByRole("button", { name: "Import a deck file" })).toBeTruthy();
  const row = document.getElementById("deck-deck-a1-words-def456") as HTMLElement;
  openMenu(view, row);
  // Exported as a file from its menu too.
  expect(await view.findByRole("menuitem", { name: "Export to a file" })).toBeTruthy();
  fireEvent.click(await view.findByRole("menuitem", { name: "Delete deck…" }));
  expect(view.getByText("Delete the deck A1 words?")).toBeTruthy();
});
