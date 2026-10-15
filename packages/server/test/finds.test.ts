import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { sentenceOf } from "../src/services/finds.ts";
import { setup } from "./setup.ts";
import { piper } from "./speech-fakes.ts";

const VOICE = "de_DE-thorsten-medium";
const FINDS = "finds-local-ru-de";
const START = {
  series: FIXTURE_SERIES,
  lessonKey: `${FIXTURE_SERIES}/demo/00-01`,
  edition: "ru-de",
};
const SITUATION = {
  text: "Situation",
  context: "Das ist eine schwierige Situation.",
  lang: "de",
};

type Body = { messages: Array<{ content: string }> };

/** The model as the task asks it: a German word selected, or a Russian one — what it was sent kept. */
function model() {
  const bodies: Body[] = [];
  const replies: Record<string, unknown> = {
    Situation: {
      from: "target",
      target: "die Situation",
      translation: "ситуация",
      pos: "noun",
      plural: "die Situationen",
    },
    Kaffee: {
      from: "target",
      target: "der Kaffee",
      translation: "кофе",
      pos: "noun",
      plural: "die Kaffees",
    },
    яблоко: {
      from: "learner",
      target: "der Apfel",
      translation: "яблоко",
      pos: "noun",
      plural: "die Äpfel",
    },
  };
  const fetch = (async (url: string, init: RequestInit) => {
    if (url.endsWith("/models")) return Response.json({ data: [{ id: "m" }] });
    const body = JSON.parse(init.body as string) as Body;
    bodies.push(body);
    const selected = /<selection>(.*)<\/selection>/.exec(body.messages.at(-1)?.content ?? "")?.[1];
    const content = JSON.stringify(replies[selected ?? ""]);
    return Response.json({ choices: [{ message: { content } }] });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, bodies };
}

async function withModel(options: Parameters<typeof setup>[0] = {}) {
  const m = model();
  const api = await setup({ ...options, fetch: m.fetch });
  await api.send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await api.send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  // German studied through Russian: a lesson's words cards in that pair.
  await api.send("POST", "/api/cards/lesson", START);
  return { ...api, model: m };
}

const deckJson = (root: string, id = FINDS) =>
  JSON.parse(readFileSync(join(root, "decks", id, "deck.json"), "utf8"));

/** The learner's decks of German as Review lists them. */
const decksOf = async (getJson: (path: string) => Promise<unknown>) =>
  (
    (await getJson("/api/cards/decks")) as { decks: Array<{ scope: string; decks: unknown[] }> }
  ).decks.find((l) => l.scope === "lang:de")?.decks ?? [];

test("words selected in German: the model's card, read aloud, kept in the profile's Finds deck and made a card; again: already had", async () => {
  const p = piper([VOICE], true, async (text) => new TextEncoder().encode(`RIFF ${text}`));
  const api = await withModel({ piper: p.host, readings: p.readings });
  const { sendJson, getJson, get, root, model: m } = api;

  const found = await sendJson("POST", "/api/llm/finds", SITUATION);
  expect(found).toEqual({
    target: "die Situation",
    translation: "ситуация",
    from: "target",
    lang: "de",
    audio: expect.stringMatching(new RegExp(`^/decks/${FINDS}/media/find-[0-9a-f]{12}\\.wav$`)),
    added: true,
  });
  // The model was told the page's language, the sentence and the words, to answer in Russian.
  const asked = m.bodies[0]?.messages.at(-1)?.content ?? "";
  expect(asked).toContain("<hint>German</hint>");
  expect(asked).toContain("<context>Das ist eine schwierige Situation.</context>");
  expect(asked).toContain('"translation" in Russian');
  // Its audio: the words learnt read by the profile's voice, served from the deck's folder.
  expect(await (await get(found.audio)).text()).toBe("RIFF die Situation");

  // A deck of the profile's own, its sentence kept as the word's example.
  const deck = deckJson(root);
  expect(deck).toMatchObject({ id: FINDS, title: "Finds", lang: "de", translationLang: "ru" });
  expect(deck.owner).toBe("local");
  expect(deck.words).toEqual([
    {
      key: expect.any(String),
      target: "die Situation",
      lexeme: "lex:de:situation:noun:f",
      gender: "f",
      plural: "die Situationen",
      translation: "ситуация",
      tags: ["find"],
      audio: found.audio.slice(`/decks/${FINDS}/`.length),
      examples: [{ sentence: "Das ist eine schwierige Situation." }],
    },
  ]);
  // A card of it, a deck's card (both faces new): Review lists the deck as the learner's own.
  expect(await decksOf(getJson)).toContainEqual(
    expect.objectContaining({
      scope: `deck:${FINDS}`,
      title: "Finds",
      own: true,
      counts: expect.objectContaining({ new: 2 }),
    }),
  );

  // The same words again: nothing added, said so.
  expect(await sendJson("POST", "/api/llm/finds", SITUATION)).toMatchObject({
    target: "die Situation",
    audio: null,
    added: false,
  });
  expect(deckJson(root).words).toHaveLength(1);

  // Words in Russian: the German word kept, without the Russian sentence.
  const apple = await sendJson("POST", "/api/llm/finds", {
    text: "яблоко",
    context: "Я ем яблоко.",
    lang: "ru",
  });
  expect(apple).toMatchObject({
    target: "der Apfel",
    translation: "яблоко",
    from: "learner",
    added: true,
  });
  expect(m.bodies[2]?.messages.at(-1)?.content).toContain("<hint>Russian</hint>");
  const words = deckJson(root).words;
  expect(words.map((w: { target: string }) => w.target)).toEqual(["die Situation", "der Apfel"]);
  expect(words[1].examples).toBeUndefined();
  expect(await decksOf(getJson)).toContainEqual(
    expect.objectContaining({
      scope: `deck:${FINDS}`,
      counts: expect.objectContaining({ new: 4 }),
    }),
  );
});

test("a word the learner has a card of from a course is not added again; nothing reads German: added without audio", async () => {
  const api = await withModel();
  const { sendJson, getJson, root } = api;
  await sendJson("POST", "/api/cards/lesson", {
    series: FIXTURE_SERIES,
    lessonKey: "sprachanker.fixture/demo/00-01",
    edition: "ru-de",
  });
  const coffee = { text: "Kaffee", context: "Ich trinke Kaffee.", lang: "de" };
  expect(await sendJson("POST", "/api/llm/finds", coffee)).toMatchObject({
    target: "der Kaffee",
    added: false,
  });
  expect(existsSync(join(root, "decks", FINDS))).toBe(false);
  // No voice for German on this computer: the word kept all the same.
  expect(await sendJson("POST", "/api/llm/finds", SITUATION)).toMatchObject({
    added: true,
    audio: null,
  });
  expect(deckJson(root).words[0].audio).toBeUndefined();
  const offers = await getJson("/api/cards/decks/offers");
  expect(offers.imported).toEqual([
    expect.objectContaining({ deck: FINDS, own: true, title: "Finds", mine: 1, words: 1 }),
  ]);
});

test("another profile sees nothing of one's Finds and keeps its own; a deleted profile's Finds go with it", async () => {
  const api = await withModel();
  const { sendJson, anonymous, root } = api;
  await sendJson("POST", "/api/llm/finds", SITUATION);

  const made = await anonymous("POST", "/api/profiles", { name: "Anna" });
  const anna = ((await made.json()) as { profile: { id: string } }).profile;
  const cookie = (made.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  // biome-ignore lint/suspicious/noExplicitAny: test responses are inspected structurally.
  const asAnna = async (method: string, path: string, body?: unknown): Promise<any> =>
    (await anonymous(method, path, body, { cookie })).json();
  // Not offered, not listed, not taken, not deleted.
  expect((await asAnna("GET", "/api/cards/decks/offers")).imported).toEqual([]);
  expect((await asAnna("GET", "/api/decks")).decks).toEqual([]);
  expect(await asAnna("POST", "/api/cards/decks/take", { deck: FINDS })).toEqual({
    error: "no_such_deck",
  });
  expect(await asAnna("DELETE", `/api/decks/${FINDS}`)).toEqual({ error: "no_such_deck" });
  expect(existsSync(join(root, "decks", FINDS, "deck.json"))).toBe(true);

  // Her own Finds, apart from the first profile's.
  await asAnna("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await asAnna("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  await asAnna("POST", "/api/cards/lesson", START);
  expect(await asAnna("POST", "/api/llm/finds", SITUATION)).toMatchObject({ added: true });
  const hers = `finds-${anna.id}-ru-de`;
  expect(deckJson(root, hers).owner).toBe(anna.id);
  expect((await asAnna("GET", "/api/decks")).decks.map((d: { id: string }) => d.id)).toEqual([
    hers,
  ]);
  expect(
    ((await api.getJson("/api/decks")).decks as Array<{ id: string }>).map((d) => d.id),
  ).toEqual([FINDS]);

  // She goes: her Finds with her, the first profile's stay.
  expect((await anonymous("DELETE", "/api/profile", {}, { cookie })).status).toBe(200);
  expect(existsSync(join(root, "decks", hers))).toBe(false);
  expect(existsSync(join(root, "decks", FINDS, "deck.json"))).toBe(true);
});

test("refused without a model, and while no language learnt is known", async () => {
  const bare = await setup();
  const none = await bare.send("POST", "/api/llm/finds", SITUATION);
  expect([none.status, await none.json()]).toEqual([409, { error: "llm_not_configured" }]);

  // A model, and nothing studied yet (no card, no course begun): no language learnt is known.
  const m = model();
  const fresh = await setup({ fetch: m.fetch });
  await fresh.send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await fresh.send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  const unknown = await fresh.send("POST", "/api/llm/finds", { text: "яблоко", lang: "ru" });
  expect([unknown.status, await unknown.json()]).toEqual([409, { error: "find_no_language" }]);
  expect(m.bodies).toHaveLength(0);
});

test("a card's example: the sentence of a paragraph the words are in, else none", () => {
  const paragraph = "Wir sind spät. Das ist eine schwierige Situation! Was nun?";
  expect(sentenceOf(paragraph, "Situation")).toBe("Das ist eine schwierige Situation!");
  // No sentence holds them (across two, or cut off): no example rather than a wrong one.
  expect(sentenceOf(paragraph, "nicht da")).toBeUndefined();
  expect(sentenceOf(paragraph, "Situation! Was")).toBeUndefined();
});

test("words in a language not studied (a third one on the page) are refused: no pair made up for them", async () => {
  const api = await withModel();
  const res = await api.send("POST", "/api/llm/finds", { ...SITUATION, lang: "fr" });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "find_no_language" });
});

test("Finds left (its cards gone): the next words found make their own card alone", async () => {
  const api = await withModel();
  const { sendJson, getJson } = api;
  await sendJson("POST", "/api/llm/finds", SITUATION);
  await sendJson("POST", "/api/cards/decks/leave", { scope: `deck:${FINDS}`, lang: "de" });
  expect(await decksOf(getJson)).not.toContainEqual(
    expect.objectContaining({ scope: `deck:${FINDS}` }),
  );
  await sendJson("POST", "/api/llm/finds", { text: "яблоко", lang: "ru" });
  expect(await decksOf(getJson)).toContainEqual(
    expect.objectContaining({
      scope: `deck:${FINDS}`,
      counts: expect.objectContaining({ new: 2 }),
    }),
  );
});
