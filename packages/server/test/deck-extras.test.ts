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
