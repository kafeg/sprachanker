import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildApkg } from "@sprachanker/anki-export/testing";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { COURSE, deck, withDecks } from "./deck-setup.ts";
import { piper } from "./speech-fakes.ts";
import { until } from "./until.ts";

const FOLDER = "course~sprachanker.fixture~demo";
const examplesOf = (scope: string, edition?: string) =>
  `/api/decks/examples?scope=${encodeURIComponent(scope)}${edition ? `&edition=${edition}` : ""}`;

type Body = { messages: Array<{ content: string }>; response_format?: unknown };
type Job = { status: string; total: number; done: number; failed: number; error?: string };
type State = { words: number; own: number; made: number; missing: number; job: Job | null };

/** The words a request numbers in <words>: "2. der Kaffee — кофе (noun)" → "der Kaffee". */
const wordsAsked = (body: Body) => [
  ...(/<words>\n([\s\S]*?)\n<\/words>/.exec(body.messages.at(-1)?.content ?? "")?.[1] ?? "")
    .split("\n")
    .map((line) => /^\d+\. (.+?)(?: — .*| \(.*)?$/.exec(line)?.[1] ?? ""),
];

/** A model writing `perWord` sentences with each word asked for (`skip`: words it leaves out of its
 *  sentences the first time), recording what it was sent; `hold` keeps replies back until let go
 *  (those after the first `after` calls). */
function model(
  options: {
    skip?: string[];
    /** Words used in a form no ending rule finds ("sein" → "sind"), said as the form used. */
    irregular?: Record<string, string>;
    perWord?: number;
    broken?: boolean;
    /** Calls after so many fail (the provider answering an error). */
    failAfter?: number;
  } = {},
) {
  const bodies: Body[] = [];
  const skipped = new Set<string>();
  const held: Array<() => void> = [];
  let holdAfter = Number.POSITIVE_INFINITY;
  const fetch = (async (url: string, init: RequestInit) => {
    if (url.endsWith("/models")) return Response.json({ data: [{ id: "m" }] });
    const body = JSON.parse(init.body as string) as Body;
    bodies.push(body);
    if (bodies.length > holdAfter) await new Promise<void>((go) => held.push(go));
    if (bodies.length > (options.failAfter ?? Number.POSITIVE_INFINITY))
      return Response.json({ error: { message: "overloaded" } }, { status: 500 });
    if (options.broken)
      return Response.json({ choices: [{ message: { content: "not json at all" } }] });
    const words = wordsAsked(body).map((target, i) => {
      const skip = !!options.skip?.includes(target) && !skipped.has(target);
      if (skip) skipped.add(target);
      return {
        n: i + 1,
        examples: Array.from({ length: options.perWord ?? 3 }, (_, k) => ({
          sentence: skip
            ? `Die Leute sind heute da ${k}.`
            : `Die Leute mögen ${options.irregular?.[target] ?? target} heute ${k}.`,
          translation: `Людям нравится ${k}.`,
          form: options.irregular?.[target] ?? target,
          glossary: [{ word: "heute", translation: "сегодня" }],
        })),
      };
    });
    return Response.json({ choices: [{ message: { content: JSON.stringify({ words }) } }] });
  }) as unknown as typeof globalThis.fetch;
  return {
    fetch,
    bodies,
    hold: (after = 0) => {
      holdAfter = after;
    },
    release: () => {
      holdAfter = Number.POSITIVE_INFINITY;
      for (const go of held.splice(0)) go();
    },
    held: () => held.length,
  };
}

async function settled(
  getJson: (path: string) => Promise<unknown>,
  scope: string,
  edition?: string,
) {
  let state: State | undefined;
  await until(async () => {
    state = (await getJson(examplesOf(scope, edition))) as State;
    return !["running", "stopping"].includes(state.job?.status ?? "");
  });
  return state as State;
}

async function withModel(
  m: ReturnType<typeof model>,
  options: Parameters<typeof withDecks>[0] = {},
) {
  const api = await withDecks({ ...options, fetch: m.fetch });
  await api.send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await api.send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  return api;
}

const lesson = (edition: string) => ({
  series: FIXTURE_SERIES,
  lessonKey: `${COURSE}/00-01`,
  edition,
});

test("a course's deck: its words given examples five a call with the words met so far; a word whose sentences miss it asked again; cards show them marked", async () => {
  const m = model({ skip: ["gern"] });
  const api = await withDecks({ fetch: m.fetch });
  const { send, sendJson, getJson, root } = api;
  const scope = `course:${COURSE}`;
  const ru = { scope, edition: "ru-de" };
  await sendJson("POST", "/api/cards/lesson", lesson("ru-de"));
  // The course's words across its lessons in an edition, met yet or not.
  expect(await getJson(examplesOf(scope, "ru-de"))).toEqual({
    words: 6,
    own: 0,
    made: 0,
    missing: 6,
    job: null,
  });
  // Without a model: refused, nothing started.
  const refused = await send("POST", "/api/decks/examples", ru);
  expect([refused.status, ((await refused.json()) as { error: string }).error]).toEqual([
    409,
    "llm_not_configured",
  ]);
  await send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await send("PUT", "/api/llm/route", { provider: "custom", model: "m" });

  const started = await sendJson("POST", "/api/decks/examples", ru);
  expect(started.job).toMatchObject({ status: "running", total: 6 });
  expect(await settled(getJson, scope, "ru-de")).toMatchObject({
    made: 6,
    missing: 0,
    job: { status: "done", done: 6, failed: 0 },
  });
  // Five a call in course order, one more for "gern" alone (its sentences did not use it), then the
  // sixth.
  expect(m.bodies.map(wordsAsked)).toEqual([
    ["der Kaffee, die Kaffees", "die Tasse, die Tassen", "(etwas) bestellen", "gern", "Guten Tag."],
    ["gern"],
    ["die Leute"],
  ]);
  const asked = m.bodies[0]?.messages.at(-1)?.content ?? "";
  expect(asked).toContain("1. der Kaffee, die Kaffees — кофе (noun, masculine)");
  // The course's words up to the lesson of the last; no level in its name: beginners'.
  expect(asked).toContain("<known>der Kaffee, die Kaffees; die Tasse, die Tassen;");
  expect(m.bodies[1]?.messages.at(-1)?.content).not.toContain("Leute");
  expect(asked).toContain("<level>beginner (A1–A2)</level>");
  expect(asked).toContain("the translations in Russian");

  // Kept beside the course's deck by lexeme and language.
  const extras = JSON.parse(readFileSync(join(root, "decks", FOLDER, "extras.json"), "utf8"));
  expect(extras.words["lex:de:kaffee:noun:m"].examples.ru).toMatchObject({
    model: "m",
    items: [
      { sentence: "Die Leute mögen der Kaffee, die Kaffees heute 0." },
      { sentence: "Die Leute mögen der Kaffee, die Kaffees heute 1." },
      { sentence: "Die Leute mögen der Kaffee, die Kaffees heute 2." },
    ],
  });
  expect(extras.words["lex:de:gern:word"].examples.ru.items).toHaveLength(3);

  // A card shows them: a later lesson's word new with the course's translation, another with the
  // model's.
  const words = (await getJson("/api/cards")).words as Array<{ cardId: string; lexemeKey: string }>;
  const kaffee = words.find((w) => w.lexemeKey === "lex:de:kaffee:noun:m")?.cardId;
  const shown = await getJson(`/api/cards/${kaffee}/examples`);
  expect(shown).toMatchObject({ scope, own: false, model: "m" });
  expect(shown.examples).toHaveLength(3);
  expect(shown.examples[0].translation).toBe("Людям нравится 0.");
  expect(shown.examples[0].words.filter((w: { new?: boolean }) => w.new)).toEqual([
    { text: "Leute", new: true, translation: "люди" },
    { text: "mögen", new: true },
    { text: "heute", new: true, translation: "сегодня" },
  ]);
  // Started again: nothing left.
  expect((await sendJson("POST", "/api/decks/examples", ru)).job).toMatchObject({
    total: 0,
  });
  await settled(getJson, scope, "ru-de");
  expect(m.bodies).toHaveLength(3);

  // The request the next call would send, and the task's prompt in the settings.
  const prompt = await sendJson("POST", "/api/decks/examples/prompt", ru);
  expect(JSON.stringify(prompt.body)).toContain("word_examples");
  const prompts = await getJson("/api/llm/prompts?language=ru&target=de");
  expect(prompts.examples.system).toContain("example sentences in German");

  // Removed: none left in its language, the card shows none; made again, every word asked anew.
  expect(await sendJson("POST", "/api/decks/examples/remove", ru)).toMatchObject({
    made: 0,
    missing: 6,
    job: null,
  });
  const after = JSON.parse(readFileSync(join(root, "decks", FOLDER, "extras.json"), "utf8"));
  expect(after.words).toEqual({});
  expect((await getJson(`/api/cards/${kaffee}/examples`)).examples).toEqual([]);
  await sendJson("POST", "/api/decks/examples", ru);
  expect(await settled(getJson, scope, "ru-de")).toMatchObject({ made: 6 });
  // Regenerated: what was made goes first, all six asked again.
  await sendJson("POST", "/api/decks/examples", { ...ru, again: true });
  expect(await settled(getJson, scope, "ru-de")).toMatchObject({
    made: 6,
    job: { status: "done", total: 6, done: 6 },
  });
  expect(m.bodies).toHaveLength(7);
});

test("a job stopped keeps the words written; started again it writes only the rest; each edition's words get examples in its language", async () => {
  const m = model();
  const { sendJson, getJson } = await withModel(m);
  const scope = `course:${COURSE}`;
  const ru = { scope, edition: "ru-de" };
  // The course's six words, taken or not, in each edition.
  expect(await getJson(examplesOf(scope, "ru-de"))).toMatchObject({ words: 6, missing: 6 });
  m.hold();
  await sendJson("POST", "/api/decks/examples", ru);
  await until(() => m.held() > 0);
  const stopping = await sendJson("DELETE", examplesOf(scope, "ru-de"), {});
  expect(stopping.job).toMatchObject({ status: "stopping", total: 6, done: 0 });
  m.release();
  expect(await settled(getJson, scope, "ru-de")).toMatchObject({
    made: 5,
    missing: 1,
    job: { status: "stopped", done: 5 },
  });
  await sendJson("POST", "/api/decks/examples", ru);
  expect(await settled(getJson, scope, "ru-de")).toMatchObject({
    made: 6,
    missing: 0,
    job: { status: "done", total: 1, done: 1 },
  });
  // English: its own, each call in one language.
  expect(await getJson(examplesOf(scope, "en-de"))).toMatchObject({ made: 0, missing: 6 });
  await sendJson("POST", "/api/decks/examples", { scope, edition: "en-de" });
  expect(await settled(getJson, scope, "en-de")).toMatchObject({ made: 6, missing: 0 });
  expect(m.bodies.map((b) => wordsAsked(b).length)).toEqual([5, 1, 5, 1]);
  expect(m.bodies[2]?.messages.at(-1)?.content).toContain("the translations in English");
  expect(m.bodies[2]?.messages.at(-1)?.content).toContain("— coffee");
  // An edition the course has not: no such deck.
  expect((await sendJson("POST", "/api/decks/examples", { scope, edition: "fr-de" })).error).toBe(
    "no_such_deck",
  );
});

test("each call's examples are written at once: the next call under way, the earlier ones' are on disk", async () => {
  const m = model();
  const { sendJson, getJson, root } = await withModel(m);
  const scope = `course:${COURSE}`;
  // The first five, then the sixth held.
  m.hold(1);
  await sendJson("POST", "/api/decks/examples", { scope, edition: "ru-de" });
  await until(() => m.held() > 0);
  const extras = JSON.parse(readFileSync(join(root, "decks", FOLDER, "extras.json"), "utf8"));
  const inRussian = Object.values(extras.words).filter(
    (w) => (w as { examples?: { ru?: unknown } }).examples?.ru,
  );
  expect(inRussian).toHaveLength(5);
  m.release();
  expect(await settled(getJson, scope, "ru-de")).toMatchObject({ made: 6, missing: 0 });
});

test("a model that cannot answer usefully: three calls in a row, and the job ends with why", async () => {
  const notes = "Baum Berg Bild Blume Brief Brot Buch Dach Ei Feld Fisch Hund Kind Kopf Land Licht"
    .split(" ")
    .map((w, i) => ({ guid: `w${i}`, fields: [`der ${w}`, "", w.toLowerCase(), "Nomen"] }));
  const bytes = buildApkg({
    deck: "Wörter A2",
    model: "Vokabel (de–ru)",
    fields: ["Wort", "Plural", "Übersetzung", "Wortart"],
    notes,
  });
  const m = model({ broken: true });
  const { importDeck, sendJson, getJson } = await withModel(m);
  const { id } = await importDeck(bytes, "Wörter A2");
  await sendJson("POST", "/api/cards/decks/take", { deck: id });
  await sendJson("POST", "/api/decks/examples", { scope: `deck:${id}` });
  expect(await settled(getJson, `deck:${id}`)).toMatchObject({
    made: 0,
    missing: 16,
    job: { status: "failed", failed: 15, error: "llm_invalid_output" },
  });
  // Each call repaired once: three calls of five words, two requests each.
  expect(m.bodies).toHaveLength(6);
  // The deck's name says its level.
  expect(m.bodies[0]?.messages.at(-1)?.content).toContain("<level>A2</level>");
});

test("an imported deck: a word with its own sentences gets none; the others with the deck's words before them", async () => {
  const bytes = buildApkg({
    deck: "Obst",
    fields: ["german", "sentence_1_german", "russian", "sentence_1_russian"],
    notes: [
      { guid: "o1", fields: ["der Apfel", "Ich esse einen Apfel.", "яблоко", "Я ем яблоко."] },
      { guid: "o2", fields: ["die Birne", "", "груша", ""] },
      { guid: "o3", fields: ["der Tisch", "", "стол", ""] },
      { guid: "o4", fields: ["sein", "", "быть", ""] },
    ],
  });
  const m = model({ irregular: { sein: "sind" } });
  const { importDeck, sendJson, getJson } = await withModel(m);
  const { id } = await importDeck(bytes, "Obst");
  const scope = `deck:${id}`;
  await sendJson("POST", "/api/cards/decks/take", { deck: id });
  expect(await getJson(examplesOf(scope))).toMatchObject({ words: 4, own: 1, missing: 3 });
  await sendJson("POST", "/api/decks/examples", { scope });
  expect(await settled(getJson, scope)).toMatchObject({ made: 3, missing: 0 });
  // "sein" used as "sind": found by the form the model says it used.
  expect(m.bodies.map(wordsAsked)).toEqual([["die Birne", "der Tisch", "sein"]]);
  expect(m.bodies[0]?.messages.at(-1)?.content).toContain(
    "<known>der Apfel; die Birne; der Tisch; sein</known>",
  );
  const words = (await getJson("/api/cards")).words as Array<{
    cardId: string;
    display: { target: string };
  }>;
  const apfel = words.find((w) => w.display.target === "der Apfel")?.cardId;
  const birne = words.find((w) => w.display.target === "die Birne")?.cardId;
  // The word with its own: none made, its own say so.
  expect(await getJson(`/api/cards/${apfel}/examples`)).toEqual({
    scope,
    own: true,
    model: null,
    examples: [],
  });
  const shown = await getJson(`/api/cards/${birne}/examples`);
  expect(shown.examples).toHaveLength(3);
  // The deck's words up to it are known, the rest new (the model's glossary translates them).
  expect(shown.examples[0].words.filter((w: { new?: boolean }) => w.new)).toEqual([
    { text: "Leute", new: true },
    { text: "mögen", new: true },
    { text: "heute", new: true, translation: "сегодня" },
  ]);
  // The form the model used is the word: not new.
  const sein = words.find((w) => w.display.target === "sein")?.cardId;
  const seinShown = await getJson(`/api/cards/${sein}/examples`);
  expect(seinShown.examples[0].sentence).toBe("Die Leute mögen sind heute 0.");
  expect(seinShown.examples[0].words).toContainEqual({ text: "sind" });
});

test("the words left asked again in a second call that fails: the first call's words kept, the rest failed with why", async () => {
  const m = model({ skip: ["gern"], failAfter: 1 });
  const { sendJson, getJson } = await withModel(m);
  const scope = `course:${COURSE}`;
  await sendJson("POST", "/api/decks/examples", { scope, edition: "ru-de" });
  const state = await settled(getJson, scope, "ru-de");
  // The first call's four kept; "gern" asked again and the sixth word's call both fail.
  expect(state).toMatchObject({
    made: 4,
    missing: 2,
    job: { status: "done", done: 4, failed: 2 },
  });
  expect(state.job?.error).toStartWith("llm_");
  expect(m.bodies.map(wordsAsked)[1]).toEqual(["gern"]);
});

test("a deck imported again or deleted while its examples are written: the job is dropped, nothing written into its folder", async () => {
  const m = model();
  const { importDeck, sendJson, send, getJson, get, root } = await withModel(m);
  const { id } = await importDeck();
  const scope = `deck:${id}`;
  await sendJson("POST", "/api/cards/decks/take", { deck: id });
  m.hold();
  await sendJson("POST", "/api/decks/examples", { scope });
  await until(() => m.held() > 0);
  await importDeck(deck("яблоко", "der grüne Apfel"));
  m.release();
  for (let i = 0; i < 20; i++) await Bun.sleep(1);
  // No job of the deck as it is now, nothing made for it.
  expect(await getJson(examplesOf(scope))).toMatchObject({ made: 0, missing: 4, job: null });
  expect(existsSync(join(root, "decks", id, "extras.json"))).toBe(false);

  m.hold();
  await sendJson("POST", "/api/decks/examples", { scope });
  await until(() => m.held() > 0);
  await sendJson("POST", "/api/cards/decks/leave", { scope, lang: "de" });
  expect((await send("DELETE", `/api/decks/${id}`, {})).status).toBe(200);
  m.release();
  for (let i = 0; i < 20; i++) await Bun.sleep(1);
  expect(existsSync(join(root, "decks", id))).toBe(false);
  expect((await get(examplesOf(scope))).status).toBe(404);
});

test("a deck's audio and examples made at once: each job's save keeps the other's work", async () => {
  const waiting: Array<() => void> = [];
  const p = piper(
    ["de_DE-thorsten-medium"],
    true,
    (text) =>
      new Promise((resolve) =>
        waiting.push(() => resolve(new TextEncoder().encode(`RIFF ${text}`))),
      ),
  );
  const m = model();
  const { importDeck, sendJson, getJson, root } = await withModel(m, { piper: p.host });
  const { id } = await importDeck();
  const scope = `deck:${id}`;
  await sendJson("POST", "/api/cards/decks/take", { deck: id });
  const extras = () => JSON.parse(readFileSync(join(root, "decks", id, "extras.json"), "utf8"));
  type Entry = { audio?: unknown; examples?: { ru?: unknown } };
  const count = (has: (w: Entry) => unknown) =>
    (Object.values(extras().words) as Entry[]).filter(has).length;

  // The readings held: the examples are written first.
  await sendJson("POST", "/api/decks/audio", { scope });
  await sendJson("POST", "/api/decks/examples", { scope });
  expect(await settled(getJson, scope)).toMatchObject({ made: 4, job: { status: "done" } });
  expect([count((w) => w.examples?.ru), count((w) => w.audio)]).toEqual([4, 0]);
  // Then the audio, the readings let go: its saves keep the examples.
  await until(async () => {
    const state = (await getJson(`/api/decks/audio?scope=${encodeURIComponent(scope)}`)) as {
      job: { status: string } | null;
    };
    for (const go of waiting.splice(0)) go();
    return state.job?.status === "done";
  });
  expect([count((w) => w.examples?.ru), count((w) => w.audio)]).toEqual([4, 3]);
});
