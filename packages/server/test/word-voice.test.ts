import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import { voiceStore } from "../src/runtime/model-files.ts";
import { maxTokens } from "../src/services/qwen-tts.ts";
import { withDecks } from "./deck-setup.ts";
import { setup } from "./setup.ts";
import { qwen } from "./speech-fakes.ts";
import { until } from "./until.ts";

const CODEC = "qwen-tokenizer-12hz-Q8_0.gguf";
const SMALL = "qwen-talker-0.6b-customvoice-Q8_0.gguf";
const BASE = "qwen-talker-1.7b-base-Q8_0.gguf";
const WIE_GEHT = { series: FIXTURE_SERIES, path: "media/audio/wie-geht-es-ihnen.mp3" };
const audio = (scope: string) => `/api/decks/audio?scope=${encodeURIComponent(scope)}`;

/** A recording as the page sends it: 24 kHz mono 16-bit PCM WAV of `seconds`. */
function wav(seconds: number, rate = 24_000) {
  const pcm = Math.round(seconds * rate) * 2;
  const out = new DataView(new ArrayBuffer(44 + pcm));
  const tag = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out.setUint8(at + i, s.charCodeAt(i));
  };
  tag(0, "RIFF");
  out.setUint32(4, 36 + pcm, true);
  tag(8, "WAVEfmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  tag(36, "data");
  out.setUint32(40, pcm, true);
  for (let i = 44; i < 44 + pcm; i += 2) out.setInt16(i, (i * 37) % 2000, true);
  return new Uint8Array(out.buffer);
}

/** The voice of a language taken: a recording of the fixture course sent. */
const choose = (
  api: Pick<Awaited<ReturnType<typeof setup>>, "app" | "cookie">,
  lang: string,
  recording: { series: string; path: string },
  body: Uint8Array<ArrayBuffer>,
) =>
  api.app.request(`/api/speech/words/${lang}?${new URLSearchParams(recording)}`, {
    method: "POST",
    headers: { cookie: api.cookie, "content-type": "audio/wav", ...CLIENT_HEADERS },
    body,
  });
// biome-ignore lint/suspicious/noExplicitAny: test responses are inspected structurally.
const jsonOf = async (res: Response): Promise<any> => res.json();

