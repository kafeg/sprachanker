import { expect, test } from "bun:test";
import { createDeckExtras } from "../src/services/deck-extras.ts";

/** Deck folders in memory: each folder's extras.json as text. */
function folders(extras: Record<string, string | undefined>) {
  const removed: string[] = [];
  return {
    removed,
    files: {
      extras: (folder: string) => extras[folder],
      writeExtras: (folder: string, text: string) => {
        extras[folder] = text;
      },
      media: () => undefined,
      folders: () => Object.keys(extras),
      remove: (folder: string) => {
        removed.push(folder);
        delete extras[folder];
      },
    },
  };
}

test("at the start a course's folder goes only when its course is no longer installed; one whose files do not read keeps it", () => {
  const { files, removed } = folders({
    "course~dw.nicos-weg~a1": "{}",
    "course~dw.nicos-weg~a2": "{}",
    "course~gone.series~b1": "{}",
    "mein-deck-3f9c2a": "{}",
  });
  // a2 is installed but its files do not read: the library lists it all the same.
  const extras = createDeckExtras({
    files,
    decks: { deck: () => undefined },
    library: {
      courses: () => [
        { series: "dw.nicos-weg", course: "a1", editions: [] },
        { series: "dw.nicos-weg", course: "a2", editions: [] },
      ],
    },
    now: () => 0,
  });
  extras.sweep();
  expect(removed).toEqual(["course~gone.series~b1"]);
});

const audio = (text: string) => ({
  path: `media/read-${text}.wav`,
  engine: "piper" as const,
  voice: "v",
  text,
  made: 1,
});

const store = (files: ReturnType<typeof folders>["files"]) =>
  createDeckExtras({
    files,
    decks: { deck: () => undefined },
    library: { courses: () => [] },
    now: () => 0,
  });

test("extras.json read entry by entry: one that does not read (a newer version's) is left out and written back as it was", async () => {
  const folder = "mein-deck-3f9c2a";
  const newer = { audio: audio("Tisch"), images: ["media/tisch.png"] };
  const { files } = folders({
    [folder]: JSON.stringify({
      format: 1,
      words: {
        "lex:de:apfel:noun:m": { audio: audio("Apfel") },
        "lex:de:tisch:noun:m": newer,
        // An earlier version's entry, keyed by note: it goes.
        n1: { audio: audio("Kaffee") },
      },
    }),
  });
  const extras = store(files);
  expect(Object.keys(extras.book(folder).words)).toEqual(["lex:de:apfel:noun:m"]);
  extras.start("audio", folder, {
    steps: [["lex:de:birne:noun:f"]],
    atOnce: 1,
    saveEvery: 1,
    label: ([key]) => key as string,
    async work([key], book) {
      book.words[key as string] = { audio: audio("Birne") };
      return { done: 1, failed: 0 };
    },
  });
  for (let i = 0; i < 100 && extras.going("audio", folder); i++) await Bun.sleep(1);
  expect(JSON.parse(files.extras(folder) as string).words).toEqual({
    "lex:de:tisch:noun:m": newer,
    "lex:de:apfel:noun:m": { audio: audio("Apfel") },
    "lex:de:birne:noun:f": { audio: audio("Birne") },
  });
});

test("an extras.json that is no JSON reads as none", () => {
  const extras = store(folders({ "mein-deck-3f9c2a": "{ not json" }).files);
  expect(extras.book("mein-deck-3f9c2a").words).toEqual({});
});
