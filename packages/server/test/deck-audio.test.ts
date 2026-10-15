import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildApkg } from "@sprachanker/anki-export/testing";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { ulid } from "ulid";
import { spokenText } from "../src/services/deck-audio.ts";
import { COURSE, deck, study, withDecks } from "./deck-setup.ts";
import { piper, qwen } from "./speech-fakes.ts";
import { until } from "./until.ts";

const VOICE = "de_DE-thorsten-medium";
const COURSE_FOLDER = "course~sprachanker.fixture~demo";
const audio = (scope: string) => `/api/decks/audio?scope=${encodeURIComponent(scope)}`;

type Job = { status: string; total: number; done: number; failed: number; error?: string };
type AudioState = { words: number; own: number; read: number; missing: number; job: Job | null };
type Shown = { cardId: string; lexemeKey: string; display: Record<string, string> };

/** Waits until a deck's job is no longer running; its state then. */
async function settled(getJson: (path: string) => Promise<unknown>, scope: string) {
  let state: AudioState | undefined;
  await until(async () => {
    state = (await getJson(audio(scope))) as AudioState;
    return !["running", "stopping"].includes(state.job?.status ?? "");
  });
  return state as AudioState;
}

/** Readings held back until let go: what is being read while a job runs. `free` are read at once. */
function gate(free = 0) {
  const waiting: Array<() => void> = [];
  let given = 0;
  const wav = (text: string) => new TextEncoder().encode(`RIFF ${text}`);
  return {
    say: (text: string) =>
      given++ < free
        ? Promise.resolve(wav(text))
        : new Promise<Uint8Array<ArrayBuffer>>((resolve) => waiting.push(() => resolve(wav(text)))),
    /** Lets the readings waiting go. */
    release: () => {
      for (const go of waiting.splice(0)) go();
    },
    /** Waits until `n` readings are held. */
    async held(n: number) {
      await until(() => waiting.length >= n);
      expect(waiting.length).toBe(n);
    },
  };
}

const extrasOf = (root: string, folder: string) =>
  JSON.parse(readFileSync(join(root, "decks", folder, "extras.json"), "utf8"));
const cardsOf = async (getJson: (path: string) => Promise<unknown>) =>
  ((await getJson("/api/cards")) as { words: Shown[] }).words;

