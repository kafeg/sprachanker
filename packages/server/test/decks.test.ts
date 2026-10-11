import { expect, test } from "bun:test";
import { buildApkg } from "@sprachanker/anki-export/testing";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import { ulid } from "ulid";
import { setup } from "./setup.ts";

const COURSE = "sprachanker.fixture/demo";
const SOUND = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 9, 9, 9]);
const study = (scope: string) => `/api/cards/study?scope=${encodeURIComponent(scope)}`;

/** A synthetic deck: a word of the course's first lesson (Kaffee), one of its second (Leute), two of
 *  none. */
const deck = (translation = "яблоко") =>
  buildApkg({
    deck: "Mein Deck",
    model: "Vokabel (de–ru)",
    fields: ["Wort", "Plural", "Übersetzung", "Wortart"],
    notes: [
      { guid: "n1", fields: ["der Kaffee [sound:kaffee.mp3]", "die Kaffees", "кофе", "Nomen"] },
      { guid: "n2", fields: ["die Leute", "nur Plural", "люди", "Nomen"] },
      { guid: "n3", fields: ["der Apfel", "die Äpfel", translation, "Nomen"], tags: ["essen"] },
      { guid: "n4", fields: ["antworten", "", "отвечать", "Verb"] },
    ],
    media: { "kaffee.mp3": SOUND },
  });

async function withDecks() {
  const api = await setup();
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
  const importDeck = async (bytes = deck(), title = "Mein Deck", translationLang = "ru") =>
    (
      await upload(
        `/api/decks/import?${new URLSearchParams({ title, lang: "de", translationLang, file: "mein.apkg" })}`,
        bytes,
      )
    ).json() as Promise<{ id: string; words: number; withAudio: number; title: string }>;
  return { ...api, upload, importDeck };
}

test("a package previewed, imported as a deck with its audio; its media served from its folder alone", async () => {
  const { upload, importDeck, getJson, get } = await withDecks();
  const preview = await (await upload("/api/decks/preview", deck())).json();
  expect(preview).toEqual({
    title: "Mein Deck",
    words: 4,
    withAudio: 1,
    first: [
      { target: "der Kaffee", translation: "кофе" },
      { target: "die Leute", translation: "люди" },
      { target: "der Apfel", translation: "яблоко" },
      { target: "antworten", translation: "отвечать" },
    ],
    updates: null,
  });
  const bad = await upload("/api/decks/preview", new Uint8Array([1, 2, 3]));
  expect([bad.status, ((await bad.json()) as { error: string }).error]).toEqual([
    422,
    "not_a_deck",
  ]);

  const summary = await importDeck();
  expect(summary).toMatchObject({ title: "Mein Deck", words: 4, withAudio: 1 });
  expect(summary.id).toMatch(/^mein-deck-[0-9a-f]{6}$/);
  expect((await getJson("/api/decks")).decks).toEqual([
    expect.objectContaining({
      id: summary.id,
      lang: "de",
      translationLang: "ru",
      file: "mein.apkg",
    }),
  ]);
  const audio = await get(`/decks/${summary.id}/media/kaffee.mp3`);
  expect(new Uint8Array(await audio.arrayBuffer())).toEqual(SOUND);
  const part = await get(`/decks/${summary.id}/media/kaffee.mp3`, {
    headers: { range: "bytes=0-2" },
  });
  expect(part.status).toBe(206);
  for (const path of ["deck.json", "media/..%2Fdeck.json", "media/none.mp3"])
    expect((await get(`/decks/${summary.id}/${path}`)).status).toBe(404);
  // The same deck again (most of its notes here, the same languages) updates it in place, as its
  // preview says.
  expect(
    ((await (await upload("/api/decks/preview", deck())).json()) as { updates: unknown }).updates,
  ).toEqual({
    id: summary.id,
    title: "Mein Deck",
    lang: "de",
    translationLang: "ru",
  });
  expect((await importDeck(deck(), "Mein Deck (neu)")).id).toBe(summary.id);
  const titles = async () =>
    (await getJson("/api/decks")).decks.map((d: { title: string }) => d.title);
  expect(await titles()).toEqual(["Mein Deck (neu)"]);
  // Another deck sharing a note, or the same in other languages, is a deck of its own; a file that is
  // no audio is not taken.
  const other = buildApkg({
    deck: "Andere",
    fields: ["Wort", "Übersetzung"],
    notes: [
      { guid: "n1", fields: ["der Kaffee [sound:page.html]", "кофе"] },
      { guid: "o2", fields: ["die Birne", "груша"] },
      { guid: "o3", fields: ["der Tisch", "стол"] },
    ],
    media: { "page.html": SOUND },
  });
  expect(
    ((await (await upload("/api/decks/preview", other)).json()) as { updates: unknown }).updates,
  ).toBeNull();
  const andere = await importDeck(other, "Andere");
  expect(andere).toMatchObject({ words: 3, withAudio: 0 });
  expect((await importDeck(deck(), "Mein Deck (en)", "en")).id).not.toBe(summary.id);
  expect(await titles()).toEqual(["Andere", "Mein Deck (en)", "Mein Deck (neu)"]);
});

