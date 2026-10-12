// Understanding (04, "AI practice in courses"; 07): a text written from what the learner knows and read
// again by the model (the questions it does not settle as the key does left out, written again once
// when too few are left), kept in the lesson run; heard through the server's reading aloud; answered by
// ear, then read with its reading questions — each answer checked by the engine and kept on the text;
// read back in the Notebook's pass.
import { expect, test } from "bun:test";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { ulid } from "ulid";
import { setup } from "./setup.ts";
import { piper } from "./speech-fakes.ts";

const LESSON = "sprachanker.fixture/demo/00-01";
const START = { series: FIXTURE_SERIES, lessonKey: LESSON, edition: "ru-de" };
const REQUEST = { ...START, language: "ru" };

const TEXT = {
  kind: "dialogue",
  title: "В пекарне",
  situation: "Анна покупает булочки.",
  lines: [
    { speaker: "Anna", text: "Guten Morgen! Zwei Brötchen, bitte." },
    { speaker: "Verkäufer", text: "Gern. Das macht 1,20 Euro." },
  ],
  glossary: [
    { word: "Brötchen", translation: "булочка" },
    { word: "gern", translation: "охотно" },
    { word: "macht", translation: "составляет" },
  ],
  questions: [
    {
      phase: "listening",
      question: "Anna möchte drei Brötchen.",
      options: ["Richtig", "Falsch"],
      answer: 1,
    },
    { phase: "listening", question: "Wie viel kostet das?", accepted: ["1,20", "1,20 Euro"] },
    {
      phase: "listening",
      question: "Wann ist das?",
      options: ["am Abend", "am Morgen", "in der Nacht"],
      answer: 1,
    },
    {
      phase: "listening",
      question: "Was kauft Anna?",
      options: ["Kuchen", "Brot", "Brötchen"],
      answer: 2,
    },
    {
      phase: "reading",
      question: "Wer verkauft?",
      options: ["Anna", "der Verkäufer", "niemand"],
      answer: 1,
    },
  ],
};

/** The second reading: question 3 answered otherwise, question 4 ambiguous; the rest as the key. */
const CHECK = {
  answers: [
    { n: 1, choice: "b", ambiguous: false },
    { n: 2, answer: "1,20 Euro", ambiguous: false },
    { n: 3, choice: "c", ambiguous: false },
    { n: 4, choice: "c", ambiguous: true },
    { n: 5, choice: "b", ambiguous: false },
  ],
};
/** A second reading that settles nothing. */
const NOTHING = { answers: [] };

/** A model answering in order, each request's schema name kept. */
function model(replies: unknown[]) {
  const names: string[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    if (url.endsWith("/api/v1/models")) return Response.json({ models: [] });
    const body = JSON.parse(init.body as string);
    names.push(body.response_format?.json_schema?.name);
    return Response.json({ choices: [{ message: { content: JSON.stringify(replies.shift()) } }] });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, names };
}

async function withModel(replies: unknown[], options: Parameters<typeof setup>[0] = {}) {
  const m = model(replies);
  const api = await setup({ ...options, fetch: m.fetch });
  await api.send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await api.send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  return { ...api, names: m.names };
}

test("while a text is made its state says at which step — written, then read again —, for the page to say", async () => {
  const seen: unknown[] = [];
  const replies: unknown[] = [TEXT, CHECK];
  let api: Awaited<ReturnType<typeof setup>> | undefined;
  const fetch = (async (url: string) => {
    if (url.endsWith("/api/v1/models")) return Response.json({ models: [] });
    const state = await api?.getJson(`/api/llm/understanding?lessonKey=${LESSON}`);
    seen.push([state?.preparing, state?.step]);
    return Response.json({ choices: [{ message: { content: JSON.stringify(replies.shift()) } }] });
  }) as unknown as typeof globalThis.fetch;
  api = await setup({ fetch });
  await api.send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await api.send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  await api.sendJson("POST", "/api/runs", START);
  await api.sendJson("POST", "/api/llm/understanding", REQUEST);
  expect(seen).toEqual([
    [true, "writing"],
    [true, "checking"],
  ]);
  const after = await api.getJson(`/api/llm/understanding?lessonKey=${LESSON}`);
  expect([after.preparing, after.step]).toEqual([false, null]);
});