test("an imported deck's words without audio read by Piper into its folder by lexeme; cards play them", async () => {
  const p = piper([VOICE], true, async (text) => new TextEncoder().encode(`RIFF ${text}`));
  const api = await withDecks({ piper: p.host, readings: p.readings });
  const { importDeck, getJson, get, send, sendJson, root } = api;
  const { id } = await importDeck();
  const scope = `deck:${id}`;
  // Its words, taken or not (what is made is the deck's).
  expect(await getJson(audio(scope))).toEqual({
    lang: "de",
    words: 4,
    own: 1,
    read: 0,
    other: 0,
    missing: 3,
    reader: { engine: "piper", voice: VOICE },
    job: null,
  });
  // The profile's speed is not the deck's: read as recorded.
  await send("PUT", "/api/settings", { key: "speech.readRate", value: 0.8 });
  const started = await sendJson("POST", "/api/decks/audio", { scope });
  expect(started.job).toMatchObject({ status: "running", engine: "piper", total: 3 });
  const done = await settled(getJson, scope);
  expect(done).toMatchObject({ read: 3, missing: 0, job: { status: "done", done: 3, failed: 0 } });
  expect(p.said.map((s) => [s.text, s.lengthScale]).sort()).toEqual([
    ["antworten", 1],
    ["der Apfel", 1],
    ["die Leute", 1],
  ]);
  // Kept in the deck's folder alone: the readings' cache (the learner's other readings) is not used.
  expect(p.said.map((s) => s.key)).toEqual(["", "", ""]);
  // Kept beside the deck: extras.json by lexeme, each file in its media.
  const extras = extrasOf(root, id);
  expect(extras.format).toBe(2);
  expect(Object.keys(extras.words).sort()).toEqual([
    "lex:de:antworten:verb",
    "lex:de:apfel:noun:m",
    "lex:de:leute:noun:pl",
  ]);
  const apfelReading = extras.words["lex:de:apfel:noun:m"].audio;
  expect(apfelReading.path).toMatch(/^media\/read-[0-9a-f]{12}\.wav$/);
  expect(apfelReading).toMatchObject({ engine: "piper", voice: VOICE, text: "der Apfel" });
  // Taken now, the card shows its word's audio read aloud, served from the deck's folder; one with its
  // own keeps it.
  await sendJson("POST", "/api/cards/decks/take", { deck: id });
  const words = await cardsOf(getJson);
  const apfel = words.find((w) => w.lexemeKey === "lex:de:apfel:noun:m")?.display;
  expect(apfel?.readAudio).toBe(`${id}/${apfelReading.path}`);
  const kaffee = words.find((w) => w.lexemeKey === "lex:de:kaffee:noun:m")?.display;
  expect(kaffee?.audio).toBeDefined();
  expect(kaffee?.readAudio).toBeUndefined();
  const served = await get(`/decks/${apfel?.readAudio}`, { headers: { range: "bytes=0-3" } });
  expect([served.status, await served.text()]).toEqual([206, "RIFF"]);

  // Started again: nothing left to read.
  expect((await sendJson("POST", "/api/decks/audio", { scope })).job).toMatchObject({ total: 0 });
  await settled(getJson, scope);
  expect(p.said).toHaveLength(3);

  // Imported again with a word changed: its reading kept, but no longer the word's — read again, the
  // earlier file gone.
  await importDeck(deck("яблоко", "der Apfel (rot)"));
  expect(await getJson(audio(scope))).toMatchObject({ read: 2, missing: 1 });
  await sendJson("POST", "/api/decks/audio", { scope });
  expect(await settled(getJson, scope)).toMatchObject({ read: 3, missing: 0 });
  expect(p.said.at(-1)?.text).toBe("der Apfel (rot)");
  expect(existsSync(join(root, "decks", id, apfelReading.path))).toBe(false);
  const shownOf = async () =>
    (await cardsOf(getJson)).find((w) => w.display.target === "der Apfel (rot)")?.display;
  const shown = await shownOf();
  expect(shown?.readAudio).toStartWith(`${id}/media/read-`);
  expect(shown?.readAudio).not.toBe(apfel?.readAudio);
  // Left and taken again: the cards show the readings at once.
  await sendJson("POST", "/api/cards/decks/leave", { scope, lang: "de" });
  expect(await shownOf()).toBeUndefined();
  await sendJson("POST", "/api/cards/decks/take", { deck: id });
  expect((await shownOf())?.readAudio).toBe(shown?.readAudio);

  // A reading whose file is gone is not read: counted missing, the card shows none.
  rmSync(join(root, "decks", shown?.readAudio as string));
  expect(await getJson(audio(scope))).toMatchObject({ read: 2, missing: 1 });
  await sendJson("POST", "/api/decks/audio", { scope });
  expect(await settled(getJson, scope)).toMatchObject({ read: 3, missing: 0 });
});

test("a job stopped keeps what it read; started again it reads only the rest; one per deck at a time", async () => {
  const g = gate();
  const p = piper([VOICE], true, g.say);
  const { importDeck, getJson, sendJson } = await withDecks({ piper: p.host });
  const { id } = await importDeck();
  const scope = `deck:${id}`;
  await sendJson("POST", "/api/cards/decks/take", { deck: id });
  await sendJson("POST", "/api/decks/audio", { scope });
  // Piper reads two words at once; asked again meanwhile, the same job.
  await g.held(2);
  const running = await sendJson("POST", "/api/decks/audio", { scope });
  expect(running.job).toMatchObject({ status: "running", total: 3, done: 0 });
  expect(running.job.current).toBeString();
  // Stopped: the readings under way are kept, nothing more is read.
  const stopping = await sendJson("DELETE", audio(scope), {});
  expect(stopping.job.status).toBe("stopping");
  // Asked to start meanwhile: it is still stopping.
  expect((await sendJson("POST", "/api/decks/audio", { scope })).job.status).toBe("stopping");
  g.release();
  expect(await settled(getJson, scope)).toMatchObject({
    read: 2,
    missing: 1,
    job: { status: "stopped", done: 2 },
  });
  expect(p.said).toHaveLength(2);
  // Again: only the word left.
  await sendJson("POST", "/api/decks/audio", { scope });
  await g.held(1);
  g.release();
  expect(await settled(getJson, scope)).toMatchObject({
    read: 3,
    missing: 0,
    job: { status: "done", total: 1, done: 1 },
  });
  expect(new Set(p.said.map((s) => s.text)).size).toBe(3);
});

