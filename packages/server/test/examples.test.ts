import { expect, test } from "bun:test";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { setup } from "./setup.ts";

/** A model answering structured requests with `replies` in turn, recording what it was sent. */
function model(replies: unknown[]) {
  const bodies: Array<{ messages: Array<{ content: string }> }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    if (url.endsWith("/api/v1/models")) return Response.json({ models: [] });
    bodies.push(JSON.parse(init.body as string));
    const reply = replies[Math.min(bodies.length, replies.length) - 1];
    return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, bodies };
}

const example = (sentence: string, glossary: unknown[] = []) => ({
  sentence,
  translation: "Люди сегодня охотно заказывают кофе.",
  glossary,
});

test("AI examples: made on request with the course's words, kept with the card, shown only when asked", async () => {
  const m = model([
    example("Ich trinke Tee."),
    example("Die Leute bestellen heute gern Kaffee.", [{ word: "heute", translation: "сегодня" }]),
    example("Der Kaffee ist gut."),
  ]);
  const { send, sendJson, getJson } = await setup({ fetch: m.fetch });
  await sendJson("POST", "/api/cards/lesson", {
    series: FIXTURE_SERIES,
    lessonKey: "sprachanker.fixture/demo/00-01",
    edition: "ru-de",
  });
  const scope = `/api/cards/study?scope=${encodeURIComponent("course:sprachanker.fixture/demo")}`;
  const { current } = await getJson(scope);
  expect(current.display.target).toBe("der Kaffee, die Kaffees");
  const cardId = current.cardId as string;

  // Without a model: the setup problem, nothing kept.
  expect((await send("POST", "/api/llm/examples", { cardId, language: "ru" })).status).toBe(409);
  await send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  expect((await getJson(`/api/llm/examples?cardId=${cardId}`)).examples).toEqual([]);

  // A sentence without the word is repaired; the words met up to the card's lesson are known, a later
  // lesson's word is new with the course's translation, another with the model's.
  const made = await sendJson("POST", "/api/llm/examples", { cardId, language: "ru" });
  expect(m.bodies).toHaveLength(2);
  expect(m.bodies[0]?.messages[1]?.content).toContain(
    "<word>der Kaffee, die Kaffees (кофе)</word>",
  );
  expect(m.bodies[0]?.messages[1]?.content).not.toContain("Leute");
  expect(m.bodies[1]?.messages.at(-1)?.content).toContain("does not use the word");
  expect(made.sentence).toBe("Die Leute bestellen heute gern Kaffee.");
  expect(made.words.filter((w: { new?: boolean }) => w.new)).toEqual([
    { text: "Leute", new: true, translation: "люди" },
    { text: "heute", new: true, translation: "сегодня" },
  ]);

  // Kept with the card: the card itself does not carry it, asking again lists it; a new one is told
  // the earlier sentence and comes first.
  expect((await getJson(scope)).current.display.example).toBeUndefined();
  await sendJson("POST", "/api/llm/examples", { cardId, language: "ru" });
  expect(m.bodies[2]?.messages[1]?.content).toContain(
    "<earlier>Die Leute bestellen heute gern Kaffee.</earlier>",
  );
  const kept = await getJson(`/api/llm/examples?cardId=${cardId}`);
  expect(kept.examples.map((e: { sentence: string }) => e.sentence)).toEqual([
    "Der Kaffee ist gut.",
    "Die Leute bestellen heute gern Kaffee.",
  ]);
  expect(kept.examples[0].model).toBe("m");

  // The prompt it would send, and the task's prompt in the settings.
  const prompt = await sendJson("POST", "/api/llm/examples/prompt", { cardId, language: "ru" });
  expect(JSON.stringify(prompt.body)).toContain("word_example");
  const prompts = await getJson("/api/llm/prompts?language=ru&target=de");
  expect(prompts.example.system).toContain("example sentence in German");
});
