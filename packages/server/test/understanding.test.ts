// Reading and Listening: a text made by the generator — drafts
// written side by side, rated, the best kept (none passing: written again once, then nothing), its
// questions asked and read again with the text and without it (those not settled, or given away by
// common sense, left out; asked again once when too few are left) —, a text to hear recorded by
// Qwen3-TTS's voices by gender, added to the course's practice and taken into the lesson run;
// answered, each answer checked by the engine and kept on the text; read back in the Notebook's pass;
// the next taken as the lesson starts.
import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { ulid } from "ulid";
import { readWav, writeWav } from "../src/services/wav.ts";
import { setup } from "./setup.ts";
import { qwen } from "./speech-fakes.ts";
import { until } from "./until.ts";

const LESSON = "sprachanker.fixture/demo/00-01";
const START = { series: FIXTURE_SERIES, lessonKey: LESSON, edition: "ru-de" };
const LISTENING = { ...START, language: "ru", step: "listening" };

const DRAFT = {
  setting: "Разговор в пекарне",
  title: "В пекарне",
  situation: "Анна утром покупает булочки.",
  people: [
    { name: "Anna", gender: "f", age: "adult", role: "покупательница" },
    { name: "Herr Brandt", gender: "m", age: "senior", role: "пекарь" },
  ],
  beats: ["Анна заходит", "покупает булочки", "платит"],
  facts: ["zwei Brötchen", "1,20 Euro", "am Morgen"],
  text: [
    "Anna: Guten Morgen! Zwei Brötchen, bitte.",
    "Herr Brandt: Gern. Möchten Sie auch ein Brot?",
    "Anna: Nein, danke. Was kostet das?",
    "Herr Brandt: Das macht 1,20 Euro. Schönen Tag noch!",
    "Anna: Danke, Ihnen auch. Tschüss!",
    "Herr Brandt: Tschüss, bis morgen!",
    "Anna: Bis morgen, Herr Brandt!",
  ].join("\n"),
};

const rating = (n: number, r: Record<string, unknown> = {}) => ({
  n,
  gist: "Анна покупает булочки.",
  natural: 4,
  coherent: 4,
  realistic: 4,
  level: 4,
  lesson: 4,
  interest: 3,
  problems: [],
  ...r,
});
const JUDGED = { ratings: [rating(1), rating(2, { interest: 5 }), rating(3, { coherent: 2 })] };

const QUESTIONS = {
  questions: [
    { question: "Anna möchte drei Brötchen.", options: ["Richtig", "Falsch"], answer: 1 },
    { question: "Wie viel kostet das?", accepted: ["1,20", "1,20 Euro"] },
    { question: "Wann ist das?", options: ["am Abend", "am Morgen", "in der Nacht"], answer: 1 },
    { question: "Was kauft Anna?", options: ["Kuchen", "Brot", "Brötchen"], answer: 2 },
    { question: "Wer verkauft?", options: ["Anna", "Herr Brandt", "niemand"], answer: 1 },
  ],
  glossary: [
    { word: "Brötchen", translation: "булочка" },
    { word: "gern", translation: "охотно" },
    { word: "macht", translation: "составляет" },
  ],
};

/** Read with the text: question 3 answered otherwise, question 4 ambiguous; the rest as the key. */
const CHECK = {
  answers: [
    { n: 1, choice: "b", ambiguous: false },
    { n: 2, answer: "1,20 Euro", ambiguous: false },
    { n: 3, choice: "c", ambiguous: false },
    { n: 4, choice: "c", ambiguous: true },
    { n: 5, choice: "b", ambiguous: false },
  ],
};
/** Without the text: question 5 given away (who sells — the baker). */
const BLIND = {
  answers: [
    { n: 1, choice: "a", ambiguous: true },
    { n: 5, choice: "b", ambiguous: false },
  ],
};
const SETTLES_ALL = {
  answers: [
    { n: 1, choice: "b", ambiguous: false },
    { n: 2, answer: "1,20", ambiguous: false },
    { n: 3, choice: "b", ambiguous: false },
    { n: 4, choice: "c", ambiguous: false },
    { n: 5, choice: "b", ambiguous: false },
  ],
};