test("a course's deck: all its words, met yet or not, read into its own folder; a word's cards follow the deck they belong to", async () => {
  const p = piper([VOICE]);
  const { importDeck, getJson, get, sendJson, root } = await withDecks({ piper: p.host });
  const scope = `course:${COURSE}`;
  await sendJson("POST", "/api/cards/lesson", {
    series: FIXTURE_SERIES,
    lessonKey: `${COURSE}/00-01`,
    edition: "ru-de",
  });
  // The imported deck shares Kaffee (the course's card keeps it) and Leute (not met in the course yet:
  // the deck's card).
  const { id } = await importDeck();
  await sendJson("POST", "/api/cards/decks/take", { deck: id });
  // The course's words across its lessons (the whole deck, not the cards made yet), two with their
  // recording; the deck's four, Kaffee with its own.
  expect(await getJson(audio(scope))).toMatchObject({ lang: "de", words: 6, own: 2, missing: 4 });
  expect(await getJson(audio(`deck:${id}`))).toMatchObject({ words: 4, own: 1, missing: 3 });
  await sendJson("POST", "/api/decks/audio", { scope });
  expect(await settled(getJson, scope)).toMatchObject({ read: 4, missing: 0 });
  expect(p.said.map((s) => s.text).sort()).toEqual([
    "(etwas) bestellen",
    "Guten Tag.",
    "die Leute (Plural)",
    "gern",
  ]);
  // By lexeme in the course's folder, a word of a lesson not done yet too.
  expect(Object.keys(extrasOf(root, COURSE_FOLDER).words)).toContain("lex:de:gern:word");
  expect(Object.keys(extrasOf(root, COURSE_FOLDER).words)).toContain("lex:de:leute:noun:pl");
  // Cards follow at the job's end: their display takes the reading, the recordings stay theirs.
  const words = await cardsOf(getJson);
  const gern = words.find((w) => w.lexemeKey === "lex:de:gern:word")?.display;
  expect(gern?.readAudio).toStartWith(`${COURSE_FOLDER}/media/read-`);
  expect(words.find((w) => w.display.audio)?.display.readAudio).toBeUndefined();
  expect((await get(`/decks/${gern?.readAudio}`)).status).toBe(200);
  // The deck's words are its own: read into its folder, its card of Leute plays from there.
  await sendJson("POST", "/api/decks/audio", { scope: `deck:${id}` });
  expect(await settled(getJson, `deck:${id}`)).toMatchObject({ read: 3, missing: 0 });
  const leute = (await cardsOf(getJson)).find((w) => w.lexemeKey === "lex:de:leute:noun:pl");
  // My words and the sheet show the course's entry (it has Leute: 04) with the course's reading;
  // studied in the deck, Kaffee — the course's card — is the deck's word with its recording, and Leute
  // plays the deck's reading.
  expect(leute?.display.readAudio).toStartWith(`${COURSE_FOLDER}/media/read-`);
  const stored = await getJson(`/api/cards/${leute?.cardId}`);
  expect(stored.display.lessonKey).toBe(`${COURSE}/00-02`);
  const inDeck = await getJson(study(`deck:${id}`));
  expect(inDeck.current.display).toMatchObject({ target: "der Kaffee" });
  await sendJson("POST", `/api/cards/${inDeck.current.cardId}/bury`, {});
  expect((await getJson(study(`deck:${id}`))).current.display.readAudio).toStartWith(
    `${id}/media/read-`,
  );
  // Nothing but a deck folder's media is served.
  expect((await get(`/decks/${COURSE_FOLDER}/extras.json`)).status).toBe(404);
  expect((await get("/decks/course~..~x/media/a.wav")).status).toBe(404);
  // A course not here is no deck.
  expect((await get(audio("course:sprachanker.fixture/nope"))).status).toBe(404);
});

