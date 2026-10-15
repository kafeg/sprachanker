// Decks as files between two data folders: an imported deck, a course's extras and a profile's
// Finds exported on one and imported on another — merged into what is there by lexeme —; files a
// newer app wrote, damaged ones and ones with paths outside a deck's folder refused, nothing left of
// them; another profile's Finds never exported; an import refused while a job works, tried again.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { bytesEntry, zipStream } from "@sprachanker/course-kit";
import {
  CLIENT_HEADERS,
  courseDeckFolder,
  DECK_BUNDLE_FORMAT,
  DECK_BUNDLE_VERSION,
} from "@sprachanker/schema";
import { removeInstalledCourse } from "../src/providers.ts";
import { createCardStore } from "../src/services/card-store.ts";
import { deck as apkg, COURSE, withDecks } from "./deck-setup.ts";
import { piper } from "./speech-fakes.ts";
import { until } from "./until.ts";

type Api = Awaited<ReturnType<typeof withDecks>>;
type Shown = { cardId: string; lexemeKey: string; display: { readAudio?: string; deck?: string } };

const COURSE_FOLDER = courseDeckFolder(COURSE);
const WAV = (text: string) => new TextEncoder().encode(`RIFF ${text}`);
const reading = (text: string, file: string) => ({
  path: `media/${file}`,
  engine: "piper" as const,
  voice: "v",
  text,
  made: 1,
});
const examples = (sentence: string, translation = "перевод") => ({
  items: [{ sentence, translation }],
  model: "m",
  made: 1,
});

/** What a deck folder holds, written as the server would: extras.json and media files. */
function put(
  root: string,
  folder: string,
  extras: Record<string, unknown>,
  media: Record<string, Uint8Array> = {},
) {
  const dir = join(root, "decks", folder);
  mkdirSync(join(dir, "media"), { recursive: true });
  writeFileSync(join(dir, "extras.json"), JSON.stringify({ format: 2, words: extras }));
  for (const [name, bytes] of Object.entries(media)) writeFileSync(join(dir, "media", name), bytes);
}

const fileOf = (root: string, folder: string, name: string) =>
  readFileSync(join(root, "decks", folder, name), "utf8");
const mediaOf = (root: string, folder: string) =>
  Object.fromEntries(
    readdirSync(join(root, "decks", folder, "media"))
      .sort()
      .map((name) => [name, readFileSync(join(root, "decks", folder, "media", name)).toString()]),
  );

/** A request as a profile (`cookie`), JSON both ways. */
const as = (api: Api, cookie: string) => ({
  // biome-ignore lint/suspicious/noExplicitAny: test responses are inspected structurally.
  json: async (method: string, path: string, body?: unknown): Promise<any> =>
    (await api.anonymous(method, path, body, { cookie })).json(),
});

/** A deck exported as the web does it: made ready, asked after, downloaded once. The file's bytes,
 *  its name as the download names it. */
async function exported(api: Api, scope: string, cookie = api.cookie) {
  const ready = await as(api, cookie).json("POST", "/api/decks/export", { scope });
  expect(ready.fileName).toEndWith(".sprachanker-deck");
  const url = `/api/decks/export/${ready.id}`;
  expect((await api.app.request(url, { method: "HEAD", headers: { cookie } })).status).toBe(200);
  const res = await api.app.request(url, { headers: { cookie } });
  expect(res.status).toBe(200);
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect(bytes.length).toBe(ready.bytes);
  // Once.
  expect(await as(api, cookie).json("GET", url)).toEqual({ error: "deck_export_gone" });
  return { bytes, fileName: ready.fileName as string };
}

