import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { COURSE, deck, study, withDecks } from "./deck-setup.ts";
import { piper, qwen } from "./speech-fakes.ts";

const VOICE = "de_DE-thorsten-medium";
const audio = (scope: string) => `/api/decks/audio?scope=${encodeURIComponent(scope)}`;

/** Waits until a deck's job is no longer running; its state then. */
async function settled(getJson: (path: string) => Promise<any>, scope: string) {
  for (let i = 0; i < 200; i++) {
    const state = await getJson(audio(scope));
    if (!["running", "stopping"].includes(state.job?.status)) return state;
    await Bun.sleep(5);
  }
  throw new Error("the job did not end");
}

/** A reading held back until let go: what is being read while a job runs. */
function gate() {
  const waiting: Array<() => void> = [];
  return {
    say: (text: string) =>
      new Promise<Uint8Array<ArrayBuffer>>((resolve) =>
        waiting.push(() => resolve(new TextEncoder().encode(`RIFF ${text}`))),
      ),
    /** Lets the readings waiting go. */
    release: () => {
      for (const go of waiting.splice(0)) go();
    },
    waiting: () => waiting.length,
  };
}

test("an imported deck's words without audio read by Piper into its folder; cards play them, taken before or after", async () => {
  const p = piper([VOICE], true, async (text) => new TextEncoder().encode(`RIFF ${text}`));
  const api = await withDecks({ piper: p.host, readings: p.readings });
  const { importDeck, getJson, get, send, sendJson, root } = api;
  const { id } = await importDeck();
  const scope = `deck:${id}`;
  // Taken before: its cards take the audio once it is read.
  await sendJson("POST", "/api/cards/decks/take", { deck: id });
  expect(await getJson(audio(scope))).toEqual({
    lang: "de",
    words: 4,
    own: 1,
    read: 0,
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
  // Kept beside the deck: extras.json by note, each file in its media.
  const extras = JSON.parse(readFileSync(join(root, "decks", id, "extras.json"), "utf8"));
  expect(extras.format).toBe(1);
  expect(Object.keys(extras.words).sort()).toEqual(["n2", "n3", "n4"]);
  const path = extras.words.n3.audio.path;
  expect(path).toMatch(/^media\/read-[0-9a-f]{12}\.wav$/);
  expect(extras.words.n3.audio).toMatchObject({
    engine: "piper",
    voice: VOICE,
    text: "der Apfel",
  });
  // The card shows its word's audio read aloud, served from the deck's folder; one with its own keeps it.
  const words = (await getJson("/api/cards")).words as Array<{
    lexemeKey: string;
    display: Record<string, string>;
  }>;
  const apfel = words.find((w) => w.lexemeKey === "lex:de:apfel:noun:m")?.display;
  expect(apfel?.readAudio).toBe(`${id}/${path}`);
  const kaffee = words.find((w) => w.lexemeKey === "lex:de:kaffee:noun:m")?.display;
  expect(kaffee?.audio).toBeDefined();
  expect(kaffee?.readAudio).toBeUndefined();
  const served = await get(`/decks/${apfel?.readAudio}`, { headers: { range: "bytes=0-3" } });
  expect([served.status, await served.text()]).toEqual([206, "RIFF"]);

  // Started again: nothing left to read.
  expect((await sendJson("POST", "/api/decks/audio", { scope })).job).toMatchObject({ total: 0 });
  await settled(getJson, scope);
  expect(p.said).toHaveLength(3);

  // Imported again with a word changed: its reading kept, but no longer the word's — read again.
  await importDeck(deck("яблоко", "der grüne Apfel"));
  expect(await getJson(audio(scope))).toMatchObject({ read: 2, missing: 1 });
  await sendJson("POST", "/api/decks/audio", { scope });
  expect(await settled(getJson, scope)).toMatchObject({ read: 3, missing: 0 });
  expect(p.said.at(-1)?.text).toBe("der grüne Apfel");
  const shownOf = async () =>
    (await getJson("/api/cards")).words.find(
      (w: { display: { target: string } }) => w.display.target === "der grüne Apfel",
    )?.display;
  const shown = await shownOf();
  expect(shown.readAudio).toStartWith(`${id}/media/read-`);
  expect(shown.readAudio).not.toBe(apfel?.readAudio);
  // Left and taken again: the cards show the readings at once.
  await sendJson("POST", "/api/cards/decks/leave", { scope, lang: "de" });
  expect(await shownOf()).toBeUndefined();
  await sendJson("POST", "/api/cards/decks/take", { deck: id });
  expect((await shownOf()).readAudio).toBe(shown.readAudio);
});

test("a job stopped keeps what it read; started again it reads only the rest; one per deck at a time", async () => {
  const g = gate();
  const p = piper([VOICE], true, g.say);
  const { importDeck, getJson, sendJson } = await withDecks({ piper: p.host });
  const { id } = await importDeck();
  const scope = `deck:${id}`;
  await sendJson("POST", "/api/decks/audio", { scope });
  // Piper reads two words at once; asked again meanwhile, the same job.
  for (let i = 0; i < 50 && g.waiting() < 2; i++) await Bun.sleep(2);
  expect(g.waiting()).toBe(2);
  const running = await sendJson("POST", "/api/decks/audio", { scope });
  expect(running.job).toMatchObject({ status: "running", total: 3, done: 0 });
  expect(running.job.current).toBeString();
  // Stopped: the readings under way are kept, nothing more is read.
  const stopping = await sendJson("DELETE", audio(scope), {});
  expect(stopping.job.status).toBe("stopping");
  // Asked to start meanwhile: it is still stopping.
  expect((await sendJson("POST", "/api/decks/audio", { scope })).job.status).toBe("stopping");
  g.release();
  await Bun.sleep(20);
  const after = await getJson(audio(scope));
  expect(after).toMatchObject({ read: 2, missing: 1, job: { status: "stopped", done: 2 } });
  expect(p.said).toHaveLength(2);
  // Again: only the word left.
  await sendJson("POST", "/api/decks/audio", { scope });
  for (let i = 0; i < 50 && g.waiting() < 1; i++) await Bun.sleep(2);
  g.release();
  expect(await settled(getJson, scope)).toMatchObject({
    read: 3,
    missing: 0,
    job: { status: "done", total: 1, done: 1 },
  });
  expect(new Set(p.said.map((s) => s.text)).size).toBe(3);
});

test("a course's deck: its words without audio read into its own folder; its cards play them", async () => {
  const p = piper([VOICE]);
  const { getJson, get, sendJson, root } = await withDecks({ piper: p.host });
  const scope = `course:${COURSE}`;
  await sendJson("POST", "/api/cards/lesson", {
    series: FIXTURE_SERIES,
    lessonKey: `${COURSE}/00-01`,
    edition: "ru-de",
  });
  // Six words, two with their recording.
  expect(await getJson(audio(scope))).toMatchObject({ lang: "de", words: 6, own: 2, missing: 4 });
  await sendJson("POST", "/api/decks/audio", { scope });
  expect(await settled(getJson, scope)).toMatchObject({ read: 4, missing: 0 });
  const folder = "course~sprachanker.fixture~demo";
  const extras = JSON.parse(readFileSync(join(root, "decks", folder, "extras.json"), "utf8"));
  // By lexeme: a course's cards are one per lexeme, whichever lesson made them.
  expect(Object.keys(extras.words)).toContain("lex:de:gern:word");
  // Cards follow at the job's end: their display takes the reading, the recordings stay theirs.
  const words = (await getJson("/api/cards")).words as Array<{
    lexemeKey: string;
    display: Record<string, string>;
  }>;
  const gern = words.find((w) => w.lexemeKey === "lex:de:gern:word")?.display;
  expect(gern?.readAudio).toStartWith(`${folder}/media/read-`);
  expect(words.find((w) => w.display.audio)?.display.readAudio).toBeUndefined();
  expect((await get(`/decks/${gern?.readAudio}`)).status).toBe(200);
  // Nothing but a deck folder's media is served.
  expect((await get(`/decks/${folder}/extras.json`)).status).toBe(404);
  expect((await get("/decks/course~..~x/media/a.wav")).status).toBe(404);
  // A course not here is no deck.
  expect((await get(audio("course:sprachanker.fixture/nope"))).status).toBe(404);
});

test("the engine: none here says so and starts nothing; Qwen3-TTS when the profile reads with it; a failing engine stops the job", async () => {
  // No voice for German, no Qwen3-TTS: nothing reads the words.
  const none = await withDecks({ piper: piper(["ru_RU-irina-medium"]).host });
  const { id } = await none.importDeck();
  expect((await none.getJson(audio(`deck:${id}`))).reader).toBeNull();
  const refused = await none.send("POST", "/api/decks/audio", { scope: `deck:${id}` });
  expect([refused.status, ((await refused.json()) as { error: string }).error]).toEqual([
    409,
    "speech_unavailable",
  ]);

  // Piper and Qwen3-TTS both here: Piper unless the profile reads with Qwen3-TTS.
  const q = qwen(["qwen-tokenizer-12hz-Q8_0.gguf", "qwen-talker-0.6b-customvoice-Q8_0.gguf"]);
  const both = await withDecks({ piper: piper([VOICE]).host, speech: q.host });
  const deckId = (await both.importDeck()).id;
  const scope = `deck:${deckId}`;
  expect((await both.getJson(audio(scope))).reader.engine).toBe("piper");
  await both.send("PUT", "/api/settings", { key: "speech.readEngine", value: "qwen" });
  await both.send("PUT", "/api/settings", {
    key: "speech.voices",
    value: { qwen: { "*": "serena" } },
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
  await sendJson("POST", "/api/decks/audio", { scope: `deck:${id}` });
  for (let i = 0; i < 50 && g.waiting() < 2; i++) await Bun.sleep(2);
  expect((await send("DELETE", `/api/decks/${id}`, {})).status).toBe(200);
  g.release();
  await Bun.sleep(20);
  expect(existsSync(join(root, "decks", id))).toBe(false);
  expect((await get(audio(`deck:${id}`))).status).toBe(404);
  expect(await getJson("/api/decks")).toEqual({ decks: [] });
});

test("cards studied show the reading in the deck's study", async () => {
  const { importDeck, getJson, sendJson } = await withDecks({ piper: piper([VOICE]).host });
  const { id } = await importDeck();
  await sendJson("POST", "/api/cards/decks/take", { deck: id });
  await sendJson("POST", "/api/decks/audio", { scope: `deck:${id}` });
  await settled(getJson, `deck:${id}`);
  const current = (await getJson(study(`deck:${id}`))).current.display;
  expect(current.audio ?? current.readAudio).toBeString();
});