test("the engine: none here says so and starts nothing; Qwen3-TTS when the profile reads with it; a failing engine stops the job", async () => {
  // No voice for German, no Qwen3-TTS: nothing reads the words.
  const none = await withDecks({ piper: piper(["ru_RU-irina-medium"]).host });
  const { id } = await none.importDeck();
  await none.sendJson("POST", "/api/cards/decks/take", { deck: id });
  expect((await none.getJson(audio(`deck:${id}`))).reader).toBeNull();
  const refused = await none.send("POST", "/api/decks/audio", { scope: `deck:${id}` });
  expect([refused.status, ((await refused.json()) as { error: string }).error]).toEqual([
    409,
    "speech_unavailable",
  ]);

  // Piper and Qwen3-TTS both here: the profile's engine first.
  const q = qwen(["qwen-tokenizer-12hz-Q8_0.gguf", "qwen-talker-0.6b-customvoice-Q8_0.gguf"]);
  const both = await withDecks({ piper: piper([VOICE]).host, speech: q.host });
  const deckId = (await both.importDeck()).id;
  const scope = `deck:${deckId}`;
  await both.sendJson("POST", "/api/cards/decks/take", { deck: deckId });
  await both.send("PUT", "/api/settings", { key: "speech.readEngine", value: "piper" });
  expect((await both.getJson(audio(scope))).reader.engine).toBe("piper");
  await both.send("PUT", "/api/settings", { key: "speech.readEngine", value: "qwen" });
  await both.send("PUT", "/api/settings", {
    key: "speech.voices",
    value: { qwen: { de: "serena" } },
  });
  expect((await both.getJson(audio(scope))).reader).toEqual({
    engine: "qwen",
    voice: "0.6b/serena",
  });
  await both.sendJson("POST", "/api/decks/audio", { scope });
  expect(await settled(both.getJson, scope)).toMatchObject({ read: 3, job: { engine: "qwen" } });
  expect(q.asked.map((a) => [a.input, a.voice, a.language])).toContainEqual([
    "antworten",
    "serena",
    "German",
  ]);

  // An engine that fails: three words in a row, and the job stops with why.
  const failing = await withDecks({
    piper: piper([VOICE], true, () => Promise.reject(new Error("boom"))).host,
  });
  const failId = (await failing.importDeck()).id;
  await failing.sendJson("POST", "/api/cards/decks/take", { deck: failId });
  await failing.sendJson("POST", "/api/decks/audio", { scope: `deck:${failId}` });
  expect(await settled(failing.getJson, `deck:${failId}`)).toMatchObject({
    read: 0,
    missing: 3,
    job: { status: "failed", failed: 3, error: "speech_engine_failed" },
  });
  expect(existsSync(join(failing.root, "decks", failId, "extras.json"))).toBe(false);
});

test("a deck deleted while its words are read: the job stops, nothing is written into its folder", async () => {
  const g = gate();
  const { importDeck, get, getJson, sendJson, send, root } = await withDecks({
    piper: piper([VOICE], true, g.say).host,
  });
  const { id } = await importDeck();
  await sendJson("POST", "/api/cards/decks/take", { deck: id });
  await sendJson("POST", "/api/decks/audio", { scope: `deck:${id}` });
  await g.held(2);
  await sendJson("POST", "/api/cards/decks/leave", { scope: `deck:${id}`, lang: "de" });
  expect((await send("DELETE", `/api/decks/${id}`, {})).status).toBe(200);
  g.release();
  // Whatever the readings under way do, the folder stays gone.
  for (let i = 0; i < 20; i++) await Bun.sleep(1);
  expect(existsSync(join(root, "decks", id))).toBe(false);
  expect((await get(audio(`deck:${id}`))).status).toBe(404);
  expect(await getJson("/api/decks")).toEqual({ decks: [] });
});

test("a job started while the deck is imported again is dropped with the folder it read into; the deck reads anew", async () => {
  const g = gate();
  const p = piper([VOICE], true, g.say);
  const { importDeck, getJson, sendJson, root } = await withDecks({ piper: p.host });
  const { id } = await importDeck();
  const scope = `deck:${id}`;
  await sendJson("POST", "/api/cards/decks/take", { deck: id });
  // The import going on (its folder written beside) while a job starts and reads.
  const again = importDeck(deck("яблоко", "der grüne Apfel"));
  await sendJson("POST", "/api/decks/audio", { scope });
  await g.held(2);
  await again;
  g.release();
  const after = await settled(getJson, scope);
  // Nothing it read counts: the deck as imported has no readings, and none is left in its folder.
  expect(after).toMatchObject({ read: 0, missing: 3 });
  expect(existsSync(join(root, "decks", id, "extras.json"))).toBe(false);
  // Read again, into the folder as it is now.
  await sendJson("POST", "/api/decks/audio", { scope });
  await g.held(2);
  g.release();
  await g.held(1);
  g.release();
  expect(await settled(getJson, scope)).toMatchObject({ read: 3, missing: 0 });
  expect(Object.keys(extrasOf(root, id).words)).toHaveLength(3);
});

