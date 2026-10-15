// A deck file's manifest and the paths it may hold: its deck's folder only — deck.json,
// extras.json, audio in media/ under names every disk takes.
import { expect, test } from "bun:test";
import {
  DECK_BUNDLE_FORMAT,
  DECK_BUNDLE_VERSION,
  DeckBundleManifest,
  DeckBundlePath,
} from "../src/index.ts";

const ok = (path: string) => DeckBundlePath.safeParse(path).success;

test("a deck file holds its folder's deck.json, extras.json and audio", () => {
  for (const path of [
    "deck.json",
    "extras.json",
    "media/read-3f9c2a1b2c3d.wav",
    "media/kaffee-0a1b2c3d4e5f.mp3",
    "media/Äpfel.flac",
  ])
    expect([path, ok(path)]).toEqual([path, true]);
});

test("never a path outside the folder, a nested one, a page or picture, a name a disk refuses", () => {
  for (const path of [
    "manifest.json",
    "../deck.json",
    "media/../deck.json",
    "media/..",
    "media/a/b.mp3",
    "media\\x.mp3",
    "media/x.html",
    "media/x.svg",
    "media/x.png",
    "media/x.MP3",
    "media/noext",
    "media/con.mp3",
    "media/a:b.mp3",
    "media/x.mp3 ",
    "/deck.json",
    "decks/x/deck.json",
    "other.json",
  ])
    expect([path, ok(path)]).toEqual([path, false]);
});

const manifest = (deck: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  format: DECK_BUNDLE_FORMAT,
  version: DECK_BUNDLE_VERSION,
  appVersion: "0.1.0",
  exportedAt: 1,
  deck: {
    title: "Mein Deck",
    lang: "de",
    translationLangs: ["ru"],
    words: 2,
    withAudio: 1,
    withExamples: 0,
    ...deck,
  },
  files: [{ path: "deck.json", size: 10, sha256: "a".repeat(64) }],
  ...extra,
});

test("a manifest says its deck's kind and folder: a course's names the course its folder is of", () => {
  const parse = (deck: Record<string, unknown>, extra?: Record<string, unknown>) =>
    DeckBundleManifest.safeParse(manifest(deck, extra)).success;
  expect(parse({ kind: "imported", folder: "mein-deck-3f9c2a" })).toBe(true);
  expect(parse({ kind: "finds", folder: "finds-local-ru-de" })).toBe(true);
  expect(
    parse({ kind: "course", folder: "course~dw.nicos-weg~a1", course: "dw.nicos-weg/a1" }),
  ).toBe(true);
  // A course's folder that is not its course's, a deck's that is a course's, an id that is no slug.
  expect(
    parse({ kind: "course", folder: "course~dw.nicos-weg~a2", course: "dw.nicos-weg/a1" }),
  ).toBe(false);
  expect(parse({ kind: "course", folder: "course~dw.nicos-weg~a1" })).toBe(false);
  expect(parse({ kind: "imported", folder: "course~dw.nicos-weg~a1" })).toBe(false);
  expect(parse({ kind: "imported", folder: "../x" })).toBe(false);
  // A Finds deck's folder is a Finds id, an imported deck's never.
  expect(parse({ kind: "finds", folder: "mein-deck-3f9c2a" })).toBe(false);
  expect(parse({ kind: "imported", folder: "finds-local-ru-de" })).toBe(false);
  expect(parse({ kind: "other", folder: "mein-deck-3f9c2a" })).toBe(false);
  // A newer version, a field it does not know, a listed path outside the folder.
  expect(parse({ kind: "imported", folder: "mein-deck-3f9c2a" }, { version: 2 })).toBe(false);
  expect(parse({ kind: "imported", folder: "mein-deck-3f9c2a" }, { more: 1 })).toBe(false);
  expect(
    parse(
      { kind: "imported", folder: "mein-deck-3f9c2a" },
      { files: [{ path: "../x.mp3", size: 1, sha256: "a".repeat(64) }] },
    ),
  ).toBe(false);
});