test("a text written and read again, kept in the lesson run; heard, answered by ear, then read; each answer checked by the engine; in the Notebook's pass", async () => {
  const p = piper(["de_DE-thorsten-medium", "de_DE-eva_k-x_low"]);
  const { send, sendJson, getJson, names } = await withModel([TEXT, CHECK], {
    piper: p.host,
    readings: p.readings,
  });

  // A text belongs to a run of the lesson: none yet, so it is refused before the model is asked.
  const early = await send("POST", "/api/llm/understanding", REQUEST);
  expect([early.status, ((await early.json()) as { error: string }).error]).toEqual([
    409,
    "no_lesson_run",
  ]);
  expect(names).toEqual([]);
  const run = (await sendJson("POST", "/api/runs", START)).run.id;

  const text = await sendJson("POST", "/api/llm/understanding", REQUEST);
  expect(names).toEqual(["understanding_text", "understanding_check"]);
  // The questions the second reading did not settle as the key does are left out.
  expect(text.result.questions.map((q: { question: string }) => q.question)).toEqual([
    "Anna möchte drei Brötchen.",
    "Wie viel kostet das?",
    "Wer verkauft?",
  ]);
  expect([text.runId, text.model, text.answers]).toEqual([run, "m", []]);
  // Glossed as new: only words not met — "gern" is one of the lesson's own — and not asked about
  // ("Brötchen" is in a question kept).
  expect(text.result.glossary).toEqual([{ word: "macht", translation: "составляет" }]);

  // Heard through the server's reading aloud, each speaker by a voice of the language.
  for (const [i, line] of TEXT.lines.entries()) {
    const voice = i ? "de_DE-eva_k-x_low" : "de_DE-thorsten-medium";
    const wav = await send("POST", "/api/speech/say", { text: line.text, lang: "de", voice });
    expect(wav.status).toBe(200);
  }
  expect(p.said.map((s) => s.id)).toEqual(["de_DE-thorsten-medium", "de_DE-eva_k-x_low"]);

  // By ear: a choice wrong, an answer typed right; a question answered twice keeps its first answer.
  const answer = (question: number, value: unknown) =>
    send("POST", "/api/llm/understanding/answer", {
      ...REQUEST,
      id: text.id,
      question,
      answer: value,
    });
  await answer(0, { optionId: "a" });
  await answer(1, { g1: "1,20 Euro" });
  const again = (await (await answer(0, { optionId: "b" })).json()) as {
    answers: Array<{ question: number; outcome: { result: string } }>;
  };
  expect(again.answers.map((a) => [a.question, a.outcome.result])).toEqual([
    [0, "wrong"],
    [1, "correct"],
  ]);
  // Then the text read, its reading question.
  await answer(2, { optionId: "b" });
  // An answer that does not fit the question, a question or text not there.
  expect((await answer(1, { optionId: "a" })).status).toBe(400);
  expect((await answer(9, { optionId: "a" })).status).toBe(404);
  const missing = await send("POST", "/api/llm/understanding/answer", {
    ...REQUEST,
    id: ulid(),
    question: 0,
    answer: { optionId: "a" },
  });
  expect(missing.status).toBe(404);

  const state = await getJson(`/api/llm/understanding?lessonKey=${LESSON}`);
  expect(state.preparing).toBe(false);
  expect(state.texts).toHaveLength(1);
  expect(
    state.texts[0].answers.map((a: { outcome: { result: string } }) => a.outcome.result),
  ).toEqual(["wrong", "correct", "correct"]);

  // The step done, the pass is one with work: the Notebook counts the text and shows it with its
  // answers among the run's events.
  await sendJson("POST", `/api/runs/${run}/events`, {
    events: [{ id: ulid(), type: "step_done", payload: { step: "understanding" } }],
  });
  const lesson = await getJson(`/api/notebook/lesson?lessonKey=${LESSON}`);
  expect(lesson.passes[0].understanding).toBe(1);
  const pass = await getJson(`/api/notebook/passes/${run}`);
  expect(pass.understanding.map((u: { id: string }) => u.id)).toEqual([text.id]);
  expect(pass.events.filter((e: { type: string }) => e.type === "practice_answered")).toHaveLength(
    3,
  );

  const prompt = await sendJson("POST", "/api/llm/understanding/prompt", REQUEST);
  expect(prompt.body.response_format.json_schema.name).toBe("understanding_text");
  expect(prompt.body.messages[1].content).toContain("Learner's level: beginner (A1–A2)");
  expect(prompt.body.messages[1].content).toContain("about 40–70 words");
});

test("too few questions settled: the text is written again once and the better kept; none settled: nothing is kept", async () => {
  const few = { answers: CHECK.answers.slice(0, 2) };
  const { sendJson, getJson, names } = await withModel([TEXT, few, TEXT, CHECK]);
  await sendJson("POST", "/api/runs", START);
  const text = await sendJson("POST", "/api/llm/understanding", REQUEST);
  expect(names).toEqual([
    "understanding_text",
    "understanding_check",
    "understanding_text",
    "understanding_check",
  ]);
  expect(text.result.questions).toHaveLength(3);

  const none = await withModel([TEXT, NOTHING, TEXT, NOTHING]);
  await none.sendJson("POST", "/api/runs", START);
  const res = await none.send("POST", "/api/llm/understanding", REQUEST);
  expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([
    502,
    "llm_invalid_output",
  ]);
  expect((await none.getJson(`/api/llm/understanding?lessonKey=${LESSON}`)).texts).toEqual([]);
  expect((await getJson(`/api/llm/understanding?lessonKey=${LESSON}`)).texts).toHaveLength(1);
});