test("saved every 20 words while it reads; variants read as a list; two notes of one word read once", async () => {
  const names =
    "Baum Berg Bild Blume Brief Brot Buch Dach Ei Feld Fisch Hund Kind Kopf Land Licht Mond Nacht Rad Ring Salz Stuhl";
  const notes = names.split(" ").map((w, i) => ({
    guid: `w${i}`,
    fields: [`das ${w}`, "", w.toLowerCase(), "Nomen"],
  }));
  const bytes = buildApkg({
    deck: "Viele Wörter",
    model: "Vokabel (de–ru)",
    fields: ["Wort", "Plural", "Übersetzung", "Wortart"],
    notes: [
      ...notes,
      { guid: "v1", fields: ["der Großvater / der Opa", "", "дедушка", "Nomen"] },
      // A second note of one word: one card, read once.
      { guid: "v2", fields: ["das Baum", "", "дерево", "Nomen"] },
    ],
  });
  const g = gate(20);
  const p = piper([VOICE], true, g.say);
  const { importDeck, getJson, sendJson, root } = await withDecks({ piper: p.host });
  const { id } = await importDeck(bytes, "Viele Wörter");
  const scope = `deck:${id}`;
  await sendJson("POST", "/api/cards/decks/take", { deck: id });
  expect(await getJson(audio(scope))).toMatchObject({ words: 23, missing: 23 });
  await sendJson("POST", "/api/decks/audio", { scope });
  // Twenty read, two held: the twenty are on disk already.
  await g.held(2);
  expect(Object.keys(extrasOf(root, id).words)).toHaveLength(20);
  g.release();
  await g.held(1);
  g.release();
  expect(await settled(getJson, scope)).toMatchObject({ read: 23, missing: 0 });
  expect(p.said.map((s) => s.text)).toContain("der Großvater, der Opa");
  expect(p.said.filter((s) => s.text === "das Baum")).toHaveLength(1);
});

test("cards studied play the reading of a word without audio of its own", async () => {
  const { importDeck, getJson, sendJson } = await withDecks({ piper: piper([VOICE]).host });
  const { id } = await importDeck();
  await sendJson("POST", "/api/cards/decks/take", { deck: id });
  await sendJson("POST", "/api/decks/audio", { scope: `deck:${id}` });
  await settled(getJson, `deck:${id}`);
  // Kaffee comes first with its own recording; buried, the next one.
  const first = (await getJson(study(`deck:${id}`))).current;
  expect(first.display.audio).toBeString();
  await sendJson("POST", `/api/cards/${first.cardId}/bury`, {});
  const next = (await getJson(study(`deck:${id}`))).current.display;
  expect(next.audio).toBeUndefined();
  expect(next.readAudio).toStartWith(`${id}/media/read-`);
});

