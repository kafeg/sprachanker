import { expect, test } from "bun:test";
import { createDeckExtras } from "../src/services/deck-extras.ts";
import { until } from "./until.ts";

/** Deck folders in memory: each folder's extras.json as text. */
function folders(extras: Record<string, string | undefined>) {
  const removed: string[] = [];
  const removedMedia: string[] = [];
  return {
    removed,
    removedMedia,
    files: {
      extras: (folder: string) => extras[folder],
      writeExtras: (folder: string, text: string) => {
        extras[folder] = text;
      },
      media: () => undefined,
      removeMedia: (folder: string, path: string) => {
        removedMedia.push(`${folder}/${path}`);
      },
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
  await until(() => !extras.going("audio", folder));
  expect(JSON.parse(files.extras(folder) as string).words).toEqual({
    "lex:de:tisch:noun:m": newer,
    "lex:de:apfel:noun:m": { audio: audio("Apfel") },
    "lex:de:birne:noun:f": { audio: audio("Birne") },
  });
});

test("what was made removed: the audio read with its files, never the deck's own; the examples of one language; not while the job works", async () => {
  const folder = "mein-deck-3f9c2a";
  const made = (sentence: string) => ({
    items: [{ sentence, translation: "…" }],
    model: "m",
    made: 1,
  });
  const newer = { audio: audio("Tisch"), images: ["media/tisch.png"] };
  const { files, removedMedia } = folders({
    [folder]: JSON.stringify({
      format: 1,
      words: {
        "lex:de:apfel:noun:m": { audio: audio("Apfel"), examples: { ru: made("Der Apfel.") } },
        "lex:de:birne:noun:f": { examples: { ru: made("Die Birne."), en: made("Die Birne!") } },
        // A file the deck brought, named as a reading could be: never removed.
        "lex:de:kaffee:noun:m": { audio: { ...audio("Kaffee"), path: "media/kaffee-1.mp3" } },
        "lex:de:tisch:noun:m": newer,
      },
    }),
  });
  const extras = createDeckExtras({
    files,
    decks: {
      deck: () =>
        ({ words: [{ lexeme: "lex:de:kaffee:noun:m", audio: "media/kaffee-1.mp3" }] }) as never,
    },
    library: { courses: () => [] },
    now: () => 0,
  });
  expect(extras.clear("audio", folder)).toBe(2);
  expect(removedMedia).toEqual([`${folder}/media/read-Apfel.wav`]);
  expect(extras.clear("examples", folder, "ru")).toBe(2);
  // What is left: the English examples, and the entry that did not read, as it was.
  expect(JSON.parse(files.extras(folder) as string).words).toEqual({
    "lex:de:tisch:noun:m": newer,
    "lex:de:birne:noun:f": { examples: { en: made("Die Birne!") } },
  });
  expect(extras.clear("examples", folder, "ru")).toBe(0);
  // Its job working: refused.
  let go = () => {};
  extras.start("examples", folder, {
    steps: [["x"]],
    atOnce: 1,
    saveEvery: 1,
    label: () => "x",
    work: () =>
      new Promise((resolve) => {
        go = () => resolve({ done: 0, failed: 0 });
      }),
  });
  expect(() => extras.clear("examples", folder, "en")).toThrow("deck_job_running");
  // The other kind is not held back.
  expect(extras.clear("audio", folder)).toBe(0);
  go();
  for (let i = 0; i < 100 && extras.going("examples", folder); i++) await Bun.sleep(1);
  expect(extras.clear("examples", folder, "en")).toBe(1);
  expect(extras.job("examples", folder)).toBeNull();
});

test("an extras.json that is no JSON reads as none", () => {
  const extras = store(folders({ "mein-deck-3f9c2a": "{ not json" }).files);
  expect(extras.book("mein-deck-3f9c2a").words).toEqual({});
});