test("a deck taken as a course's: a word with a card keeps it, the deck studies it; left, its cards go or move", async () => {
  const { importDeck, getJson, sendJson, send } = await withDecks();
  const { id } = await importDeck();
  const scope = `deck:${id}`;
  // The course's second lesson made cards (Leute among them); the deck has Kaffee of its first.
  await sendJson("POST", "/api/cards/lesson", {
    series: FIXTURE_SERIES,
    lessonKey: `${COURSE}/00-02`,
    edition: "ru-de",
  });
  const offer = async () =>
    (await getJson("/api/cards/decks/offers")).imported.find(
      (o: { deck: string }) => o.deck === id,
    );
  expect(await offer()).toMatchObject({ scope, edition: "ru-de", words: 4, mine: 1, withAudio: 1 });
  expect((await sendJson("POST", "/api/cards/decks/take", { deck: id })).created).toBe(3);
  expect((await offer()).mine).toBe(4);
  // The deck studies its four words, Leute's card the course's; the deck's words show what it gives.
  const first = await getJson(study(scope));
  expect(first.counts).toEqual({ new: 8, learning: 0, review: 0 });
  expect(first.current.display).toMatchObject({
    target: "die Leute (Plural)",
    lessonKey: `${COURSE}/00-02`,
  });
  const words = (await getJson("/api/cards")).words;
  const kaffee = words.find((w: { lexemeKey: string }) => w.lexemeKey === "lex:de:kaffee:noun:m");
  expect(kaffee).toMatchObject({
    deck: scope,
    display: {
      target: "der Kaffee",
      gender: "m",
      plural: "die Kaffees",
      translation: "кофе",
      audio: "media/kaffee.mp3",
      deck: id,
    },
  });
  // Review lists it under German beside the course, by its title.
  const german = (await getJson("/api/cards/decks")).decks[0];
  expect(german.decks.map((d: { scope: string; title: string }) => [d.scope, d.title])).toEqual([
    [`course:${COURSE}`, "Демо-курс"],
    [scope, "Mein Deck"],
  ]);
  // A deck card is studied as any: rated, it is learning.
  await sendJson("POST", `/api/cards/${kaffee.cardId}/review`, {
    id: ulid(),
    face: "recognition",
    rating: 3,
    reps: 0,
  });
  expect((await getJson(study(scope))).counts.learning).toBe(1);

  // Imported again with a word corrected: the card shows it.
  await importDeck(deck("der Apfel: яблоко"));
  const apfel = async () =>
    (await getJson("/api/cards")).words.find(
      (w: { lexemeKey: string }) => w.lexemeKey === "lex:de:apfel:noun:m",
    ).display.translation;
  for (let i = 0; i < 20 && (await apfel()) !== "der Apfel: яблоко"; i++) await Bun.sleep(25);
  expect(await apfel()).toBe("der Apfel: яблоко");

  // In use: not deleted.
  const refused = await send("DELETE", `/api/decks/${id}`, {});
  expect([refused.status, ((await refused.json()) as { error: string }).error]).toEqual([
    409,
    "deck_in_use",
  ]);
  // Left: Kaffee — a word of the course, which has cards — moves there with its answer; the others go.
  expect(await sendJson("POST", "/api/cards/decks/leave", { scope, lang: "de" })).toEqual({
    removed: 2,
    moved: 1,
  });
  const moved = await getJson(`/api/cards/${kaffee.cardId}`);
  expect(moved).toMatchObject({ deck: `course:${COURSE}` });
  expect(moved.display.lessonKey).toBe(`${COURSE}/00-01`);
  expect(moved.answers).toHaveLength(1);
  expect(
    (await getJson("/api/cards/decks")).decks[0].decks.map((d: { scope: string }) => d.scope),
  ).toEqual([`course:${COURSE}`]);
  // No card of it left: deleted with its files.
  expect((await send("DELETE", `/api/decks/${id}`, {})).status).toBe(200);
  expect((await getJson("/api/decks")).decks).toEqual([]);
  expect((await send("DELETE", `/api/decks/${id}`, {})).status).toBe(404);
  expect((await sendJson("POST", "/api/cards/decks/take", { deck: id })).error).toBe(
    "no_such_deck",
  );
});