test("the audio read removed — never the deck's own — and read again; refused while the deck is read", async () => {
  const g = gate(3);
  const p = piper([VOICE], true, g.say);
  const { importDeck, getJson, sendJson, send, root, wordsOf } = await withDecks({ piper: p.host });
  const { id } = await importDeck();
  const scope = `deck:${id}`;
  await sendJson("POST", "/api/cards/decks/take", { deck: id });
  await sendJson("POST", "/api/decks/audio", { scope });
  expect(await settled(getJson, scope)).toMatchObject({ read: 3, missing: 0 });
  const read = Object.values(extrasOf(root, id).words).map(
    (w) => (w as { audio: { path: string } }).audio.path,
  );
  const own = wordsOf(id).n1?.audio as string;
  // Removed: its files and entries go, the deck's own recording stays; the cards follow.
  expect(await sendJson("POST", "/api/decks/audio/remove", { scope })).toMatchObject({
    own: 1,
    read: 0,
    missing: 3,
    job: null,
  });
  expect(extrasOf(root, id).words).toEqual({});
  for (const path of read) expect(existsSync(join(root, "decks", id, path))).toBe(false);
  expect(existsSync(join(root, "decks", id, own))).toBe(true);
  const shown = (await cardsOf(getJson)).map((w) => w.display);
  expect(shown.filter((d) => d.readAudio)).toEqual([]);
  expect(shown.filter((d) => d.audio)).toHaveLength(1);
  // Read again: each word anew.
  await sendJson("POST", "/api/decks/audio", { scope });
  await g.held(2);
  // While it reads, nothing is removed.
  const refused = await send("POST", "/api/decks/audio/remove", { scope });
  expect([refused.status, ((await refused.json()) as { error: string }).error]).toEqual([
    409,
    "deck_job_running",
  ]);
  g.release();
  await g.held(1);
  g.release();
  expect(await settled(getJson, scope)).toMatchObject({ read: 3, missing: 0 });
  expect(p.said).toHaveLength(6);
  // Regenerated in one go: what was read goes first, all three read again.
  await sendJson("POST", "/api/decks/audio", { scope, again: true });
  await g.held(2);
  g.release();
  await g.held(1);
  g.release();
  expect(await settled(getJson, scope)).toMatchObject({
    read: 3,
    job: { status: "done", total: 3, done: 3 },
  });
  expect(p.said).toHaveLength(9);
});

test("a word taken first from an imported deck: a course's lesson shows the course's word and recording; the deck its own", async () => {
  // The owner's case (2026-10-11): an imported deck taken and read aloud, then a course's lesson
  // whose Words step meets a word the deck's card holds.
  const { importDeck, getJson, sendJson } = await withDecks({ piper: piper([VOICE]).host });
  const bytes = buildApkg({
    deck: "Deutsch A1",
    model: "Vokabel (de–ru)",
    fields: ["Wort", "Plural", "Übersetzung", "Wortart"],
    notes: [
      { guid: "k", fields: ["der Kaffee", "die Kaffees", "кофе (напиток)", "Nomen"] },
      { guid: "a", fields: ["antworten", "", "отвечать", "Verb"] },
    ],
  });
  const { id } = await importDeck(bytes, "Deutsch A1");
  const deckScope = `deck:${id}`;
  await sendJson("POST", "/api/cards/decks/take", { deck: id });
  await sendJson("POST", "/api/decks/audio", { scope: deckScope });
  expect(await settled(getJson, deckScope)).toMatchObject({ read: 2 });
  await sendJson("POST", "/api/cards/lesson", {
    series: FIXTURE_SERIES,
    lessonKey: `${COURSE}/00-01`,
    edition: "ru-de",
  });
  const kaffee = (await cardsOf(getJson)).find(
    (w) => w.lexemeKey === "lex:de:kaffee:noun:m",
  ) as Shown & { deck: string };
  // One card per word: still the deck's.
  expect(kaffee.deck).toBe(deckScope);
  /** Kaffee as a scope's queue shows it (the cards before it buried, then brought back). */
  const shownIn = async (scope: string) => {
    for (let i = 0; i < 10; i++) {
      const current = (await getJson(study(scope))).current;
      if (current.cardId === kaffee.cardId) {
        await sendJson("POST", "/api/cards/unbury", { scope: "lang:de" });
        return current.display;
      }
      await sendJson("POST", `/api/cards/${current.cardId}/bury`, {});
    }
  };
  const course = {
    target: "der Kaffee, die Kaffees",
    translation: "кофе",
    audio: "media/audio/kaffee.mp3",
    lessonKey: `${COURSE}/00-01`,
  };
  // The lesson's Words step: the course's word with its recording, not the deck's reading.
  const inLesson = await shownIn(`lesson:ru-de:${COURSE}/00-01`);
  expect(inLesson).toMatchObject(course);
  expect(inLesson.readAudio).toBeUndefined();
  // The language's queue and My words: a course's entry over an imported deck's.
  expect(await shownIn("lang:de")).toMatchObject(course);
  expect(kaffee.display).toMatchObject(course);
  // The deck: its own word, with the audio read for it.
  const inDeck = await shownIn(deckScope);
  expect(inDeck).toMatchObject({ target: "der Kaffee", translation: "кофе (напиток)", deck: id });
  expect(inDeck.readAudio).toStartWith(`${id}/media/read-`);
  // Answered, the Notebook's review day shows it as the language's queue does.
  await sendJson("POST", `/api/cards/${kaffee.cardId}/review`, {
    id: ulid(),
    reps: 0,
    face: "recognition",
    rating: 3,
  });
  const notebook = await getJson("/api/notebook");
  const review = notebook.modules.find((m: { module: string }) => m.module === "review");
  const day = await getJson(`/api/notebook/review/${review.entries[0].runs[0].id}`);
  expect(day.answers[0].card.display).toMatchObject(course);
  // The deck left, the card moves to the course: shown there as before.
  await sendJson("POST", "/api/cards/decks/leave", { scope: deckScope, lang: "de" });
  expect(await shownIn(`lesson:ru-de:${COURSE}/00-01`)).toMatchObject(course);
});

