import { expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildApkg } from "@sprachanker/anki-export/testing";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import { ulid } from "ulid";
import { deckFiles } from "../src/runtime/decks.ts";
import { DECK_MAX_BYTES } from "../src/services/decks.ts";
import { COURSE, deck, mediaPath, SOUND, study, withDecks } from "./deck-setup.ts";
import { until } from "./until.ts";

test("a package previewed, imported as a deck with its audio; its media served from its folder alone", async () => {
  const api = await withDecks();
  const { upload, preview, importDeck, getJson, get, send, sendJson, wordsOf } = api;
  const seen = await preview(deck());
  expect(seen).toEqual({
    upload: expect.stringMatching(/^[0-9a-f-]{36}$/),
    title: "Mein Deck",
    words: 4,
    withAudio: 1,
    withExamples: 0,
    left: { withoutWord: 0, unusable: 0, joined: 0 },
    languages: [],
    first: [
      { target: "der Kaffee", translations: { "": "кофе" } },
      { target: "die Leute", translations: { "": "люди" } },
      { target: "der Apfel", translations: { "": "яблоко" } },
      { target: "antworten", translations: { "": "отвечать" } },
    ],
    updates: [],
  });
  // An upload is imported once; another id is no upload.
  const request = { title: "x", lang: "de", translationLang: "ru", file: "x.apkg" };
  expect(
    (await sendJson("POST", "/api/decks/import", { ...request, upload: crypto.randomUUID() }))
      .error,
  ).toBe("deck_upload_gone");
  // The words and their translations in one language: refused.
  const same = await send("POST", "/api/decks/import", {
    ...request,
    translationLang: "de",
    upload: seen.upload,
  });
  expect([same.status, ((await same.json()) as { error: string }).error]).toEqual([
    400,
    "deck_same_languages",
  ]);
  // A package announced larger than taken: refused before it is read.
  const large = await api.app.request("/api/decks/preview", {
    method: "POST",
    headers: {
      cookie: api.cookie,
      ...CLIENT_HEADERS,
      "content-type": "application/octet-stream",
      "content-length": String(DECK_MAX_BYTES + 1),
    },
    body: new Uint8Array(8),
  });
  expect([large.status, ((await large.json()) as { error: string }).error]).toEqual([
    413,
    "deck_too_large",
  ]);
  // Sent in chunks without its length: refused before it is read, never held to be counted.
  let pulled = false;
  const chunked = await api.app.request("/api/decks/preview", {
    method: "POST",
    headers: { cookie: api.cookie, ...CLIENT_HEADERS, "content-type": "application/octet-stream" },
    body: new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled = true;
          controller.enqueue(deck());
          controller.close();
        },
      },
      { highWaterMark: 0 },
    ),
  });
  expect([chunked.status, ((await chunked.json()) as { error: string }).error, pulled]).toEqual([
    411,
    "length_required",
    false,
  ]);
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
  expect(audio.headers.get("content-security-policy")).toContain("sandbox");
  const part = await get(`/decks/${summary.id}/${kaffee}`, {
    headers: { range: "bytes=0-2" },
  });
  expect(part.status).toBe(206);
  for (const path of ["deck.json", "media/..%2Fdeck.json", "media/none.mp3"])
    expect((await get(`/decks/${summary.id}/${path}`)).status).toBe(404);
  // The same deck again (most of its notes here, the same languages) updates it in place, as its
  // preview says.
  expect((await preview(deck())).updates).toEqual([
    { id: summary.id, title: "Mein Deck", lang: "de", translationLang: "ru" },
  ]);
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
  expect((await preview(other)).updates).toEqual([]);
  const andere = await importDeck(other, "Andere");
  expect(andere).toMatchObject({ words: 3, withAudio: 0 });
  const english = (await importDeck(deck(), "Mein Deck (en)", "en")).id;
  expect(english).not.toBe(summary.id);
  expect(await titles()).toEqual(["Andere", "Mein Deck (en)", "Mein Deck (neu)"]);
  // The file is two decks here now: the preview names both, each import updates the one of its
  // languages.
  expect(
    (await preview(deck())).updates.map((d: { id: string; translationLang: string }) => [
      d.id,
      d.translationLang,
    ]),
  ).toEqual(
    expect.arrayContaining([
      [summary.id, "ru"],
      [english, "en"],
    ]),
  );
  expect((await importDeck(deck(), "Mein Deck (en, 2)", "en")).id).toBe(english);
  expect((await importDeck(deck(), "Mein Deck (ru, 2)", "ru")).id).toBe(summary.id);
  expect(await titles()).toEqual(["Andere", "Mein Deck (en, 2)", "Mein Deck (ru, 2)"]);
});