type Replies = Record<string, unknown[]>;

/** A model answering each task (by its schema's name) with its replies in turn — the last one again
 *  once they run out —, its blind reading by `blind`; the tasks asked kept in order. */
function model(replies: Replies) {
  const names: string[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    // Qwen3-TTS on this machine (speech-fakes' engine): not the model's.
    if (!url.startsWith("http://127.0.0.1:9/")) return globalThis.fetch(url, init);
    if (url.endsWith("/api/v1/models")) return Response.json({ models: [] });
    const body = JSON.parse(init.body as string);
    const name: string = body.response_format?.json_schema?.name;
    const blind = String(body.messages.at(-1)?.content).includes("(No text:");
    const task = blind ? "blind" : name;
    names.push(task);
    const list = replies[task] ?? [];
    const reply = list.length > 1 ? list.shift() : list[0];
    return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, names };
}

const REPLIES: Replies = {
  understanding_draft: [DRAFT],
  understanding_judge: [JUDGED],
  understanding_questions: [QUESTIONS],
  understanding_check: [CHECK],
  blind: [BLIND],
};

async function withModel(replies: Replies, options: Parameters<typeof setup>[0] = {}) {
  const m = model(replies);
  // The first of each draw: the step's first genre (a conversation, a chat), the first voice.
  const api = await setup({ random: () => 0, ...options, fetch: m.fetch });
  await api.send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await api.send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  return { ...api, names: m.names };
}

const state = (api: Pick<Awaited<ReturnType<typeof setup>>, "getJson">, step: string) =>
  api.getJson(`/api/llm/understanding?lessonKey=${LESSON}&step=${step}`);

/** Qwen3-TTS here, each reading a tenth of a second of 16 kHz audio. */
const QWEN = () =>
  qwen(["qwen-tokenizer-12hz-Q8_0.gguf", "qwen-talker-0.6b-customvoice-Q8_0.gguf"], () =>
    writeWav(new Int16Array(1600).fill(100), 16000),
  );

