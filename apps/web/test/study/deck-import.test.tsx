import { expect, test } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { DeckFileSheet, DeckImport, DeckImportSheet } from "../../src/study/deck-import.tsx";
import { server } from "../llm/practice-lesson.ts";
import { renderApp } from "../render.tsx";

const preview = {
  upload: "6f1c2a3b-0000-4000-8000-000000000000",
  title: "Deutsch A1",
  words: 2,
  withAudio: 1,
  withExamples: 0,
  left: { withoutWord: 0, unusable: 0, joined: 0 },
  languages: [] as string[],
  first: [
    { target: "der Abend", translations: { "": "evening" } as Record<string, string> },
    { target: "antworten", translations: {} as Record<string, string> },
  ],
  updates: [] as Array<{ id: never; title: string; lang: string; translationLang: string }>,
};
const file = new File([new Uint8Array([1])], "words.apkg");
const counts = { new: 0, learning: 0, review: 0 };

test("a deck file's sheet: its name, the words' language (the learner's decks'), the translations' (another), its first words", async () => {
  const view = await renderApp(
    <DeckImportSheet file={file} preview={preview} onClose={() => {}} />,
    {
      data: [[["decks"], { decks: [{ scope: "lang:en", language: "en", counts, decks: [] }] }]],
    },
  );
  expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("Deutsch A1");
  expect(view.getByRole("combobox", { name: "Words in" }).textContent).toBe("English");
  // Never the words' own language: the interface's is that, so the first other.
  expect(view.getByRole("combobox", { name: "Translations in" }).textContent).toBe("German");
  expect(view.getByText("2 words · 1 with audio · no examples")).toBeTruthy();
  expect(view.getByText("der Abend")).toBeTruthy();
  expect(view.getByText("· evening")).toBeTruthy();
  expect(view.getByText("antworten")).toBeTruthy();
  // Without a name the deck cannot be imported.
  fireEvent.change(view.getByLabelText("Name"), { target: { value: " " } });
  expect((view.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(true);
});

test("a deck without a name of its own is named after its file; German words by default", async () => {
  const view = await renderApp(
    <DeckImportSheet file={file} preview={{ ...preview, title: "" }} onClose={() => {}} />,
    { data: [[["decks"], { decks: [] }]] },
  );
  expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("words");
  expect(view.getByRole("combobox", { name: "Words in" }).textContent).toBe("German");
  expect(view.getByRole("combobox", { name: "Translations in" }).textContent).toBe("English");
  // The words in the translations' language: the translations move to another.
  fireEvent.click(view.getByRole("combobox", { name: "Words in" }));
  fireEvent.click(await view.findByRole("option", { name: "English" }));
  await waitFor(() =>
    expect(view.getByRole("combobox", { name: "Translations in" }).textContent).toBe("German"),
  );
  fireEvent.click(view.getByRole("combobox", { name: "Translations in" }));
  await view.findByRole("option", { name: "Russian" });
  expect(view.queryByRole("option", { name: "English" })).toBeNull();
});

test("fields named by language: the words' is the first, the translations' one of the others, each shown in it", async () => {
  const named = {
    ...preview,
    left: { withoutWord: 1, unusable: 0, joined: 2 },
    withExamples: 2,
    languages: ["de", "en", "ru"],
    first: [{ target: "die Zeit", translations: { en: "time", ru: "время" } }],
  };
  const view = await renderApp(<DeckImportSheet file={file} preview={named} onClose={() => {}} />, {
    data: [[["decks"], { decks: [] }]],
  });
  expect(view.getByRole("combobox", { name: "Words in" }).textContent).toBe("German");
  // The interface's language (English) is one the deck has.
  expect(view.getByRole("combobox", { name: "Translations in" }).textContent).toBe("English");
  expect(view.getByText("· time")).toBeTruthy();
  expect(view.getByText("2 words · 1 with audio · 2 with examples")).toBeTruthy();
  expect(view.getByText(/^1 note without a word is left out\./).textContent).toBe(
    "1 note without a word is left out. 2 notes of words already in it are joined to those words, their translations added.",
  );
});

test("a file of decks here: the first's name and languages kept, the sheet says which deck the languages chosen update", async () => {
  const updates = [
    { id: "a1-abc123" as never, title: "A1", lang: "de", translationLang: "ru" },
    { id: "a1-def456" as never, title: "A1 (en)", lang: "de", translationLang: "en" },
  ];
  const view = await renderApp(
    <DeckImportSheet
      file={file}
      preview={{ ...preview, languages: ["de", "en", "ru"], updates }}
      onClose={() => {}}
    />,
    { data: [[["decks"], { decks: [] }]] },
  );
  expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("A1");
  expect(view.getByRole("combobox", { name: "Translations in" }).textContent).toBe("Russian");
  expect(view.getByText(/^This file updates the deck A1 here/)).toBeTruthy();
  fireEvent.click(view.getByRole("combobox", { name: "Translations in" }));
  fireEvent.click(await view.findByRole("option", { name: "English" }));
  expect(view.getByText(/^This file updates the deck A1 \(en\) here/)).toBeTruthy();
});

const deckFile = {
  upload: "7a1c2a3b-0000-4000-8000-000000000000",
  kind: "imported" as "imported" | "course" | "finds",
  title: "Mein Deck",
  lang: "de" as never,
  translationLangs: ["ru"] as never[],
  course: null,
  words: 4,
  withAudio: 2,
  withExamples: 1,
  merges: false,
  waits: false,
};

test("one button takes both kinds of deck file: a package (.apkg) and a deck exported here (.sprachanker-deck, zipped again too)", async () => {
  const view = await renderApp(<DeckImport />, { data: [[["decks"], { decks: [] }]] });
  const input = view.getByLabelText("Import a deck file") as HTMLInputElement;
  // Any file too: Android's picker greys out a type it does not know.
  expect(input.accept.split(",")).toEqual([".apkg", ".sprachanker-deck", ".zip", "*/*"]);
});

test("a deck file exported here — the server tells it by its content —: what it holds and where it goes, then imported by its upload", async () => {
  const asked = server((path) =>
    path === "/api/decks/preview"
      ? deckFile
      : {
          kind: "imported",
          title: "Mein Deck",
          course: null,
          words: 4,
          withAudio: 2,
          withExamples: 1,
        },
  );
  const view = await renderApp(<DeckImport />, { data: [[["decks"], { decks: [] }]] });
  const input = view.getByLabelText("Import a deck file") as HTMLInputElement;
  const chosen = new File([new Uint8Array([1, 2])], "mein-deck-3f9c2a-2026-10-15.zip");
  Object.defineProperty(input, "files", { value: [chosen], configurable: true });
  fireEvent.change(input);
  expect(await view.findByText("Mein Deck")).toBeTruthy();
  expect(view.getByText("German · 4 words · 2 with audio · 1 with examples")).toBeTruthy();
  expect(view.getByText(/^Its words become a deck every profile/)).toBeTruthy();
  // No name or languages to choose: the file says them.
  expect(view.queryByLabelText("Name")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Import" }));
  expect((await view.findByRole("status")).textContent).toBe(
    "Imported \u2068Mein Deck\u2069: 4 words. ",
  );
  expect(asked[0]?.startsWith("POST /api/decks/preview")).toBe(true);
  expect(asked).toContain(`POST /api/decks/file/import {"upload":"${deckFile.upload}"}`);
});

test("a deck file's sheet says what becomes of it: merged into the deck here, a course's waiting for its course, one's finds", async () => {
  const sheet = (preview: Partial<typeof deckFile> & { kind?: string }) =>
    renderApp(<DeckFileSheet preview={{ ...deckFile, ...preview } as never} onClose={() => {}} />, {
      data: [[["decks"], { decks: [] }]],
    });
  expect((await sheet({ merges: true })).getByText(/^This deck is here already/)).toBeTruthy();
  expect(
    (await sheet({ kind: "course", course: "dw.nicos-weg/a1" as never, waits: true })).getByText(
      /The course is not on this device yet/,
    ),
  ).toBeTruthy();
  const finds = await sheet({ kind: "finds", title: "Finds" });
  expect(finds.getByText(/^Your finds: they join your own Finds/)).toBeTruthy();
});