test("a preview's first words with their translations, read from the same notes; notes left out and why", async () => {
  const { preview, sendJson } = await withDecks();
  const seen = await preview(
    buildApkg({
      deck: "Lücken",
      fields: ["german", "russian"],
      notes: [
        { guid: "e1", fields: ["", "пусто"] },
        { guid: "e2", fields: ["", "пусто"] },
        ...["eins", "zwei", "drei", "vier", "fünf", "sechs"].map((w, i) => ({
          guid: `w${i}`,
          fields: [w, `перевод ${i}`],
        })),
        { guid: "p", fields: ["…", "многоточие"] },
      ],
    }),
  );
  // Counted as the import counts: the note without a lemma ("…") left out here too.
  expect(seen).toMatchObject({ words: 6, left: { withoutWord: 2, unusable: 1, joined: 0 } });
  const made = await sendJson("POST", "/api/decks/import", {
    upload: seen.upload,
    title: "Lücken",
    lang: "de",
    translationLang: "ru",
    file: "l.apkg",
  });
  expect(made).toMatchObject({ words: 6, left: { withoutWord: 2, unusable: 1 } });
  expect(seen.first).toEqual(
    ["eins", "zwei", "drei", "vier", "fünf"].map((target, i) => ({
      target,
      translations: { ru: `перевод ${i}` },
    })),
  );
});

test("two notes of one word: one word, both senses' translations; the preview counts as the import does, audio only that the package holds", async () => {
  const { preview, sendJson, wordsOf } = await withDecks();
  const seen = await preview(
    buildApkg({
      deck: "Kern",
      fields: ["german", "russian"],
      notes: [
        { guid: "a1", fields: ["ab [sound:ab.mp3]", "с"] },
        { guid: "a2", fields: ["ab", "в, от, прочь"] },
        { guid: "k", fields: ["die Kraft [sound:kraft.mp3]", "сила"] },
        { guid: "d1", fields: ["damit", "с этим, чтобы"] },
        { guid: "d2", fields: ["damit", "чтобы"] },
      ],
      // The package lacks kraft.mp3, though its note names it.
      media: { "ab.mp3": new Uint8Array([1, 2, 3]) },
    }),
  );
  expect(seen).toMatchObject({
    words: 3,
    withAudio: 1,
    left: { withoutWord: 0, unusable: 0, joined: 2 },
  });
  const made = await sendJson("POST", "/api/decks/import", {
    upload: seen.upload,
    title: "Kern",
    lang: "de",
    translationLang: "ru",
    file: "k.apkg",
  });
  expect(made).toMatchObject({ words: 3, withAudio: 1, left: { joined: 2 } });
  const words = wordsOf(made.id) as Record<string, { translation?: string; audio?: string }>;
  expect(Object.keys(words)).toEqual(["a1", "k", "d1"]);
  expect(words.a1).toMatchObject({ translation: "с; в, от, прочь" });
  expect(words.a1?.audio).toBeTruthy();
  expect(words.d1?.translation).toBe("с этим, чтобы; чтобы");
  expect(words.k?.audio).toBeUndefined();
});