test("the voice for words: the Base model downloaded beside the others; a course's recordings proposed; one taken and words read in it by an engine of its own", async () => {
  const q = qwen([CODEC, SMALL]);
  const api = await setup({ speech: q.host });
  const { getJson, send, sendJson } = api;
  const before = await getJson("/api/speech/qwen");
  expect(before.wordModel).toEqual({ id: "base", bytes: 2_079_448_256, installed: false });
  expect(before.models.map((m: { id: string }) => m.id)).toEqual(["0.6b", "1.7b"]);
  expect(before.words).toEqual({});
  await sendJson("POST", "/api/speech/qwen/models/base", {});
  await until(() => q.files.includes(BASE));
  const after = await getJson("/api/speech/qwen");
  expect(after.wordModel).toMatchObject({ installed: true });
  // The model practice is read with stays the one in use.
  expect(after.models.find((m: { inUse: boolean }) => m.inUse).id).toBe("0.6b");

  // The course's sentences said after a recording, the longer of the short ones first.
  const { candidates } = await getJson("/api/speech/words/de/candidates");
  expect(candidates).toEqual([
    { ...WIE_GEHT, text: "Wie geht es Ihnen?" },
    { series: FIXTURE_SERIES, path: "media/audio/guten-tag.mp3", text: "Guten Tag!" },
  ]);
  expect((await getJson("/api/speech/words/fr/candidates")).candidates).toEqual([]);

  // No voice yet: a word read by the profile's speaker, as before.
  await send("POST", "/api/speech/say", { text: "kühl", lang: "de", use: "words" });
  expect(q.asked.at(-1)).toMatchObject({ voice: "ryan", talker: `/models/${SMALL}` });

  // Only a recording proposed, only a WAV the engine takes.
  expect(
    (await choose(api, "de", { ...WIE_GEHT, path: "media/audio/nope.mp3" }, wav(2))).status,
  ).toBe(404);
  const notWav = await choose(api, "de", WIE_GEHT, wav(2, 16_000));
  expect([notWav.status, await notWav.json()]).toEqual([400, { error: "unsupported_audio" }]);
  expect((await choose(api, "de", WIE_GEHT, wav(0.5))).status).toBe(400);

  const sample = wav(3);
  const chosen = await choose(api, "de", WIE_GEHT, sample);
  expect(chosen.status).toBe(200);
  const state = await jsonOf(chosen);
  expect(state.words.de).toEqual({
    id: expect.stringMatching(/^[0-9a-f]{12}$/),
    text: "Wie geht es Ihnen?",
    ...WIE_GEHT,
  });
  expect(q.kept.get("de")?.wav).toEqual(sample);

  // A word in the voice for words: registered once with the Base model's own process (practice's
  // model left loaded), its transcript the course's text; read with a cap on its length.
  const id = state.words.de.id;
  const word = await send("POST", "/api/speech/say", { text: "kühl", lang: "de", use: "words" });
  expect(await word.text()).toBe("kühl");
  expect(q.registered).toEqual([
    {
      name: `words-${id}`,
      ref_text: "Wie geht es Ihnen?",
      wav_b64: Buffer.from(sample).toString("base64"),
      talker: `/models/${BASE}`,
    },
  ]);
  expect(q.asked.at(-1)).toMatchObject({
    input: "kühl",
    voice: `words-${id}`,
    language: "German",
    max_new_tokens: maxTokens("kühl"),
    talker: `/models/${BASE}`,
  });
  await send("POST", "/api/speech/say", { text: "der Kühlschrank", lang: "de", use: "words" });
  expect(q.registered).toHaveLength(1);
  // Anything else is read as before, by the profile's speaker, its process still there.
  await send("POST", "/api/speech/say", { text: "Hallo zusammen.", lang: "de" });
  expect(q.asked.at(-1)).toMatchObject({ voice: "ryan", talker: `/models/${SMALL}` });
  expect(q.talkers).toEqual([`/models/${SMALL}`, `/models/${BASE}`]);
  // A language without a voice for words: as before.
  await send("POST", "/api/speech/say", { text: "cold", lang: "en", use: "words" });
  expect(q.asked.at(-1)).toMatchObject({ voice: "ryan", language: "English" });

  // Another recording: a new voice, registered when next used.
  const other = await jsonOf(
    await choose(api, "de", { series: FIXTURE_SERIES, path: "media/audio/guten-tag.mp3" }, wav(2)),
  );
  expect(other.words.de).toMatchObject({ text: "Guten Tag!" });
  expect(other.words.de.id).not.toBe(id);
  await send("POST", "/api/speech/say", { text: "kühl", lang: "de", use: "words" });
  expect(q.registered.map((r) => r.ref_text)).toEqual(["Wie geht es Ihnen?", "Guten Tag!"]);
});

test("every Qwen3-TTS reading is capped by its text: a line is never cut, a word never runs on for half a minute", async () => {
  /** The cap in seconds (the codec makes 12.5 frames a second). */
  const cap = (text: string) => maxTokens(text) / 12.5;
  // A word: a few seconds at most.
  expect(cap("kühl")).toBeLessThan(4);
  expect(cap("die Waschmaschine")).toBeGreaterThan(cap("kühl"));
  // Digits are said as words (about 0.45 s each): a phone number, said in about 7 s, has room.
  expect(cap("Meine Nummer ist 0176 23456789.")).toBeGreaterThan(12);
  // A long German line (about 13 s said) and a long Chinese one (about 15 s): half again and more.
  const german =
    "Am Wochenende fahren wir mit dem Zug nach Hamburg, besuchen meine Großeltern und gehen am Sonntag zusammen an der Elbe spazieren.";
  expect(cap(german)).toBeGreaterThan(13 * 1.5);
  const chinese =
    "我们周末坐火车去汉堡看望我的祖父母，星期天一起去易北河边散步，然后在一家小饭馆吃晚饭，再坐晚上的火车回家。";
  expect(cap(chinese)).toBeGreaterThan(15 * 1.5);
  // Never past the engine's own limit.
  expect(maxTokens("a".repeat(5000))).toBe(2048);
  const q = qwen([CODEC, SMALL]);
  const { send } = await setup({ speech: q.host });
  await send("PUT", "/api/settings", { key: "speech.readEngine", value: "qwen" });
  await send("POST", "/api/speech/say", { text: "Guten Tag!", lang: "de" });
  expect(q.asked[0]?.max_new_tokens).toBe(maxTokens("Guten Tag!"));
});

