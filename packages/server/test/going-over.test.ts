// Going over mistakes (04, "AI practice in courses"; 07): the mistakes of the pass the lesson shows —
// items answered wrong at first and Understanding questions answered wrong — as their wrong parts only,
// by type; the model's explanation and new items per type (an invalid item repaired), kept in the
// lesson run; each new item answered, checked by the engine and kept; read back in the Notebook's pass.
import { expect, test } from "bun:test";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { ulid } from "ulid";
import { setup } from "./setup.ts";

const LESSON = "sprachanker.fixture/demo/00-01";
const START = { series: FIXTURE_SERIES, lessonKey: LESSON, edition: "ru-de" };
const REQUEST = { ...START, language: "ru" };

/** An Understanding text to read whose three questions its second reading settles. */
const TEXT = {
  kind: "reading",
  title: "Меню",
  situation: "Меню кафе.",
  lines: [{ text: "Kaffee 2,50 Euro" }, { text: "Tee 2 Euro" }],
  glossary: [],
  questions: [
    {
      phase: "reading",
      question: "Was kostet der Kaffee?",
      options: ["2 Euro", "2,50 Euro"],
      answer: 1,
    },
    { phase: "reading", question: "Gibt es Tee?", options: ["Richtig", "Falsch"], answer: 0 },
    { phase: "reading", question: "Was kostet der Tee?", options: ["2 Euro", "3 Euro"], answer: 0 },
  ],
};
const CHECK = {
  answers: [
    { n: 1, choice: "b", ambiguous: false },
    { n: 2, choice: "a", ambiguous: false },
    { n: 3, choice: "a", ambiguous: false },
  ],
};

/** A new item as the model writes it: every field, null where its type has none. */
const full = (item: Record<string, unknown>) => ({
  ...Object.fromEntries(
    ["prompt", "options", "answer", "text", "gaps", "parts", "pairs"].map((k) => [k, null]),
  ),
  ...item,
  ...(Array.isArray(item.gaps) && {
    gaps: item.gaps.map((g) => ({ accepted: null, options: null, answer: null, ...g })),
  }),
});
const choice = (prompt: string, answer: number) =>
  full({
    prompt,
    options: ["Im Café.", "Im Park."],
    answer,
  });
const gap = (text: string, answer: number) =>
  full({
    text,
    gaps: [{ options: ["heißt", "bestellst"], answer }],
  });
/** The model's explanations and new items: group 2's second item without its gaps first. */
const BAD = {
  groups: [
    {
      n: 1,
      explanation: "Читайте вопрос внимательно.",
      items: [choice("Wo ist Tom?", 0), choice("Wo ist Anna?", 1)],
    },
    {
      n: 2,
      explanation: "heißen — имя, bestellen — заказ.",
      items: [gap("Du ___ Tom.", 0), full({ text: "Du ___ Tee." })],
    },
  ],
};
const ITEMS = {
  groups: [
    BAD.groups[0],
    { ...BAD.groups[1], items: [gap("Du ___ Tom.", 0), gap("Du ___ einen Tee.", 1)] },
  ],
};

/** A model answering in order, each request's schema name and body kept. */
function model(replies: unknown[]) {
  const names: string[] = [];
  const bodies: Array<{ messages: Array<{ content: string }> }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    if (url.endsWith("/api/v1/models")) return Response.json({ models: [] });
    const body = JSON.parse(init.body as string);
    names.push(body.response_format?.json_schema?.name);
    bodies.push(body);
    return Response.json({ choices: [{ message: { content: JSON.stringify(replies.shift()) } }] });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, names, bodies };
}