test("a package of words most of them of two notes updates its deck when imported again; a note that makes no word leaves the word's other notes", async () => {
  const { preview, sendJson, getJson, wordsOf } = await withDecks();
  const pairs = ["ab", "damit", "doch"].flatMap((w) => [
    { guid: `${w}1`, fields: [w, `${w}-1`] },
    { guid: `${w}2`, fields: [w, `${w}-2`] },
  ]);
  // A guid too long for a word's key: that note is left out, not "auf"'s other one.
  const notes = [
    ...pairs,
    { guid: "x".repeat(201), fields: ["auf", "на"] },
    { guid: "auf2", fields: ["auf", "в"] },
  ];
  const request = (upload: string) => ({
    upload,
    title: "Paare",
    lang: "de",
    translationLang: "ru",
    file: "p.apkg",
  });
  const apkg = () => buildApkg({ deck: "Paare", fields: ["german", "russian"], notes });
  const first = await sendJson(
    "POST",
    "/api/decks/import",
    request((await preview(apkg())).upload),
  );
  expect(first).toMatchObject({ words: 4, left: { unusable: 1, joined: 3 } });
  expect((wordsOf(first.id) as Record<string, { translation?: string }>).auf2).toMatchObject({
    translation: "в",
  });
  const again = await preview(apkg());
  expect(again.updates).toMatchObject([{ id: first.id }]);
  const updated = await sendJson("POST", "/api/decks/import", request(again.upload));
  expect(updated.id).toBe(first.id);
  expect((await getJson("/api/decks")).decks).toHaveLength(1);
});

test("the preview tells an update as the import does: the package's words counted in the deck's own languages", async () => {
  const { preview, sendJson, getJson } = await withDecks();
  const old = [
    ["вечер", "Abend"],
    ["хлеб", "Brot"],
    ["кафе", "Café"],
    ["крыша", "Dach"],
  ].map(([ru, de]) => ({ guid: `g-${de}`, fields: [ru as string, de as string] }));
  // Four notes of one German word, each with its own Russian: one word in German, four in Russian.
  const fresh = [1, 2, 3, 4].map((i) => ({ guid: `x${i}`, fields: [`ксилофон ${i}`, "Xylophon"] }));
  const apkg = (notes: typeof old) =>
    buildApkg({ deck: "Paare", fields: ["russian", "german"], notes });
  const request = (upload: string) => ({
    upload,
    title: "Paare",
    lang: "de",
    translationLang: "ru",
    file: "p.apkg",
  });
  const first = await sendJson(
    "POST",
    "/api/decks/import",
    request((await preview(apkg(old))).upload),
  );
  expect(first.words).toBe(4);
  const again = await preview(apkg([...old, ...fresh]));
  expect(again.languages).toEqual(["ru", "de"]);
  // Counted in the language named first (Russian) it has eight words, which would not update a deck
  // of four; in the deck's own (German) five: it updates it, as the import does.
  expect(again.words).toBe(8);
  expect(again.updates).toMatchObject([{ id: first.id }]);
  const updated = await sendJson("POST", "/api/decks/import", request(again.upload));
  expect(updated).toMatchObject({ id: first.id, words: 5 });
  expect((await getJson("/api/decks")).decks).toHaveLength(1);
});