/** The course's second lesson giving words of the first again: Kaffee as another headword ("die Bank,
 *  die Banken" / "die Bänke"), Tasse as the same one without its recording (DW's "weg"), gern as
 *  "gerne" — none recorded there. */
function laterHeadwords(library: string) {
  const series = join(library, FIXTURE_SERIES);
  const lesson = `${COURSE}/00-02`;
  const canonical = join(series, "canonical/demo/lessons/00-02.json");
  const file = JSON.parse(readFileSync(canonical, "utf8"));
  file.vocab.push(
    {
      key: `${lesson}/v-kaffee`,
      lexeme: "lex:de:kaffee:noun:m",
      target: "der Kaffee",
      gender: "m",
    },
    {
      key: `${lesson}/v-tasse`,
      lexeme: "lex:de:tasse:noun:f",
      target: "die Tasse, die Tassen",
      gender: "f",
      plural: "die Tassen",
    },
    { key: `${lesson}/v-gern`, lexeme: "lex:de:gern:word", target: "gerne" },
  );
  writeFileSync(canonical, JSON.stringify(file));
  const locale = join(series, "locale/ru-de/demo/lessons/00-02.json");
  const texts = JSON.parse(readFileSync(locale, "utf8"));
  texts.vocab[`${lesson}/v-kaffee`] = { translation: "кофе" };
  texts.vocab[`${lesson}/v-tasse`] = { translation: "чашка" };
  texts.vocab[`${lesson}/v-gern`] = { translation: "охотно" };
  writeFileSync(locale, JSON.stringify(texts));
}

/** Each word of a lesson's Words step as it shows it, by lexeme (each card buried in turn). */
async function step(api: Awaited<ReturnType<typeof withDecks>>, lessonKey: string) {
  const { getJson, sendJson } = api;
  const lesson = `lesson:ru-de:${lessonKey}`;
  const out: Record<string, Record<string, string>> = {};
  for (let current = (await getJson(study(lesson))).current; current; ) {
    const card = (await getJson(`/api/cards/${current.cardId}`)) as { lexemeKey: string };
    out[card.lexemeKey] = current.display;
    await sendJson("POST", `/api/cards/${current.cardId}/bury`, {});
    current = (await getJson(study(lesson))).current;
  }
  await sendJson("POST", "/api/cards/unbury", { scope: "lang:de" });
  return out;
}

const KAFFEE = "lex:de:kaffee:noun:m";
const TASSE = "lex:de:tasse:noun:f";
const GERN = "lex:de:gern:word";