test("a text made: three drafts, rated, the best kept; questions asked and read again with and without the text; recorded by its people's voices into the course's practice; answered and in the Notebook", async () => {
  const q = QWEN();
  const api = await withModel(REPLIES, { speech: q.host });
  const { send, sendJson, getJson, names } = api;
  // A text belongs to a run of the lesson: none yet, so it is refused before the model is asked.
  const early = await send("POST", "/api/llm/understanding", LISTENING);
  expect([early.status, ((await early.json()) as { error: string }).error]).toEqual([
    409,
    "no_lesson_run",
  ]);
  expect(names).toEqual([]);
  const run = (await sendJson("POST", "/api/runs", START)).run.id;

  const text = await sendJson("POST", "/api/llm/understanding", LISTENING);
  expect(names.slice(0, 5)).toEqual([
    "understanding_draft",
    "understanding_draft",
    "understanding_draft",
    "understanding_judge",
    "understanding_questions",
  ]);
  // Two questions settled, fewer than four: asked again once (no better), read again again.
  expect(names.slice(5).sort()).toEqual([
    "blind",
    "blind",
    "understanding_check",
    "understanding_check",
    "understanding_questions",
  ]);
  const r = text.result;
  expect([r.step, r.kind, r.title]).toEqual(["listening", "dialogue", "В пекарне"]);
  expect(r.rating).toMatchObject({ interest: 5, drafts: 3 });
  expect(r.lines[1]).toEqual({ speaker: "Herr Brandt", text: "Gern. Möchten Sie auch ein Brot?" });
  // Left out: answered otherwise (3), ambiguous (4), given away without the text (5).
  expect(
    r.questions.map((q: { question: string; phase: string }) => [q.question, q.phase]),
  ).toEqual([
    ["Anna möchte drei Brötchen.", "listening"],
    ["Wie viel kostet das?", "listening"],
  ]);
  expect([text.runId, text.model, text.answers]).toEqual([run, "m", []]);
  // Glossed as new: only words not met — "gern" is one of the lesson's own.
  expect(r.glossary.map((g: { word: string }) => g.word)).toEqual(["Brötchen", "macht"]);
  // Its people voiced by their gender among Qwen3-TTS's speakers; every line read when it was made.
  expect(r.voices.engine).toBe("qwen");
  expect(Object.keys(r.voices.by).sort()).toEqual(["Anna", "Herr Brandt"]);
  expect(q.asked).toHaveLength(7);
  expect(q.asked[1]).toMatchObject({
    input: "Gern. Möchten Sie auch ein Brot?",
    voice: r.voices.by["Herr Brandt"],
  });
  // Kept in the course's practice, the text the variant taken; its recording there too.
  expect(r.variant).toMatch(/^[a-z0-9]{12}$/);
  expect(r.recording).toBe(`practice/ru-de/demo/00-01/${r.variant}.wav`);
  const kept = await api.get(`/library/${FIXTURE_SERIES}/${r.recording}`);
  expect([kept.status, kept.headers.get("content-type")]).toEqual([200, "audio/wav"]);

  // Its recording: the lines joined, a pause after each — one WAV for the course's player.
  const audio = await api.get(`/api/llm/understanding/audio?lessonKey=${LESSON}&id=${text.id}`);
  expect([audio.status, audio.headers.get("content-type")]).toEqual([200, "audio/wav"]);
  const joined = readWav(new Uint8Array(await audio.arrayBuffer()));
  // 7 lines of 0.1 s, 6 pauses of 0.65 s and the last line's 0.25 s.
  expect(joined?.samples.length).toBe(7 * 1600 + 6 * 10400 + 4000);
  expect(
    (await api.get(`/api/llm/understanding/audio?lessonKey=${LESSON}&id=${ulid()}`)).status,
  ).toBe(404);
  // A recording not here (a bundle without it): its lines read again.
  rmSync(join(api.root, "library", FIXTURE_SERIES, r.recording));
  const reread = await api.get(`/api/llm/understanding/audio?lessonKey=${LESSON}&id=${text.id}`);
  expect(reread.status).toBe(200);
  expect(readWav(new Uint8Array(await reread.arrayBuffer()))?.samples.length).toBe(
    joined?.samples.length,
  );

  // Answered: a choice wrong, an answer typed right; a question answered twice keeps its first.
  const answer = (question: number, value: unknown) =>
    send("POST", "/api/llm/understanding/answer", {
      ...START,
      language: "ru",
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
  expect((await answer(1, { optionId: "a" })).status).toBe(400);
  expect((await answer(9, { optionId: "a" })).status).toBe(404);
  const missing = await send("POST", "/api/llm/understanding/answer", {
    ...START,
    language: "ru",
    id: ulid(),
    question: 0,
    answer: { optionId: "a" },
  });
  expect(missing.status).toBe(404);

  // A step's own texts: Listening's here, none of Reading's.
  const listening = await state(api, "listening");
  expect([listening.preparing, listening.texts.length]).toEqual([false, 1]);
  expect((await state(api, "reading")).texts).toEqual([]);

  // The step done, the Notebook counts the text and shows it with its answers.
  await sendJson("POST", `/api/runs/${run}/events`, {
    events: [{ id: ulid(), type: "step_done", payload: { step: "listening" } }],
  });
  const lesson = await getJson(`/api/notebook/lesson?lessonKey=${LESSON}`);
  expect(lesson.passes[0].understanding).toBe(1);
  const pass = await getJson(`/api/notebook/passes/${run}`);
  expect(pass.understanding.map((u: { id: string }) => u.id)).toEqual([text.id]);

  const prompt = await sendJson("POST", "/api/llm/understanding/prompt", LISTENING);
  expect(prompt.body.response_format.json_schema.name).toBe("understanding_draft");
  expect(prompt.body.messages[1].content).toContain("Learner's level: beginner (A1–A2)");
});

test("no draft passing: the best written again with its problems; still none, nothing is kept", async () => {
  const failing = {
    ratings: [rating(1, { coherent: 2, problems: ['"Ich frage zweimal" folgt aus nichts'] })],
  };
  const failingAll = {
    ratings: [failing.ratings[0], rating(2, { coherent: 2 }), rating(3, { realistic: 2 })],
  };
  const api = await withModel(
    {
      ...REPLIES,
      understanding_judge: [
        { ratings: [failing.ratings[0], rating(2, { realistic: 1 }), rating(3, { natural: 2 })] },
        { ratings: [rating(1)] },
      ],
    },
    { speech: QWEN().host },
  );
  await api.sendJson("POST", "/api/runs", START);
  const text = await api.sendJson("POST", "/api/llm/understanding", LISTENING);
  expect(api.names.filter((n) => n === "understanding_draft")).toHaveLength(4);
  expect(text.result.rating.drafts).toBe(4);

  // Written again and still short, but nothing plainly wrong (3s): the better of the two kept.
  const short = await withModel(
    {
      ...REPLIES,
      understanding_judge: [failingAll, { ratings: [rating(1, { coherent: 3 })] }],
    },
    { speech: QWEN().host },
  );
  await short.sendJson("POST", "/api/runs", START);
  const kept = await short.sendJson("POST", "/api/llm/understanding", LISTENING);
  expect(kept.result.rating.coherent).toBe(3);

  const none = await withModel(
    {
      ...REPLIES,
      understanding_judge: [failingAll, failing],
    },
    { speech: QWEN().host },
  );
  await none.sendJson("POST", "/api/runs", START);
  const res = await none.send("POST", "/api/llm/understanding", LISTENING);
  expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([
    502,
    "llm_invalid_output",
  ]);
  expect((await state(none, "listening")).texts).toEqual([]);
});

test("too few questions settled: asked again once and the better kept; none settled: nothing is kept", async () => {
  const few = { answers: CHECK.answers.slice(0, 1) };
  const api = await withModel(
    {
      ...REPLIES,
      understanding_check: [few, SETTLES_ALL],
      blind: [{ answers: [] }],
    },
    { speech: QWEN().host },
  );
  await api.sendJson("POST", "/api/runs", START);
  const text = await api.sendJson("POST", "/api/llm/understanding", LISTENING);
  expect(api.names.filter((n) => n === "understanding_questions")).toHaveLength(2);
  expect(text.result.questions).toHaveLength(5);

  const none = await withModel(
    { ...REPLIES, understanding_check: [{ answers: [] }] },
    { speech: QWEN().host },
  );
  await none.sendJson("POST", "/api/runs", START);
  const res = await none.send("POST", "/api/llm/understanding", LISTENING);
  expect(res.status).toBe(502);
});

test("a run starts: nothing made by the model; Another version takes the step's next the learner has not had; none left: refused, the latest stays — a new run keeps it too", async () => {
  const api = await withModel(
    { ...REPLIES, understanding_check: [SETTLES_ALL], blind: [{ answers: [] }] },
    { speech: QWEN().host },
  );
  const counts = async () =>
    (
      await api.getJson(
        `/api/llm/practice/lesson?series=${FIXTURE_SERIES}&lessonKey=${LESSON}&edition=ru-de`,
      )
    ).reading;
  // No practice in the course: the run starts, nothing is made, nothing taken.
  await api.sendJson("POST", "/api/runs", START);
  await new Promise((r) => setTimeout(r, 50));
  expect(api.names).toEqual([]);
  expect((await state(api, "reading")).texts).toEqual([]);
  // Two in the course's practice, the first taken.
  const first = await api.sendJson("POST", "/api/llm/understanding", {
    ...START,
    language: "ru",
    step: "reading",
    count: 2,
  });
  expect(await counts()).toEqual({ made: 2, left: 1 });
  const asked = api.names.length;
  const NEXT = { ...START, step: "reading" };
  const second = await api.sendJson("POST", "/api/llm/practice/next", NEXT);
  expect(second.result.variant).not.toBe(first.result.variant);
  expect(api.names.length).toBe(asked);
  expect(await counts()).toEqual({ made: 2, left: 0 });
  const none = await api.send("POST", "/api/llm/practice/next", NEXT);
  expect(none.status).toBe(404);
  await api.sendJson("POST", "/api/runs", { ...START, restart: true });
  await new Promise((r) => setTimeout(r, 50));
  const shown = (await state(api, "reading")).texts;
  expect(shown).toHaveLength(2);
  expect(shown[0].id).toBe(second.id);
  expect(api.names.length).toBe(asked);
});

test("a step's latest untouched or half done is the learner's to finish: a new run takes nothing for it, a resumed one nothing at all; done, the next is taken; a step opening empty takes once, however often asked", async () => {
  const api = await withModel(
    { ...REPLIES, understanding_check: [SETTLES_ALL], blind: [{ answers: [] }] },
    { speech: QWEN().host },
  );
  const READING = { ...START, language: "ru", step: "reading" };
  await api.sendJson("POST", "/api/runs", START);
  const first = await api.sendJson("POST", "/api/llm/understanding", { ...READING, count: 3 });
  const shown = async () => (await state(api, "reading")).texts;
  const restart = async () => {
    await api.sendJson("POST", "/api/runs", { ...START, restart: true });
    await new Promise((r) => setTimeout(r, 50));
  };
  // Untouched: kept.
  await restart();
  expect((await shown()).map((t: { id: string }) => t.id)).toEqual([first.id]);
  // Half done: kept.
  await api.send("POST", "/api/llm/understanding/answer", {
    ...READING,
    id: first.id,
    question: 0,
    answer: { optionId: "a" },
  });
  await restart();
  expect(await shown()).toHaveLength(1);
  // Resumed (not restarted): nothing taken.
  for (const [question, q] of (first.result.questions as Array<{ options?: string[] }>).entries())
    if (question > 0)
      await api.send("POST", "/api/llm/understanding/answer", {
        ...READING,
        id: first.id,
        question,
        answer: q.options ? { optionId: "a" } : { g1: "x" },
      });
  await api.sendJson("POST", "/api/runs", START);
  await new Promise((r) => setTimeout(r, 50));
  expect(await shown()).toHaveLength(1);
  // Done: a new run takes the next.
  await restart();
  expect(await shown()).toHaveLength(2);
  // Work there: "only while none" takes nothing, asked twice at once.
  const NEXT = { ...START, step: "reading", ifNone: true };
  const twice = await Promise.all([
    api.sendJson("POST", "/api/llm/practice/next", NEXT),
    api.sendJson("POST", "/api/llm/practice/next", NEXT),
  ]);
  expect(twice).toEqual([null, null]);
  expect(await shown()).toHaveLength(2);
  // No work of the step (progress reset; the lesson's start takes none: the place off): asked twice
  // at once, one taken.
  await api.send("PUT", "/api/settings", { key: "llm.offIn", value: ["understanding"] });
  await api.sendJson("POST", "/api/progress/reset", {
    series: FIXTURE_SERIES,
    course: "demo",
    lesson: LESSON,
  });
  await restart();
  expect(await shown()).toEqual([]);
  const once = await Promise.all([
    api.sendJson("POST", "/api/llm/practice/next", NEXT),
    api.sendJson("POST", "/api/llm/practice/next", NEXT),
  ]);
  expect(once.filter(Boolean)).toHaveLength(1);
  expect(await shown()).toHaveLength(1);
});

test("the course's practice: texts made gather in the course, the step takes the next the learner has not had; a new run takes one without the model; a course removed keeps them", async () => {
  const api = await withModel(
    { ...REPLIES, understanding_check: [SETTLES_ALL], blind: [{ answers: [] }] },
    { speech: QWEN().host },
  );
  const READING = { ...START, language: "ru", step: "reading" };
  const practice = () =>
    JSON.parse(
      readFileSync(
        join(api.root, "library", FIXTURE_SERIES, "practice/ru-de/demo/00-01.json"),
        "utf8",
      ),
    ) as { language: string; reading: Array<{ id: string; text: { title: string } }> };
  await api.sendJson("POST", "/api/runs", START);
  // Two made at once into the course's practice, in its edition's language — from one round of
  // drafts: the best and the other that passes —; the first taken.
  const first = await api.sendJson("POST", "/api/llm/understanding", { ...READING, count: 2 });
  expect(api.names.filter((n) => n === "understanding_draft")).toHaveLength(3);
  expect(api.names.filter((n) => n === "understanding_judge")).toHaveLength(1);
  const made = practice();
  expect(made.language).toBe("ru");
  expect(made.reading.map((v) => v.id)).toHaveLength(2);
  expect(first.result.variant).toBe(made.reading[0]?.id);

  // The step done, a new run of the lesson takes the next variant as it starts: no model asked.
  const asked = api.names.length;
  for (const [question, q] of (first.result.questions as Array<{ options?: string[] }>).entries())
    await api.send("POST", "/api/llm/understanding/answer", {
      ...START,
      language: "ru",
      id: first.id,
      question,
      answer: q.options ? { optionId: "a" } : { g1: "x" },
    });
  await api.sendJson("POST", "/api/runs", { ...START, restart: true });
  await until(async () => (await state(api, "reading")).texts.length === 2);
  expect(api.names.length).toBe(asked);
  expect((await state(api, "reading")).texts[0].result.variant).toBe(made.reading[1]?.id);

  // The course removed: its practice stays, there for it when it comes back.
  await api.send("DELETE", `/api/courses/${FIXTURE_SERIES}/demo`, undefined);
  expect(practice().reading).toHaveLength(2);
});

test("a course's practice made in one go: each lesson's step in course order, a job a course's edition at a time; Listening needs Qwen3-TTS", async () => {
  const api = await withModel({
    ...REPLIES,
    understanding_check: [SETTLES_ALL],
    blind: [{ answers: [] }],
  });
  const COURSE = { series: FIXTURE_SERIES, course: "demo", edition: "ru-de" };
  const query = `series=${FIXTURE_SERIES}&course=demo&edition=ru-de`;
  const before = await api.getJson(`/api/llm/practice?${query}`);
  expect(before).toMatchObject({ made: 0, voice: false, job: null });
  expect(before.variants).toEqual({ reading: 0, listening: 0, writing: 0, speaking: 0 });

  // Listening without Qwen3-TTS here: refused before anything is made.
  const deaf = await api.send("POST", "/api/llm/practice", { ...COURSE, steps: ["listening"] });
  expect([deaf.status, ((await deaf.json()) as { error: string }).error]).toEqual([
    409,
    "practice_needs_voice",
  ]);

  const job = await api.sendJson("POST", "/api/llm/practice", {
    ...COURSE,
    steps: ["reading"],
    count: 1,
  });
  expect(job).toMatchObject({
    state: "running",
    steps: ["reading"],
    count: 1,
    total: before.lessons,
  });
  // One a course's edition at a time.
  const twice = await api.send("POST", "/api/llm/practice", { ...COURSE, steps: ["reading"] });
  expect(((await twice.json()) as { error: string }).error).toBe("practice_busy");
  await until(async () => (await api.getJson(`/api/llm/practice?${query}`)).job.state === "done");
  const after = await api.getJson(`/api/llm/practice?${query}`);
  expect(after.job).toMatchObject({ done: before.lessons, failed: [], current: [] });
  expect([after.made, after.variants.reading]).toEqual([before.lessons, before.lessons]);

  // Started again: each lesson's step filled up to the count — nothing left at one; at two, one
  // more each, several lessons at a time.
  const drafts = () => api.names.filter((n) => n === "understanding_draft").length;
  const drafted = drafts();
  const none = await api.sendJson("POST", "/api/llm/practice", { ...COURSE, steps: ["reading"] });
  expect(none).toMatchObject({ total: 0 });
  await until(async () => (await api.getJson(`/api/llm/practice?${query}`)).job.state === "done");
  expect(drafts()).toBe(drafted);
  const more = await api.sendJson("POST", "/api/llm/practice", {
    ...COURSE,
    steps: ["reading"],
    count: 2,
  });
  expect(more).toMatchObject({ total: before.lessons, count: 2 });
  expect(more.current.length).toBeGreaterThan(1);
  await until(async () => (await api.getJson(`/api/llm/practice?${query}`)).job.state === "done");
  expect((await api.getJson(`/api/llm/practice?${query}`)).variants.reading).toBe(
    2 * before.lessons,
  );
});