test("a deck's words read in the voice for words once there is one: words read by another voice are to read again", async () => {
  const q = qwen([CODEC, SMALL]);
  const api = await withDecks({ speech: q.host });
  const { importDeck, getJson, sendJson } = api;
  const { id } = await importDeck();
  const scope = `deck:${id}`;
  await sendJson("POST", "/api/cards/decks/take", { deck: id });
  await sendJson("POST", "/api/decks/audio", { scope });
  const settled = async () => {
    await until(async () => (await getJson(audio(scope))).job?.status !== "running");
    return getJson(audio(scope));
  };
  expect(await settled()).toMatchObject({ read: 3, missing: 0, reader: { voice: "0.6b/ryan" } });

  // The Base model and a voice taken: it reads the deck now, every word read before to read again.
  q.files.push(BASE);
  await choose(api, "de", WIE_GEHT, wav(3));
  const { words } = await getJson("/api/speech/qwen");
  const voice = `clone/${words.de.id}`;
  // Told apart from words without audio: read in another voice (their cards play it meanwhile).
  expect(await getJson(audio(scope))).toMatchObject({
    read: 0,
    other: 3,
    missing: 0,
    reader: { engine: "qwen", voice },
  });
  await sendJson("POST", "/api/decks/audio", { scope });
  expect(await settled()).toMatchObject({ read: 3, other: 0, missing: 0 });
  expect(q.asked.filter((a) => a.voice === `words-${words.de.id}`).map((a) => a.input)).toContain(
    "antworten",
  );
  // "Read again" reads them in it too.
  await sendJson("POST", "/api/decks/audio", { scope, again: true });
  expect(await settled()).toMatchObject({ read: 3, missing: 0, reader: { voice } });
});

test("the Base model's process: a voice registered once however many ask at once, again after a restart; one the engine refuses leaves it running", async () => {
  const q = qwen([CODEC, BASE]);
  const api = await setup({ speech: q.host });
  await choose(api, "de", WIE_GEHT, wav(3));
  const say = (text: string) =>
    api.send("POST", "/api/speech/say", { text, lang: "de", use: "words" });
  // Two first readings at the same moment: one registration.
  const both = await Promise.all([say("kühl"), say("faul")]);
  expect(both.map((r) => r.status)).toEqual([200, 200]);
  expect(q.registered).toHaveLength(1);
  // The process gone (its idle stop, a crash): the next one is given the voice again.
  q.exitAll();
  await until(async () => (await say("neun")).status === 200);
  expect(q.spawned()).toBe(2);
  expect(q.registered).toHaveLength(2);
  // A voice the engine refuses: said so, the process kept (it is no fault of the engine).
  await choose(api, "de", { series: FIXTURE_SERIES, path: "media/audio/guten-tag.mp3" }, wav(2));
  q.voices.status = 400;
  const refused = await say("heute");
  expect([refused.status, await refused.json()]).toEqual([422, { error: "unsupported_audio" }]);
  expect(q.spawned()).toBe(2);
  // Accepted next time: asked again.
  q.voices.status = 200;
  expect((await say("heute")).status).toBe(200);
  expect(q.spawned()).toBe(2);
});

test("a voice kept on disk: what is known of it names its recording, written first; an earlier recording goes", () => {
  const dir = mkdtempSync(join(tmpdir(), "sprachanker-voices-"));
  const store = voiceStore(dir);
  expect(store.get("de")).toBeUndefined();
  store.put("de", { id: "aaa", wav: new Uint8Array([1]), about: { id: "aaa", text: "Eins." } });
  store.put("de", { id: "bbb", wav: new Uint8Array([2]), about: { id: "bbb", text: "Zwei." } });
  expect(store.get("de")).toEqual({
    wav: new Uint8Array([2]),
    about: { id: "bbb", text: "Zwei." },
  });
  expect(readdirSync(dir).sort()).toEqual(["de-bbb.wav", "de.json"]);
  // What is known naming a recording that is not there: no voice.
  writeFileSync(join(dir, "de.json"), JSON.stringify({ id: "ccc", text: "Drei." }));
  expect(store.get("de")).toBeUndefined();
  expect(() => store.put("../x", { id: "a", wav: new Uint8Array(), about: {} })).toThrow();
});