test("a word in two lessons: each headword has audio — the course's recording of it, else its own reading", async () => {
  const p = piper([VOICE]);
  const api = await withDecks({ piper: p.host, editLibrary: laterHeadwords });
  const { getJson, sendJson, root } = api;
  const scope = `course:${COURSE}`;
  const [first, second] = [`${COURSE}/00-01`, `${COURSE}/00-02`];
  await sendJson("POST", "/api/cards/lesson", {
    series: FIXTURE_SERIES,
    lessonKey: first,
    edition: "ru-de",
  });
  // The later lesson: Tasse's headword is recorded in the first — its recording; Kaffee's and gern's
  // are not: nothing until the deck is read aloud.
  let later = await step(api, second);
  expect(later[TASSE]).toMatchObject({
    target: "die Tasse, die Tassen",
    audio: "media/audio/tasse.mp3",
  });
  expect(later[KAFFEE]).toMatchObject({ target: "der Kaffee", translation: "кофе" });
  expect(later[KAFFEE]?.audio).toBeUndefined();
  // The deck's words count by lexeme: a word is its own when every headword of it is recorded.
  expect(await getJson(audio(scope))).toMatchObject({ words: 6, own: 1, read: 0, missing: 5 });
  await sendJson("POST", "/api/decks/audio", { scope });
  expect(await settled(getJson, scope)).toMatchObject({ words: 6, own: 1, read: 5, missing: 0 });
  // Each headword without a recording read once; a recorded one never.
  expect(p.said.map((s) => s.text).sort()).toEqual([
    "(etwas) bestellen",
    "Guten Tag.",
    "der Kaffee",
    "die Leute (Plural)",
    "gern",
    "gerne",
  ]);
  const words = extrasOf(root, COURSE_FOLDER).words;
  expect(words[GERN].audio.text).toBe("gern");
  expect(words[GERN].variants.map((r: { text: string }) => r.text)).toEqual(["gerne"]);
  // Every headword the steps show has its audio: the first lesson's recordings and reading, the
  // later one's own readings.
  const earlier = await step(api, first);
  expect(earlier[KAFFEE]).toMatchObject({
    target: "der Kaffee, die Kaffees",
    audio: "media/audio/kaffee.mp3",
  });
  expect(earlier[GERN]?.readAudio).toBe(`${COURSE_FOLDER}/${words[GERN].audio.path}`);
  later = await step(api, second);
  expect(later[KAFFEE]?.readAudio).toBe(`${COURSE_FOLDER}/${words[KAFFEE].audio.path}`);
  expect(later[GERN]?.readAudio).toBe(`${COURSE_FOLDER}/${words[GERN].variants[0].path}`);
  expect(later[TASSE]?.audio).toBe("media/audio/tasse.mp3");
  // Removed: every reading of a word goes, with its file.
  const files = Object.values(
    words as Record<string, { audio: { path: string }; variants?: Array<{ path: string }> }>,
  ).flatMap((w) => [w.audio, ...(w.variants ?? [])].map((r) => r.path));
  expect(files).toHaveLength(6);
  await sendJson("POST", "/api/decks/audio/remove", { scope });
  expect(extrasOf(root, COURSE_FOLDER).words).toEqual({});
  for (const path of files)
    expect(existsSync(join(root, "decks", COURSE_FOLDER, path))).toBe(false);
});

test("cards first made in a later lesson: the course's recording of the same headword, else the reading of theirs", async () => {
  const p = piper([VOICE]);
  const { getJson, sendJson } = await withDecks({ piper: p.host, editLibrary: laterHeadwords });
  const scope = `course:${COURSE}`;
  await sendJson("POST", "/api/cards/lesson", {
    series: FIXTURE_SERIES,
    lessonKey: `${COURSE}/00-02`,
    edition: "ru-de",
  });
  const shown = async (lexeme: string) =>
    (await cardsOf(getJson)).find((w) => w.lexemeKey === lexeme)?.display;
  // Tasse, made in a lesson without its recording: the first lesson's of the same headword.
  expect(await shown(TASSE)).toMatchObject({
    lessonKey: `${COURSE}/00-02`,
    audio: "media/audio/tasse.mp3",
  });
  // Kaffee's headword here has none: its reading, once the deck is read aloud — in the course's
  // deck too, where the card shows what it was made with.
  expect((await shown(KAFFEE))?.readAudio).toBeUndefined();
  await sendJson("POST", "/api/decks/audio", { scope });
  await settled(getJson, scope);
  const read = (await shown(KAFFEE))?.readAudio;
  expect(read).toStartWith(`${COURSE_FOLDER}/media/read-`);
  for (let i = 0; i < 6; i++) {
    const current = (await getJson(study(scope))).current;
    if (current.display.target === "der Kaffee") {
      expect(current.display.readAudio).toBe(read);
      return;
    }
    await sendJson("POST", `/api/cards/${current.cardId}/bury`, {});
  }
  throw new Error("Kaffee not studied in the course's deck");
});

test("a word as read: variants as a list, a separable verb's bar left out", () => {
  expect(spokenText("her|kommen")).toBe("herkommen");
  expect(spokenText("der Großvater / der Opa")).toBe("der Großvater, der Opa");
  expect(spokenText("an|rufen / zurück|rufen")).toBe("anrufen, zurückrufen");
});
