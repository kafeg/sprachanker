import { expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { DeckImportSheet } from "../../src/study/deck-import.tsx";
import { renderApp } from "../render.tsx";

const preview = {
  upload: "6f1c2a3b-0000-4000-8000-000000000000",
  title: "Deutsch A1",
  words: 2,
  withAudio: 1,
  withExamples: 0,
  languages: [] as string[],
  first: [
    { target: "der Abend", translations: { "": "evening" } as Record<string, string> },
    { target: "antworten", translations: {} as Record<string, string> },
  ],
  updates: null,
};
const file = new File([new Uint8Array([1])], "words.apkg");
const counts = { new: 0, learning: 0, review: 0 };

test("a deck file's sheet: its name, the words' language (the learner's decks'), the translations' (the interface's), its first words", async () => {
  const view = await renderApp(
    <DeckImportSheet file={file} preview={preview} onClose={() => {}} />,
    {
      data: [[["decks"], { decks: [{ scope: "lang:en", language: "en", counts, decks: [] }] }]],
    },
  );
  expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("Deutsch A1");
  expect(view.getByRole("combobox", { name: "Words in" }).textContent).toBe("English");
  expect(view.getByRole("combobox", { name: "Translations in" }).textContent).toBe("English");
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
});

test("fields named by language: the words' is the first, the translations' one of the others, each shown in it", async () => {
  const named = {
    ...preview,
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
});

test("a file of a deck here: its name and languages kept, the sheet says it updates that deck", async () => {
  const updates = { id: "a1-abc123" as never, title: "A1", lang: "de", translationLang: "ru" };
  const view = await renderApp(
    <DeckImportSheet file={file} preview={{ ...preview, updates }} onClose={() => {}} />,
    { data: [[["decks"], { decks: [] }]] },
  );
  expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("A1");
  expect(view.getByRole("combobox", { name: "Translations in" }).textContent).toBe("Russian");
  expect(view.getByText(/^This file updates the deck A1 here/)).toBeTruthy();
});