test("the pass's mistakes and wrong Understanding answers gone over by type: wrong parts only, an explanation and new items each, answered and checked by the engine, kept in the run", async () => {
  const m = model([TEXT, CHECK, BAD, ITEMS]);
  const { send, sendJson, getJson } = await setup({ fetch: m.fetch });
  await send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await send("PUT", "/api/llm/route", { provider: "custom", model: "m" });

  // Nothing to go over before a run, nor in a run without mistakes; the model is not asked.
  const early = await send("POST", "/api/llm/mistakes", REQUEST);
  expect([early.status, ((await early.json()) as { error: string }).error]).toEqual([
    409,
    "no_lesson_run",
  ]);
  const run = (await sendJson("POST", "/api/runs", START)).run.id;
  const none = await send("POST", "/api/llm/mistakes", REQUEST);
  expect([none.status, ((await none.json()) as { error: string }).error]).toEqual([
    409,
    "no_mistakes",
  ]);
  expect(m.names).toEqual([]);

  // The pass: a choice wrong, one gap of two wrong, an item right; a text's question answered wrong.
  const answer = (itemKey: string, value: unknown) =>
    sendJson("POST", `/api/runs/${run}/events`, {
      events: [
        { id: ulid(), type: "answered", itemKey, payload: { answer: value, attempt: 1, ms: 1 } },
      ],
    });
  await answer(`${LESSON}/ex-01#1`, { optionId: "b" });
  await answer(`${LESSON}/ex-01#2`, { optionId: "b" });
  await answer(`${LESSON}/ex-07#1`, { g1: "b", g2: "b" });
  const text = await sendJson("POST", "/api/llm/understanding", REQUEST);
  await sendJson("POST", "/api/llm/understanding/answer", {
    ...REQUEST,
    id: text.id,
    question: 0,
    answer: { optionId: "a" },
  });

  // What the task is sent: the groups, each mistake its wrong part only.
  const prompt = await sendJson("POST", "/api/llm/mistakes/prompt", REQUEST);
  const data = prompt.body.messages[1].content as string;
  expect(data).toContain(
    'Group 1 — what went wrong: the option chosen; new items: single_choice, with "prompt"',
  );
  expect(data).toContain('- learner "Im Park.", correct "Im Café." to "Wo ist Lena?"');
  expect(data).toContain('- learner "2 Euro", correct "2,50 Euro" to "Was kostet der Kaffee?"');
  expect(data).toContain("Group 2 — what went wrong: the word chosen; new items: gap_choice");
  // The gap of two that was wrong, the other filled right; never the item whole twice.
  expect(data).toContain(
    '- learner "bestelle", correct "heiße" in "Ich [_] Lena. Ich bestelle einen Kaffee."',
  );
  expect(data).not.toContain('learner "bestelle", correct "bestelle"');

  const review = await sendJson("POST", "/api/llm/mistakes", REQUEST);
  // An item without its gaps was repaired.
  expect(m.names).toEqual([
    "understanding_text",
    "understanding_check",
    "mistake_items",
    "mistake_items",
  ]);
  expect([review.runId, review.model, review.answers]).toEqual([run, "m", []]);
  expect(
    review.result.groups.map((g: { type: string; what: string; mistakes: unknown[] }) => [
      g.type,
      g.what,
      g.mistakes.length,
    ]),
  ).toEqual([
    ["single_choice", "choice", 2],
    ["gap_choice", "word", 1],
  ]);
  expect(review.result.groups[1].explanation).toBe("heißen — имя, bestellen — заказ.");

  // The new items, numbered across the groups: answered once each, checked by the engine.
  const reply = (question: number, value: unknown) =>
    send("POST", "/api/llm/mistakes/answer", {
      ...REQUEST,
      id: review.id,
      question,
      answer: value,
    });
  await reply(0, { optionId: "a" });
  await reply(1, { optionId: "a" });
  await reply(2, { g1: "a" });
  // Answered again: the first answer stays; one of the wrong shape, an item not there.
  const again = (await (await reply(0, { optionId: "b" })).json()) as {
    answers: Array<{ question: number; outcome: { result: string } }>;
  };
  expect(again.answers.map((a) => [a.question, a.outcome.result])).toEqual([
    [0, "correct"],
    [1, "wrong"],
    [2, "correct"],
  ]);
  expect((await reply(3, { optionId: "a" })).status).toBe(400);
  expect((await reply(9, { optionId: "a" })).status).toBe(404);

  const state = await getJson(`/api/llm/mistakes?lessonKey=${LESSON}`);
  expect(state.preparing).toBe(false);
  expect(state.reviews.map((r: { id: string }) => r.id)).toEqual([review.id]);
  expect(state.reviews[0].answers).toHaveLength(3);

  // The Notebook's pass shows it with its answers among the run's events.
  const pass = await getJson(`/api/notebook/passes/${run}`);
  expect(pass.mistakes.map((r: { id: string }) => r.id)).toEqual([review.id]);
  expect(
    pass.events.filter(
      (e: { type: string; payload: { verdict?: string } }) =>
        e.type === "practice_answered" && e.payload.verdict === review.id,
    ),
  ).toHaveLength(3);
});
