// A test app with decks: a synthetic deck file, uploaded and imported through the API, and what a
// deck's folder keeps.
import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildApkg } from "@sprachanker/anki-export/testing";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import { setup } from "./setup.ts";

export const COURSE = "sprachanker.fixture/demo";
export const SOUND = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 9, 9, 9]);
export const study = (scope: string) => `/api/cards/study?scope=${encodeURIComponent(scope)}`;
/** A media file's path in a deck's folder: its name's slug and a hash of the name. */
export const mediaPath = (slug: string, ext = "mp3") =>
  expect.stringMatching(new RegExp(`^media/${slug}-[0-9a-f]{12}\\.${ext}$`));

/** A synthetic deck: a word of the course's first lesson (Kaffee), one of its second (Leute), two of
 *  none. */
export const deck = (translation = "яблоко", apfel = "der Apfel") =>
  buildApkg({
    deck: "Mein Deck",
    model: "Vokabel (de–ru)",
    fields: ["Wort", "Plural", "Übersetzung", "Wortart"],
    notes: [
      { guid: "n1", fields: ["der Kaffee [sound:kaffee.mp3]", "die Kaffees", "кофе", "Nomen"] },
      { guid: "n2", fields: ["die Leute", "nur Plural", "люди", "Nomen"] },
      { guid: "n3", fields: [apfel, "die Äpfel", translation, "Nomen"], tags: ["essen"] },
      { guid: "n4", fields: ["antworten", "", "отвечать", "Verb"] },
    ],
    media: { "kaffee.mp3": SOUND },
  });

export async function withDecks(options: Parameters<typeof setup>[0] = {}) {
  const api = await setup(options);
  const upload = (path: string, body: Uint8Array) =>
    api.app.request(path, {
      method: "POST",
      headers: {
        cookie: api.cookie,
        ...CLIENT_HEADERS,
        "content-type": "application/octet-stream",
      },
      body,
    });
  // biome-ignore lint/suspicious/noExplicitAny: test responses are inspected structurally.
  const preview = async (bytes: Uint8Array): Promise<any> =>
    (await upload("/api/decks/preview", bytes)).json();
  /** A package uploaded, then imported by its upload's id. */
  const importDeck = async (bytes = deck(), title = "Mein Deck", translationLang = "ru") => {
    const { upload: id } = await preview(bytes);
    return (await api.sendJson("POST", "/api/decks/import", {
      upload: id,
      title,
      lang: "de",
      translationLang,
      file: "mein.apkg",
    })) as { id: string; words: number; withAudio: number; withExamples: number; title: string };
  };
  /** A deck's words as its deck.json keeps them, by key. */
  const wordsOf = (
    id: string,
  ): Record<string, { audio?: string; examples?: Array<{ audio?: string }> }> =>
    Object.fromEntries(
      JSON.parse(readFileSync(join(api.root, "decks", id, "deck.json"), "utf8")).words.map(
        (w: { key: string }) => [w.key, w],
      ),
    );
  return { ...api, upload, preview, importDeck, wordsOf };
}
