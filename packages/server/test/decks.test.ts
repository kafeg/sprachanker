import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildApkg } from "@sprachanker/anki-export/testing";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import { ulid } from "ulid";
import { setup } from "./setup.ts";

const COURSE = "sprachanker.fixture/demo";
const SOUND = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 9, 9, 9]);
const study = (scope: string) => `/api/cards/study?scope=${encodeURIComponent(scope)}`;
/** A media file's path in a deck's folder: its name's slug and a hash of the name. */
const mediaPath = (slug: string, ext = "mp3") =>
  expect.stringMatching(new RegExp(`^media/${slug}-[0-9a-f]{12}\\.${ext}$`));

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

test("a package previewed, imported as a deck with its audio; its media served from its folder alone", async () => {
  const { upload, preview, importDeck, getJson, get, sendJson, wordsOf } = await withDecks();
  const seen = await preview(deck());
  expect(seen).toEqual({
    upload: expect.stringMatching(/^[0-9a-f-]{36}$/),
    title: "Mein Deck",
    words: 4,
    withAudio: 1,
    withExamples: 0,
    languages: [],
    first: [
      { target: "der Kaffee", translations: { "": "кофе" } },
      { target: "die Leute", translations: { "": "люди" } },
      { target: "der Apfel", translations: { "": "яблоко" } },
      { target: "antworten", translations: { "": "отвечать" } },
    ],
    updates: null,
  });
  // An upload is imported once; another id is no upload.
  const request = { title: "x", lang: "de", translationLang: "ru", file: "x.apkg" };
  expect(
    (await sendJson("POST", "/api/decks/import", { ...request, upload: crypto.randomUUID() }))
      .error,
  ).toBe("deck_upload_gone");
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
  const kaffee = wordsOf(summary.id).n1?.audio as string;
  expect(kaffee).toEqual(mediaPath("kaffee"));
  const audio = await get(`/decks/${summary.id}/${kaffee}`);
  expect(new Uint8Array(await audio.arrayBuffer())).toEqual(SOUND);
  const part = await get(`/decks/${summary.id}/${kaffee}`, {
    headers: { range: "bytes=0-2" },
  });
  expect(part.status).toBe(206);
  for (const path of ["deck.json", "media/..%2Fdeck.json", "media/none.mp3"])
    expect((await get(`/decks/${summary.id}/${path}`)).status).toBe(404);
  // The same deck again (most of its notes here, the same languages) updates it in place, as its
  // preview says.
  expect((await preview(deck())).updates).toEqual({
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
  expect((await preview(other)).updates).toBeNull();
  const andere = await importDeck(other, "Andere");
  expect(andere).toMatchObject({ words: 3, withAudio: 0 });
  expect((await importDeck(deck(), "Mein Deck (en)", "en")).id).not.toBe(summary.id);
  expect(await titles()).toEqual(["Andere", "Mein Deck (en)", "Mein Deck (neu)"]);
});

test("fields named by language: the translation in the language chosen, the deck's examples with their audio on the card", async () => {
  const { preview, importDeck, getJson, sendJson, get, wordsOf } = await withDecks();
  const fields = [
    "id",
    "part_of_speech",
    "german",
    "sentence_1_german",
    "audio_german",
    "audio_sentence_1_german",
    "english",
    "sentence_1_english",
    "russian",
    "sentence_1_russian",
  ];
  const core = buildApkg({
    deck: "Core",
    fields,
    notes: [
      {
        guid: "c1",
        fields: [
          "1",
          "nf",
          "die Zeit",
          "Ich habe Zeit.",
          "[sound:die-zeit.mp3]",
          "[sound:ich-habe-zeit.mp3]",
          "time",
          "I have time.",
          "время",
          "У меня есть время.",
        ],
      },
      {
        guid: "c2",
        fields: ["2", "die (pl)", "Leute", "", "", "", "people", "", "люди", ""],
      },
    ],
    media: { "die-zeit.mp3": SOUND, "ich-habe-zeit.mp3": SOUND },
  });
  const seen = await preview(core);
  expect(seen).toMatchObject({
    words: 2,
    withAudio: 1,
    withExamples: 1,
    languages: ["de", "en", "ru"],
  });
  expect(seen.first[0]).toEqual({ target: "die Zeit", translations: { en: "time", ru: "время" } });
  const summary = await importDeck(core, "Core");
  expect(summary).toMatchObject({ words: 2, withAudio: 1, withExamples: 1 });
  await sendJson("POST", "/api/cards/decks/take", { deck: summary.id });
  const words = (await getJson("/api/cards")).words;
  expect(words.map((w: { lexemeKey: string }) => w.lexemeKey).sort()).toEqual([
    "lex:de:leute:noun:pl",
    "lex:de:zeit:noun:f",
  ]);
  const zeit = words.find((w: { lexemeKey: string }) => w.lexemeKey === "lex:de:zeit:noun:f");
  expect(zeit.display).toMatchObject({
    target: "die Zeit",
    gender: "f",
    translation: "время",
    audio: mediaPath("die-zeit"),
    examples: [
      {
        sentence: "Ich habe Zeit.",
        translation: "У меня есть время.",
        audio: mediaPath("ich-habe-zeit"),
      },
    ],
  });
  const example = wordsOf(summary.id).c1?.examples?.[0];
  expect((await get(`/decks/${summary.id}/${example?.audio}`)).status).toBe(200);
  // In English: its own deck, the English translations.
  const english = await importDeck(core, "Core (en)", "en");
  expect(english.id).not.toBe(summary.id);
  await sendJson("POST", "/api/cards/decks/take", { deck: english.id });
  const inEnglish = (await getJson("/api/cards")).words.find(
    (w: { lexemeKey: string; display: { deck?: string } }) =>
      w.lexemeKey === "lex:de:zeit:noun:f" && w.display.deck === english.id,
  );
  expect(inEnglish.display).toMatchObject({
    translation: "time",
    examples: [{ translation: "I have time." }],
  });
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
      audio: mediaPath("kaffee"),
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

test("media named apart whatever their case, kept inside the deck's folder whatever their name", async () => {
  const { importDeck, get, wordsOf, root } = await withDecks();
  const sound = (n: number) => new Uint8Array([0x49, 0x44, 0x33, n]);
  const names = ["Abend.mp3", "abend.mp3", "ABEND.MP3", "../evil.mp3", "/tmp/abs.mp3", "a\\b.mp3"];
  const cases = (translation: string) =>
    buildApkg({
      deck: "Fälle",
      fields: ["Wort", "Übersetzung"],
      notes: names.map((name, i) => ({
        guid: `g${i}`,
        fields: [`Wort${i} [sound:${name}]`, translation],
      })),
      media: Object.fromEntries(names.map((name, i) => [name, sound(i)])),
    });
  const { id } = await importDeck(cases("x"), "Fälle");
  const paths = names.map((_, i) => wordsOf(id)[`g${i}`]?.audio as string);
  expect(new Set(paths.map((p) => p.toLowerCase())).size).toBe(names.length);
  for (const [i, path] of paths.entries()) {
    expect(path).toMatch(/^media\/[a-z0-9-]+-[0-9a-f]{12}\.mp3$/);
    const audio = await get(`/decks/${id}/${path}`);
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(sound(i));
  }
  expect(readdirSync(join(root, "decks", id, "media"))).toHaveLength(names.length);
  expect(readdirSync(join(root, "decks")).sort()).toEqual([".uploads", id]);
  // The same file again: the same names.
  await importDeck(cases("y"), "Fälle");
  expect(names.map((_, i) => wordsOf(id)[`g${i}`]?.audio)).toEqual(paths);
});

test("an update that drops a word: its card keeps what it showed and its audio", async () => {
  const { importDeck, getJson, sendJson, get } = await withDecks();
  const { id } = await importDeck();
  await sendJson("POST", "/api/cards/decks/take", { deck: id });
  const card = async () =>
    (await getJson("/api/cards")).words.find(
      (w: { lexemeKey: string }) => w.lexemeKey === "lex:de:kaffee:noun:m",
    );
  const before = await card();
  const dropped = buildApkg({
    deck: "Mein Deck",
    fields: ["Wort", "Plural", "Übersetzung", "Wortart"],
    notes: [
      { guid: "n2", fields: ["die Leute", "nur Plural", "люди", "Nomen"] },
      { guid: "n3", fields: ["der Apfel", "die Äpfel", "яблоко", "Nomen"] },
      { guid: "n4", fields: ["antworten", "", "отвечать", "Verb"] },
    ],
  });
  expect((await importDeck(dropped)).id).toBe(id);
  await Bun.sleep(50);
  const after = await card();
  expect(after.display).toEqual(before.display);
  const audio = await get(`/decks/${id}/${after.display.audio}`);
  expect(new Uint8Array(await audio.arrayBuffer())).toEqual(SOUND);
});