test("notes of one word joined as long as they make one word together: one that would not is left out alone", async () => {
  const { preview, sendJson, wordsOf } = await withDecks();
  // The second note's guid is too long for a word's key: alone it makes no word, but joined to the
  // first it adds its translation; the third joins too.
  const notes = [
    { guid: "auf1", fields: ["auf", "на"] },
    { guid: "x".repeat(201), fields: ["auf", "в"] },
    { guid: "auf3", fields: ["auf", "к"] },
  ];
  const { upload } = await preview(
    buildApkg({ deck: "Auf", fields: ["german", "russian"], notes }),
  );
  const made = await sendJson("POST", "/api/decks/import", {
    upload,
    title: "Auf",
    lang: "de",
    translationLang: "ru",
    file: "a.apkg",
  });
  expect(made).toMatchObject({ words: 1, left: { unusable: 0, joined: 2 } });
  expect((wordsOf(made.id) as Record<string, { translation?: string }>).auf1).toMatchObject({
    translation: "на; в; к",
  });
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
  // The deck studies its four words, Leute's card the course's — shown in the deck as the deck gives
  // it (a deck's own entry of its word).
  const first = await getJson(study(scope));
  expect(first.counts).toEqual({ new: 8, learning: 0, review: 0 });
  expect(first.current.display).toEqual({
    target: "die Leute",
    gender: "pl",
    translation: "люди",
    deck: id,
  });
  const words = (await getJson("/api/cards")).words;
  const kaffee = words.find((w: { lexemeKey: string }) => w.lexemeKey === "lex:de:kaffee:noun:m");
  // My words: a course's entry over an imported deck's — the course (a deck of the learner's in this
  // pair) has Kaffee, in its first lesson; the card is still the deck's.
  expect(kaffee).toMatchObject({
    deck: scope,
    display: {
      target: "der Kaffee, die Kaffees",
      audio: "media/audio/kaffee.mp3",
      lessonKey: `${COURSE}/00-01`,
    },
  });
  // Studied in the deck: the deck's own entry, its recording.
  expect(
    (await getJson(`/api/cards/${kaffee.cardId}/examples?deck=${encodeURIComponent(scope)}`)).scope,
  ).toBe(scope);
  const inDeck = async () => {
    for (let i = 0; i < 4; i++) {
      const current = (await getJson(study(scope))).current;
      if (current.cardId === kaffee.cardId) return current.display;
      await sendJson("POST", `/api/cards/${current.cardId}/bury`, {});
    }
  };
  expect(await inDeck()).toEqual({
    target: "der Kaffee",
    gender: "m",
    plural: "die Kaffees",
    translation: "кофе",
    audio: mediaPath("kaffee"),
    deck: id,
  });
  await sendJson("POST", "/api/cards/unbury", { scope });
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
  await until(async () => (await apfel()) === "der Apfel: яблоко");
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

test("a deck studied by a profile: offered with who studies it, not deleted until no one does", async () => {
  const { importDeck, getJson, send, sendJson } = await withDecks();
  const { id } = await importDeck();
  await sendJson("POST", "/api/cards/decks/take", { deck: id });
  const offer = async () =>
    (await getJson("/api/cards/decks/offers")).imported.find(
      (o: { deck: string }) => o.deck === id,
    );
  expect((await offer()).studiedBy).toHaveLength(1);
  expect((await send("DELETE", `/api/decks/${id}`, {})).status).toBe(409);
  await sendJson("POST", "/api/cards/decks/leave", { scope: `deck:${id}`, lang: "de" });
  expect((await offer()).studiedBy).toEqual([]);
  expect((await send("DELETE", `/api/decks/${id}`, {})).status).toBe(200);
});

test("a profile whose database does not open counts as studying a deck: it is not deleted, the others still listed", async () => {
  const api = await withDecks();
  const { id } = await api.importDeck();
  await api.anonymous("POST", "/api/profiles", { name: "Kaputt" });
  const open = api.profiles.open;
  const logged = console.error;
  console.error = () => {};
  api.profiles.open = (profile) => {
    // The first profile ("local", signed in) opens; the other does not.
    if (profile !== "local") throw new Error("file is not a database");
    return open(profile);
  };
  try {
    const offers = await api.getJson("/api/cards/decks/offers");
    expect(offers.imported.find((o: { deck: string }) => o.deck === id).studiedBy).toEqual([
      "Kaputt",
    ]);
    expect((await api.send("DELETE", `/api/decks/${id}`, {})).status).toBe(409);
  } finally {
    api.profiles.open = open;
    console.error = logged;
  }
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

test("two decks sharing a note keep their own cards; one left, a word the other has moves there", async () => {
  const { importDeck, getJson, sendJson } = await withDecks();
  const fields = ["Wort", "Übersetzung"];
  // The note "t" is der Tisch in one deck and der Stuhl in the other; der Tisch is in both.
  const a = await importDeck(
    buildApkg({
      deck: "A",
      fields,
      notes: [
        { guid: "t", fields: ["der Tisch", "стол"] },
        { guid: "a2", fields: ["die Lampe", "лампа"] },
        { guid: "a3", fields: ["das Bett", "кровать"] },
      ],
    }),
    "A",
  );
  const b = await importDeck(
    buildApkg({
      deck: "B",
      fields,
      notes: [
        { guid: "t", fields: ["der Stuhl", "стул"] },
        { guid: "bt", fields: ["der Tisch", "стол (B)"] },
        { guid: "b3", fields: ["die Tür", "дверь"] },
      ],
    }),
    "B",
  );
  await sendJson("POST", "/api/cards/decks/take", { deck: a.id });
  expect((await sendJson("POST", "/api/cards/decks/take", { deck: b.id })).created).toBe(2);
  const cards = async () =>
    Object.fromEntries(
      (await getJson("/api/cards")).words.map(
        (w: { lexemeKey: string; deck: string; display: { translation: string } }) => [
          w.lexemeKey.split(":")[2],
          [w.deck, w.display.translation],
        ],
      ),
    );
  expect(await cards()).toEqual({
    tisch: [`deck:${a.id}`, "стол"],
    lampe: [`deck:${a.id}`, "лампа"],
    bett: [`deck:${a.id}`, "кровать"],
    stuhl: [`deck:${b.id}`, "стул"],
    tür: [`deck:${b.id}`, "дверь"],
  });
  // A left: der Tisch, which B has too, moves to B with B's translation; the others go.
  expect(
    await sendJson("POST", "/api/cards/decks/leave", { scope: `deck:${a.id}`, lang: "de" }),
  ).toEqual({ removed: 2, moved: 1 });
  expect(await cards()).toEqual({
    tisch: [`deck:${b.id}`, "стол (B)"],
    stuhl: [`deck:${b.id}`, "стул"],
    tür: [`deck:${b.id}`, "дверь"],
  });
});

test("an import asked again — at once or after it ended — answers with the deck it made", async () => {
  const { preview, sendJson, getJson } = await withDecks();
  const { upload } = await preview(deck());
  const request = { upload, title: "Mein Deck", lang: "de", translationLang: "ru", file: "m.apkg" };
  const [first, again] = await Promise.all([
    sendJson("POST", "/api/decks/import", request),
    sendJson("POST", "/api/decks/import", request),
  ]);
  expect(again).toEqual(first);
  // After it ended: the deck it made, what it left out no longer known.
  const { left, ...made } = first;
  expect(left).toEqual({ withoutWord: 0, unusable: 0, joined: 0 });
  expect(await sendJson("POST", "/api/decks/import", request)).toEqual(made);
  expect((await getJson("/api/decks")).decks).toHaveLength(1);
});

test("an upload let go: the sheet closed, or a day old; what a stopped import left goes, a deck left replaced is back", async () => {
  const { preview, send, sendJson, root } = await withDecks();
  const uploads = join(root, "decks", ".uploads");
  const { upload } = await preview(deck());
  expect((await send("DELETE", `/api/decks/uploads/${upload}`, {})).status).toBe(200);
  expect(readdirSync(uploads)).toEqual([]);
  const request = { upload, title: "x", lang: "de", translationLang: "ru", file: "x.apkg" };
  expect((await sendJson("POST", "/api/decks/import", request)).error).toBe("deck_upload_gone");

  // A day later the server lets an upload and the note of the deck one made go itself; at its start
  // a folder being written goes, and a deck stopped between its renames is back.
  const kept = (await preview(deck())).upload;
  const old = (await preview(deck())).upload;
  const dayAgo = new Date(Date.now() - 25 * 60 * 60_000);
  utimesSync(join(uploads, `${old}.apkg`), dayAgo, dayAgo);
  const note = join(uploads, `${crypto.randomUUID()}.deck`);
  writeFileSync(note, "gone-abc123");
  utimesSync(note, dayAgo, dayAgo);
  const decks = join(root, "decks");
  mkdirSync(join(decks, ".half-abc123.tmp-0a1b2c3d", "media"), { recursive: true });
  mkdirSync(join(decks, ".back-abc123.tmp-1a2b3c4d.old"));
  writeFileSync(join(decks, ".back-abc123.tmp-1a2b3c4d.old", "deck.json"), "{}");
  mkdirSync(join(decks, ".both-abc123.tmp-2a3b4c5d.old"));
  mkdirSync(join(decks, "both-abc123"));
  deckFiles(root).sweep();
  expect(readdirSync(uploads)).toEqual([`${kept}.apkg`]);
  expect(readdirSync(decks).sort()).toEqual([".uploads", "back-abc123", "both-abc123"]);
  expect(readFileSync(join(decks, "back-abc123", "deck.json"), "utf8")).toBe("{}");
});
