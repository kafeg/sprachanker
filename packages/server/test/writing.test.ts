// "Write it yourself" (04, "AI practice in courses"; 07): a task written by the model — a situation and
// three content points, its length the level's —, kept in the lesson run; a text on it checked (each
// point rated, at most three corrections, a model text) and kept with its task; the lesson's tasks
// and checks read across its runs.
import { expect, test } from "bun:test";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { setup } from "./setup.ts";

const LESSON = "sprachanker.fixture/demo/00-01";
const TASK = {
  situation: "Вы договорились встретиться с Леной в кафе. Напишите ей сообщение.",
  points: ["Скажите, что опоздаете.", "Объясните почему.", "Напишите, когда придёте."],
};
const fix = (wrong: string, right: string) => ({ wrong, right, explanation: "…" });
const CHECK = {
  verdict: "minor_errors",
  corrected: "Ich heiße Lena.",
  corrections: [
    fix("heisse", "heiße"),
    fix("Lena", "Lena"),
    // Words the text does not have: dropped.
    fix("bin gekommen", "kam"),
    fix("komme", "komme gleich"),
    fix("um", "gegen"),
    fix("da", "dort"),
  ],
  criteria: {
    task: { score: 2, comment: "ok" },
    communication: { score: 1, comment: "ok" },
    accuracy: { score: 1, comment: "ok" },
  },
  points: [
    { score: 2, comment: "да" },
    { score: 1, comment: "коротко" },
    { score: 0, comment: "нет" },
  ],
  modelText: "Hallo Lena, ich komme später. Ich muss noch arbeiten. Ich bin um fünf da.",
  feedback: "Gut!",
};

/** A model answering structured requests in order (first `bad` invalid replies), each request's
 *  body kept. */
function model(replies: unknown[], bad = 0) {
  const bodies: Array<Record<string, unknown>> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    if (url.endsWith("/api/v1/models")) return Response.json({ models: [] });
    bodies.push(JSON.parse(init.body as string));
    const content = bodies.length <= bad ? "not json" : JSON.stringify(replies.shift());
    return Response.json({ choices: [{ message: { content } }] });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, bodies };
}

const START = { series: FIXTURE_SERIES, lessonKey: LESSON, edition: "ru-de" };
const IDS = { ...START, language: "ru" };
const query = `series=${FIXTURE_SERIES}&lessonKey=${LESSON}&edition=ru-de`;

async function withModel(replies: unknown[], bad = 0) {
  const m = model(replies, bad);
  const api = await setup({ fetch: m.fetch });
  await api.send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await api.send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  return { ...api, bodies: m.bodies };
}

test("writing: a task written and kept, a text on it checked and kept with its task, listed across the lesson's runs; the prompts", async () => {
  const { send, sendJson, getJson, bodies } = await withModel([TASK, CHECK, TASK, CHECK], 1);

  const before = await getJson(`/api/llm/writing?${query}`);
  expect(before.words).toContain("der Kaffee, die Kaffees");
  expect([before.task, before.attempts, before.checking, before.preparing]).toEqual([
    null,
    [],
    null,
    false,
  ]);
  // The request that writes a task, before there is one.
  const taskPrompt = await sendJson("POST", "/api/llm/writing/prompt", { ...IDS, text: "" });
  expect(taskPrompt.body.response_format.json_schema.name).toBe("writing_task");
  expect(taskPrompt.body.messages[1].content).toContain(
    "Length of the text asked for: about 30 words.",
  );

  // A task belongs to a run of the lesson: none yet, so it is refused before the model is asked.
  const early = await send("POST", "/api/llm/writing/task", IDS);
  expect([early.status, ((await early.json()) as { error: string }).error]).toEqual([
    409,
    "no_lesson_run",
  ]);
  expect(bodies).toHaveLength(0);
  const run = (await sendJson("POST", "/api/runs", START)).run.id;

  // The task: the model's situation and points (an invalid first reply repaired), the level's length.
  const task = await sendJson("POST", "/api/llm/writing/task", IDS);
  expect(task.result).toEqual({ ...TASK, words: 30 });
  expect([task.runId, task.model]).toEqual([run, "m"]);
  expect(bodies).toHaveLength(2);
  expect((await getJson(`/api/llm/writing?${query}`)).task.id).toBe(task.id);

  // A text on a task that is not the lesson's is refused.
  const text = "Ich heisse Lena. Ich komme um acht, da bin ich.";
  const stray = await send("POST", "/api/llm/writing", {
    ...IDS,
    taskId: "01HZY0000000000000000000AA",
    text,
  });
  expect(stray.status).toBe(404);

  const attempt = await sendJson("POST", "/api/llm/writing", { ...IDS, taskId: task.id, text });
  expect(attempt.result.verdict).toBe("minor_errors");
  // The no-op correction and one quoting words the text lacks dropped, at most three kept (the
  // model's order: the most important first).
  expect(attempt.result.corrections.map((c: { wrong: string }) => c.wrong)).toEqual([
    "heisse",
    "komme",
    "um",
  ]);
  expect(attempt.result.points.map((p: { score: number }) => p.score)).toEqual([2, 1, 0]);
  expect(attempt.result.modelText).toContain("Hallo Lena");
  expect(attempt.writingTask).toEqual(task.result);
  // The check was sent the task's points.
  const checked = bodies.at(-1) as { messages: Array<{ content: string }> };
  expect(checked.messages[1]?.content).toContain("Content points:\n1. Скажите, что опоздаете.");

  const state = await getJson(`/api/runs/lesson?series=${FIXTURE_SERIES}&lessonKey=${LESSON}`);
  expect(state.state.events.map((e: { type: string }) => e.type)).toEqual([
    "llm_verdict",
    "llm_verdict",
  ]);
  // A verdict is no work on the lesson: it stays new.
  expect((await getJson("/api/courses"))[0].started).toBe(false);

  // The lesson done again: a new task; the earlier task's text stays listed, the new one first.
  await sendJson("POST", "/api/runs", { ...START, restart: true });
  const second = await sendJson("POST", "/api/llm/writing/task", IDS);
  await sendJson("POST", "/api/llm/writing", {
    ...IDS,
    taskId: second.id,
    text: "Ich heiße Lena.",
  });
  const after = await getJson(`/api/llm/writing?${query}`);
  expect(after.task.id).toBe(second.id);
  expect(after.attempts.map((a: { input: string }) => a.input)).toEqual(["Ich heiße Lena.", text]);
  // An earlier task can still be written on.
  const prompt = await sendJson("POST", "/api/llm/writing/prompt", {
    ...IDS,
    taskId: task.id,
    text: "",
  });
  expect(prompt.body.response_format.json_schema.name).toBe("writing_check");
  // The fixture course's id names no level: a beginner's, said with the data, as Goethe's criteria.
  expect(prompt.body.messages[1].content).toContain("Learner's level: beginner (A1–A2)");
  expect(prompt.body.messages[1].content).toContain("What a text at A1 needs:");
  expect(prompt.body.messages[1].content).toContain("Goethe-Zertifikat's Schreiben");
  expect(prompt.body.messages[1].content).toContain("<text>\n…\n</text>");
});

test("writing: a model that never returns valid JSON is reported, nothing stored", async () => {
  const { send, sendJson, getJson } = await withModel([], 9);
  await sendJson("POST", "/api/runs", START);
  const res = await send("POST", "/api/llm/writing/task", IDS);
  expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([
    502,
    "llm_invalid_output",
  ]);
  const state = await getJson(`/api/llm/writing?${query}`);
  expect([state.task, state.attempts]).toEqual([null, []]);
});
