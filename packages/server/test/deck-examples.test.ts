import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildApkg } from "@sprachanker/anki-export/testing";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { COURSE, withDecks } from "./deck-setup.ts";

const FOLDER = "course~sprachanker.fixture~demo";
const examplesOf = (scope: string) => `/api/decks/examples?scope=${encodeURIComponent(scope)}`;

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
 *  sentences the first time), recording what it was sent; `hold` keeps a reply back until let go. */
function model(
  options: {
    skip?: string[];
    /** Words used in a form no ending rule finds ("sein" → "sind"), said as the form used. */
    irregular?: Record<string, string>;
    perWord?: number;
    broken?: boolean;
  } = {},
) {
  const bodies: Body[] = [];
  const skipped = new Set<string>();
  const held: Array<() => void> = [];
  let holding = false;
  const fetch = (async (url: string, init: RequestInit) => {
    if (url.endsWith("/models")) return Response.json({ data: [{ id: "m" }] });
    const body = JSON.parse(init.body as string) as Body;
    bodies.push(body);
    if (holding) await new Promise<void>((go) => held.push(go));
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
    hold: () => {
      holding = true;
    },
    release: () => {
      holding = false;
      for (const go of held.splice(0)) go();
    },
    held: () => held.length,
  };
}

async function settled(getJson: (path: string) => Promise<unknown>, scope: string) {
  for (let i = 0; i < 400; i++) {
    const state = (await getJson(examplesOf(scope))) as State;
    if (!["running", "stopping"].includes(state.job?.status ?? "")) return state;
    await Bun.sleep(5);
  }
  throw new Error("the job did not end");
}

async function withModel(m: ReturnType<typeof model>) {
  const api = await withDecks({ fetch: m.fetch });
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
  await sendJson("POST", "/api/cards/lesson", lesson("ru-de"));
  expect(await getJson(examplesOf(scope))).toEqual({
    words: 4,
    own: 0,
    made: 0,
    missing: 4,
    job: null,
  });
  // Without a model: refused, nothing started.
  const refused = await send("POST", "/api/decks/examples", { scope });
  expect([refused.status, ((await refused.json()) as { error: string }).error]).toEqual([
    409,
    "llm_not_configured",
  ]);
  await send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await send("PUT", "/api/llm/route", { provider: "custom", model: "m" });

  const started = await sendJson("POST", "/api/decks/examples", { scope });
  expect(started.job).toMatchObject({ status: "running", total: 4 });
  expect(await settled(getJson, scope)).toMatchObject({
    made: 4,
    missing: 0,
    job: { status: "done", done: 4, failed: 0 },
  });
  // One call for the four, one more for "gern" alone (its sentences did not use it).
  expect(m.bodies.map(wordsAsked)).toEqual([
    ["der Kaffee, die Kaffees", "die Tasse, die Tassen", "(etwas) bestellen", "gern"],
    ["gern"],
  ]);
  const asked = m.bodies[0]?.messages.at(-1)?.content ?? "";
  expect(asked).toContain("1. der Kaffee, die Kaffees — кофе (noun, masculine)");
  // The course's words up to the lesson; no level in its name: beginners'.
  expect(asked).toContain("<known>der Kaffee, die Kaffees; die Tasse, die Tassen;");
  expect(asked).not.toContain("Leute");
  expect(asked).toContain("<level>A1–A2</level>");
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
  expect((await sendJson("POST", "/api/decks/examples", { scope })).job).toMatchObject({
    total: 0,
  });
  await settled(getJson, scope);
  expect(m.bodies).toHaveLength(2);

  // The request the next call would send, and the task's prompt in the settings.
  const prompt = await sendJson("POST", "/api/decks/examples/prompt", { scope });
  expect(JSON.stringify(prompt.body)).toContain("word_examples");
  const prompts = await getJson("/api/llm/prompts?language=ru&target=de");
  expect(prompts.examples.system).toContain("example sentences in German");
});

test("a job stopped keeps the words written; started again it writes only the rest; a course's cards in two languages get examples in each", async () => {
  const m = model();
  const { sendJson, getJson } = await withModel(m);
  const scope = `course:${COURSE}`;
  await sendJson("POST", "/api/cards/decks/take", {
    series: FIXTURE_SERIES,
    course: "demo",
    edition: "ru-de",
  });
  await sendJson("POST", "/api/cards/lesson", lesson("en-de"));
  // Six words in Russian, four of them in English too: a card each.
  expect(await getJson(examplesOf(scope))).toMatchObject({ words: 10, missing: 10 });
  m.hold();
  await sendJson("POST", "/api/decks/examples", { scope });
  for (let i = 0; i < 100 && !m.held(); i++) await Bun.sleep(2);
  const stopping = await sendJson("DELETE", examplesOf(scope), {});
  expect(stopping.job).toMatchObject({ status: "stopping", total: 10, done: 0 });
  m.release();
  expect(await settled(getJson, scope)).toMatchObject({
    made: 5,
    missing: 5,
    job: { status: "stopped", done: 5 },
  });
  await sendJson("POST", "/api/decks/examples", { scope });
  expect(await settled(getJson, scope)).toMatchObject({
    made: 10,
    missing: 0,
    job: { status: "done", total: 5, done: 5 },
  });
  // Each call in one language: the Russian deck's five, then its sixth, then the English four.
  expect(m.bodies.map((b) => wordsAsked(b).length)).toEqual([5, 1, 4]);
  expect(m.bodies[2]?.messages.at(-1)?.content).toContain("the translations in English");
  expect(m.bodies[2]?.messages.at(-1)?.content).toContain("— coffee");
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