/** A deck file uploaded and previewed, as any deck file is (`cookie`: as another profile). */
async function preview(api: Api, bytes: Uint8Array, cookie = api.cookie) {
  const res = await api.app.request("/api/decks/preview", {
    method: "POST",
    headers: {
      cookie,
      ...CLIENT_HEADERS,
      "content-type": "application/octet-stream",
      "content-length": String(bytes.length),
    },
    body: bytes,
  });
  // biome-ignore lint/suspicious/noExplicitAny: test responses are inspected structurally.
  return { status: res.status, body: (await res.json()) as any };
}
const importFile = (api: Api, upload: string, cookie = api.cookie) =>
  as(api, cookie).json("POST", "/api/decks/file/import", { upload });

const cardsOf = async (getJson: (path: string) => Promise<unknown>) =>
  ((await getJson("/api/cards")) as { words: Shown[] }).words;

/** Another profile on the same server, signed in: its requests. */
async function another(api: Api, name: string) {
  const made = await api.anonymous("POST", "/api/profiles", { name });
  const id = ((await made.json()) as { profile: { id: string } }).profile.id;
  const cookie = (made.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return { id, cookie, ...as(api, cookie) };
}

const transfersLeft = (root: string) =>
  existsSync(join(root, "decks", ".transfers"))
    ? readdirSync(join(root, "decks", ".transfers"))
    : [];

test("an imported deck with its audio and examples exported, imported on a clean data folder: the same deck, its cards play and show them", async () => {
  const a = await withDecks();
  const { id } = await a.importDeck();
  put(
    a.root,
    id,
    {
      "lex:de:apfel:noun:m": {
        audio: reading("der Apfel", "read-apfel.wav"),
        examples: { ru: examples("Der Apfel ist rot.") },
      },
      "lex:de:antworten:verb": { examples: { ru: examples("Ich antworte dir.") } },
    },
    { "read-apfel.wav": WAV("der Apfel") },
  );
  const file = await exported(a, `deck:${id}`);
  expect(file.fileName).toStartWith(`${id}-`);
  expect(transfersLeft(a.root)).toEqual([]);

  const b = await withDecks({ empty: true });
  // Told by its content: a name of its own is no matter.
  const shown = await preview(b, file.bytes);
  expect(shown.status).toBe(200);
  expect(shown.body).toMatchObject({
    kind: "imported",
    title: "Mein Deck",
    lang: "de",
    translationLangs: ["ru"],
    course: null,
    words: 4,
    withAudio: 2,
    withExamples: 2,
    merges: false,
    waits: false,
  });
  expect(await importFile(b, shown.body.upload)).toMatchObject({
    kind: "imported",
    title: "Mein Deck",
    words: 4,
  });
  // The deck's folder as it was: its words, what was made for them, its media.
  for (const name of ["deck.json", "extras.json"])
    expect(JSON.parse(fileOf(b.root, id, name))).toEqual(JSON.parse(fileOf(a.root, id, name)));
  expect(mediaOf(b.root, id)).toEqual(mediaOf(a.root, id));
  expect(transfersLeft(b.root)).toEqual([]);
  // Once: the upload is gone.
  expect(await importFile(b, shown.body.upload)).toEqual({ error: "deck_upload_gone" });

  // A deck to take, as after an .apkg import; taken, its cards play the audio and show the examples.
  const offers = await b.getJson("/api/cards/decks/offers");
  expect(offers.imported.map((d: { deck: string }) => d.deck)).toEqual([id]);
  await b.sendJson("POST", "/api/cards/decks/take", { deck: id });
  const apfel = (await cardsOf(b.getJson)).find((w) => w.lexemeKey === "lex:de:apfel:noun:m");
  expect(apfel?.display.readAudio).toBe(`${id}/media/read-apfel.wav`);
  expect((await b.get(`/decks/${apfel?.display.readAudio}`)).status).toBe(200);
  const made = await b.getJson(`/api/cards/${apfel?.cardId}/examples`);
  expect(made).toMatchObject({ model: "m" });
  expect(made.examples.map((e: { sentence: string }) => e.sentence)).toEqual([
    "Der Apfel ist rot.",
  ]);
});

test("a deck file merged into the deck there — found by its notes though its id there is another —: its words, audio and examples stay; what it lacks is added", async () => {
  const a = await withDecks();
  const { id } = await a.importDeck();
  put(
    a.root,
    id,
    {
      "lex:de:apfel:noun:m": {
        audio: reading("der Apfel", "read-apfel-a.wav"),
        examples: { ru: examples("Der Apfel ist rot.") },
      },
      "lex:de:antworten:verb": { audio: reading("antworten", "read-antworten.wav") },
    },
    { "read-apfel-a.wav": WAV("A"), "read-antworten.wav": WAV("antworten") },
  );
  const file = await exported(a, `deck:${id}`);

  // There: the same notes imported under another name (another id), without "antworten", its own
  // reading of Apfel and English examples.
  const b = await withDecks();
  const { id: there } = await b.importDeck(undefined, "Meine Wörter");
  expect(there).not.toBe(id);
  const here = JSON.parse(fileOf(b.root, there, "deck.json"));
  here.words = here.words.filter((w: { lexeme: string }) => w.lexeme !== "lex:de:antworten:verb");
  writeFileSync(join(b.root, "decks", there, "deck.json"), JSON.stringify(here));
  put(
    b.root,
    there,
    {
      "lex:de:apfel:noun:m": {
        audio: reading("der Apfel", "read-apfel-b.wav"),
        examples: { en: examples("The apple.", "x") },
      },
    },
    { "read-apfel-b.wav": WAV("B") },
  );
  const shown = await preview(b, file.bytes);
  expect(shown.body).toMatchObject({ kind: "imported", merges: true });
  // The word added (the file's three others are there).
  expect(await importFile(b, shown.body.upload)).toMatchObject({ words: 1 });
  expect(existsSync(join(b.root, "decks", id))).toBe(false);
  const merged = JSON.parse(fileOf(b.root, there, "deck.json"));
  expect(merged.title).toBe("Meine Wörter");
  expect(merged.words.map((w: { lexeme: string }) => w.lexeme)).toEqual([
    ...here.words.map((w: { lexeme: string }) => w.lexeme),
    "lex:de:antworten:verb",
  ]);
  expect(JSON.parse(fileOf(b.root, there, "extras.json")).words).toEqual({
    "lex:de:apfel:noun:m": {
      audio: reading("der Apfel", "read-apfel-b.wav"),
      examples: { en: examples("The apple.", "x"), ru: examples("Der Apfel ist rot.") },
    },
    "lex:de:antworten:verb": { audio: reading("antworten", "read-antworten.wav") },
  });
  // The deck's own audio and the reading here stay; the reading added comes; the other one's of
  // Apfel is no deck's.
  const media = mediaOf(b.root, there);
  expect(media["read-apfel-b.wav"]).toBe("RIFF B");
  expect(media["read-antworten.wav"]).toBe("RIFF antworten");
  expect(media["read-apfel-a.wav"]).toBeUndefined();
  expect(Object.keys(media).filter((n) => n.startsWith("kaffee-"))).toHaveLength(1);

  // A deck of its id there in other languages is another deck: the file's is a new one beside it.
  const c = await withDecks();
  await c.importDeck(undefined, "Mein Deck", "en");
  expect(c.wordsOf(id)).toBeDefined();
  const beside = await preview(c, file.bytes);
  expect(beside.body).toMatchObject({ kind: "imported", merges: false });
  await importFile(c, beside.body.upload);
  const decks = (await c.getJson("/api/decks")).decks;
  expect(
    decks.map((d: { id: string; translationLang: string }) => [d.id, d.translationLang]).sort(),
  ).toEqual([
    [id, "en"],
    [`${id}-2`, "ru"],
  ]);
});

test("a course's extras exported, imported where the course is: its cards play the audio; where it is not yet, kept for it", async () => {
  const a = await withDecks();
  put(
    a.root,
    COURSE_FOLDER,
    { "lex:de:gern:word": { audio: reading("gern", "read-gern.wav") } },
    { "read-gern.wav": WAV("gern") },
  );
  const file = await exported(a, `course:${COURSE}`);
  expect(file.fileName).toStartWith("sprachanker.fixture-demo-");

  // Not installed there: kept until it is.
  const empty = await withDecks({ empty: true });
  const waiting = await preview(empty, file.bytes);
  expect(waiting.body).toMatchObject({
    kind: "course",
    course: COURSE,
    lang: "de",
    words: 1,
    withAudio: 1,
    merges: false,
    waits: true,
  });
  expect(await importFile(empty, waiting.body.upload)).toMatchObject({ words: 1 });
  expect(mediaOf(empty.root, COURSE_FOLDER)).toEqual({ "read-gern.wav": "RIFF gern" });

  // Installed there, its words cards: they play the reading once imported.
  const b = await withDecks();
  // Nothing made there yet: no file.
  expect(await b.sendJson("POST", "/api/decks/export", { scope: `course:${COURSE}` })).toEqual({
    error: "no_such_deck",
  });
  await b.sendJson("POST", "/api/cards/lesson", {
    series: FIXTURE_SERIES,
    lessonKey: `${COURSE}/00-01`,
    edition: "ru-de",
  });
  const gern = async () =>
    (await cardsOf(b.getJson)).find((w) => w.lexemeKey === "lex:de:gern:word")?.display;
  expect((await gern())?.readAudio).toBeUndefined();
  const shown = await preview(b, file.bytes);
  expect(shown.body).toMatchObject({ kind: "course", waits: false });
  await importFile(b, shown.body.upload);
  await until(async () => !!(await gern())?.readAudio);
  expect((await gern())?.readAudio).toBe(`${COURSE_FOLDER}/media/read-gern.wav`);
  // Offered for export now.
  const offers = await b.getJson("/api/cards/decks/offers");
  expect(offers.courses.every((c: { made: boolean }) => c.made)).toBe(true);

  // The course removed: what was made for its words stays for its return, as its practice does.
  await removeInstalledCourse(b.root, FIXTURE_SERIES, "demo");
  expect(mediaOf(b.root, COURSE_FOLDER)).toEqual({ "read-gern.wav": "RIFF gern" });
});

test("an import refused while a job works on its deck, kept, and imported once the job is done", async () => {
  const a = await withDecks();
  put(a.root, COURSE_FOLDER, {
    "lex:de:gern:word": { examples: { ru: examples("Ich lerne gern.") } },
  });
  const file = await exported(a, `course:${COURSE}`);

  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const p = piper(["de_DE-thorsten-medium"], true, async (text) => {
    await gate;
    return WAV(text);
  });
  const b = await withDecks({ piper: p.host, readings: p.readings });
  const scope = `course:${COURSE}`;
  await b.sendJson("POST", "/api/decks/audio", { scope });
  const shown = await preview(b, file.bytes);
  expect(await importFile(b, shown.body.upload)).toEqual({ error: "deck_job_running" });
  // Its reading goes on, untouched.
  expect((await b.getJson(`/api/decks/audio?scope=${scope}`)).job.status).toBe("running");
  open();
  await until(
    async () => (await b.getJson(`/api/decks/audio?scope=${scope}`)).job.status === "done",
  );
  // Tried again: the same upload, now imported, beside what the job made.
  expect(await importFile(b, shown.body.upload)).toMatchObject({ kind: "course" });
  const words = JSON.parse(fileOf(b.root, COURSE_FOLDER, "extras.json")).words;
  expect(words["lex:de:gern:word"]).toMatchObject({
    audio: { engine: "piper" },
    examples: { ru: examples("Ich lerne gern.") },
  });
});

test("a profile's Finds imported elsewhere become the importing profile's own: its words added its cards — not one the learner left, its cards from there moved to its words here —; nobody else's Finds are exported", async () => {
  const a = await withDecks();
  const finds = "finds-local-ru-de";
  const word = (key: string, target: string, lexeme: string, translation: string) => ({
    key,
    target,
    lexeme,
    translation,
    tags: ["find"],
  });
  mkdirSync(join(a.root, "decks", finds), { recursive: true });
  writeFileSync(
    join(a.root, "decks", finds, "deck.json"),
    JSON.stringify({
      format: 1,
      id: finds,
      title: "Finds",
      lang: "de",
      translationLang: "ru",
      source: { file: "", importedAt: 1 },
      owner: "local",
      words: [
        {
          ...word("w1", "die Situation", "lex:de:situation:noun:f", "ситуация"),
          audio: "media/find-1.wav",
        },
        word("w2", "der Apfel", "lex:de:apfel:noun:m", "яблоко"),
        word("w3", "der Tisch", "lex:de:tisch:noun:m", "стол"),
        word("w4", "die Lampe", "lex:de:lampe:noun:f", "лампа"),
      ],
    }),
  );
  put(a.root, finds, {}, { "find-1.wav": WAV("die Situation") });
  // Another profile here sees no such deck.
  const anna = await another(a, "Anna");
  expect(await anna.json("POST", "/api/decks/export", { scope: `deck:${finds}` })).toEqual({
    error: "no_such_deck",
  });
  const file = await exported(a, `deck:${finds}`);
  expect(file.fileName).toStartWith("finds-ru-de-");

  // Elsewhere, Ben: his Finds have der Tisch and die Lampe already, under keys of their own; the
  // card of die Lampe he left, his card of der Tisch came from a profile file and still names the
  // deck and key it had there.
  const b = await withDecks();
  const ben = await another(b, "Ben");
  const his = `finds-${ben.id}-ru-de`;
  mkdirSync(join(b.root, "decks", his), { recursive: true });
  writeFileSync(
    join(b.root, "decks", his, "deck.json"),
    JSON.stringify({
      format: 1,
      id: his,
      title: "Finds",
      lang: "de",
      translationLang: "ru",
      source: { file: "", importedAt: 2 },
      owner: ben.id,
      words: [
        word("t9", "der Tisch", "lex:de:tisch:noun:m", "стол"),
        word("t8", "die Lampe", "lex:de:lampe:noun:f", "лампа"),
      ],
    }),
  );
  createCardStore(b.profiles.open(ben.id)).insert({
    id: "01JZ0000000000000000000000",
    kind: "lexeme",
    lexemeKey: "lex:de:tisch:noun:m",
    translationLang: "ru",
    sourceKey: `deck:${finds}/w3`,
    originRunId: null,
    faces: "recognition,production",
    displayCacheJson: JSON.stringify({ target: "der Tisch", translation: "стол", deck: finds }),
    createdAt: 1,
  });
  const shown = await preview(b, file.bytes, ben.cookie);
  expect(shown.body).toMatchObject({ kind: "finds", words: 4, withAudio: 1, merges: true });
  expect(await importFile(b, shown.body.upload, ben.cookie)).toMatchObject({
    kind: "finds",
    words: 2,
  });
  const deck = JSON.parse(fileOf(b.root, his, "deck.json"));
  expect([deck.id, deck.owner]).toEqual([his, ben.id]);
  expect(deck.words.map((w: { key: string }) => w.key)).toEqual(["t9", "t8", "w1", "w2"]);
  expect(mediaOf(b.root, his)).toEqual({ "find-1.wav": "RIFF die Situation" });
  const cards = ((await ben.json("GET", "/api/cards")) as { words: Shown[] }).words;
  // The words added are his cards; die Lampe, left, stays without one; der Tisch's card from there
  // is his word's here, by its key here.
  expect(cards.map((c) => c.lexemeKey).sort()).toEqual([
    "lex:de:apfel:noun:m",
    "lex:de:situation:noun:f",
    "lex:de:tisch:noun:m",
  ]);
  expect(cards.every((c) => c.display.deck === his)).toBe(true);
  expect(cards.find((c) => c.lexemeKey === "lex:de:tisch:noun:m")?.cardId).toStartWith(
    "01JZ0000000000000000000000",
  );
  expect(
    createCardStore(b.profiles.open(ben.id))
      .all()
      .find((n) => n.lexemeKey === "lex:de:tisch:noun:m")?.sourceKey,
  ).toBe(`deck:${his}/t9`);
  expect((await b.getJson("/api/decks")).decks).toEqual([]);
  // Another profile's upload is none of his: not imported, not let go.
  const again = await preview(b, file.bytes);
  expect(await importFile(b, again.body.upload, ben.cookie)).toEqual({
    error: "deck_upload_gone",
  });
  // Imported by the first profile there: its own Finds, apart from Ben's.
  await importFile(b, again.body.upload);
  expect(JSON.parse(fileOf(b.root, "finds-local-ru-de", "deck.json")).owner).toBe("local");
});

/** A zip of these files, manifest first (as an export writes them). */
async function zipOf(files: Record<string, Uint8Array | string>) {
  const chunks: Uint8Array[] = [];
  const entries = Object.entries(files).map(([name, data]) =>
    bytesEntry(name, typeof data === "string" ? new TextEncoder().encode(data) : data),
  );
  for await (const chunk of zipStream(entries)) chunks.push(chunk);
  return new Uint8Array(Buffer.concat(chunks));
}

test("refused, nothing left of them: a file of a newer app, a damaged one, paths outside a deck's folder; a package is still read as one", async () => {
  const a = await withDecks();
  const { id } = await a.importDeck();
  const good = (await exported(a, `deck:${id}`)).bytes;
  const b = await withDecks({ empty: true });
  const manifest = (version: number) =>
    JSON.stringify({ format: DECK_BUNDLE_FORMAT, version, deck: {}, files: [] });
  const refusedWith = async (bytes: Uint8Array) => {
    const res = await preview(b, bytes);
    return [res.status, res.body.error];
  };
  expect(
    await refusedWith(await zipOf({ "manifest.json": manifest(DECK_BUNDLE_VERSION + 1) })),
  ).toEqual([422, "deck_file_from_newer_app"]);
  expect(
    await refusedWith(
      await zipOf({ "manifest.json": manifest(DECK_BUNDLE_VERSION), "../deck.json": "{}" }),
    ),
  ).toEqual([422, "deck_file_damaged"]);
  expect(
    await refusedWith(
      await zipOf({ "manifest.json": manifest(DECK_BUNDLE_VERSION), "x.html": "" }),
    ),
  ).toEqual([422, "deck_file_damaged"]);
  expect(await refusedWith(await zipOf({ "manifest.json": "{}" }))).toEqual([
    422,
    "deck_file_damaged",
  ]);
  // A byte of deck.json changed after it was exported (the manifest names no word); cut short.
  const changed = good.slice();
  const at = Buffer.from(changed).indexOf("der Apfel");
  changed[at] = "D".charCodeAt(0);
  expect(await refusedWith(changed)).toEqual([422, "deck_file_damaged"]);
  expect(await refusedWith(good.slice(0, good.length - 10))).toEqual([422, "deck_file_damaged"]);
  expect(transfersLeft(b.root)).toEqual([]);
  expect(readdirSync(join(b.root, "decks")).filter((n) => !n.startsWith("."))).toEqual([]);
  // What is no deck file of the app's is a package, read as one.
  expect(await refusedWith(new TextEncoder().encode("not a zip"))).toEqual([422, "not_a_deck"]);
  expect((await preview(b, apkg())).body).toMatchObject({ title: "Mein Deck", words: 4 });
});
