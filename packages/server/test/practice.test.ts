import { expect, test } from "bun:test";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { ulid } from "ulid";
import { setup } from "./setup.ts";

const LESSON = "sprachanker.fixture/demo/00-01";
const CHECK = {
  verdict: "minor_errors",
  corrected: "Ich heiße Lena.",
  corrections: [
    { wrong: "heisse", right: "heiße", explanation: "ß" },
    { wrong: "Lena", right: "Lena", explanation: "no change" },
  ],
  criteria: {
    task: { score: 2, comment: "ok" },
    communication: { score: 1, comment: "ok" },
    accuracy: { score: 1, comment: "ok" },
  },
  feedback: "Gut!",
};

/** A model that answers structured requests with `reply` (first `bad` invalid replies). */
function model(reply: unknown, bad = 0) {
  const bodies: Array<Record<string, unknown>> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    if (url.endsWith("/api/v1/models")) return Response.json({ models: [] });
    bodies.push(JSON.parse(init.body as string));
    const content = bodies.length <= bad ? "not json" : JSON.stringify(reply);
    return Response.json({ choices: [{ message: { content } }] });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, bodies };
}

const REQUEST = {
  series: FIXTURE_SERIES,
  lessonKey: LESSON,
  edition: "ru-de",
  text: "Ich heisse Lena.",
  language: "ru",
};

test("writing: the task from the lesson, a checked attempt stored, the prompt with its schema", async () => {
  const m = model(CHECK, 1);
  const { send, sendJson, getJson } = await setup({ fetch: m.fetch });
  await send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await send("PUT", "/api/llm/route", { provider: "custom", model: "m" });

  const query = `series=${FIXTURE_SERIES}&lessonKey=${LESSON}&edition=ru-de`;
  const before = await getJson(`/api/llm/writing?${query}`);
  expect(before.goals.length).toBeGreaterThan(0);
  expect(before.words).toContain("der Kaffee, die Kaffees");
  expect(before.attempts).toEqual([]);

  const attempt = await sendJson("POST", "/api/llm/writing", REQUEST);
  expect(attempt.result.verdict).toBe("minor_errors");
  // The no-op correction is dropped; the invalid first reply was repaired.
  expect(attempt.result.corrections).toHaveLength(1);
  expect(m.bodies).toHaveLength(2);
  expect(m.bodies[0]).toMatchObject({ stream: false, response_format: { type: "json_schema" } });

  const after = await getJson(`/api/llm/writing?${query}`);
  expect(after.attempts.map((a: { text: string }) => a.text)).toEqual(["Ich heisse Lena."]);
  // Practice runs do not count as lesson progress.
  expect((await getJson("/api/courses"))[0].done).toBe(0);

  const prompt = await sendJson("POST", "/api/llm/writing/prompt", { ...REQUEST, text: "" });
  expect(prompt.body.response_format.json_schema.name).toBe("writing_check");
  expect(prompt.body.messages[0].content).toContain("Goethe A1");
});

test("writing: a model that never returns valid JSON is reported, nothing stored", async () => {
  const { send, getJson } = await setup({ fetch: model(CHECK, 9).fetch });
  await send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  const res = await send("POST", "/api/llm/writing", REQUEST);
  expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([
    502,
    "llm_invalid_output",
  ]);
  const state = await getJson(
    `/api/llm/writing?series=${FIXTURE_SERIES}&lessonKey=${LESSON}&edition=ru-de`,
  );
  expect(state.attempts).toEqual([]);
});

test("review: built from the latest lesson run, stored, stale after new answers", async () => {
  const REVIEW = {
    summary: "Gut.",
    strengths: ["Begrüßung"],
    topics: [{ topic: "Herr/Frau", explanation: "…", examples: ["Guten Tag, Frau Weber."] }],
    next: ["Übung 6 wiederholen"],
  };
  const m = model(REVIEW);
  const { send, sendJson, getJson } = await setup({ fetch: m.fetch });
  await send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  expect(await getJson(`/api/llm/review?lessonKey=${LESSON}`)).toEqual({
    possible: false,
    review: null,
    stale: false,
  });

  const run = (
    await sendJson("POST", "/api/runs", {
      series: FIXTURE_SERIES,
      lessonKey: LESSON,
      edition: "ru-de",
    })
  ).run.id;
  const answer = (item: string, value: unknown) =>
    sendJson("POST", `/api/runs/${run}/events`, {
      events: [
        {
          id: ulid(),
          type: "answered",
          itemKey: item,
          payload: { answer: value, attempt: 1, ms: 1 },
        },
      ],
    });
  await answer(`${LESSON}/ex-06#1`, { g1: "a" });
  await answer(`${LESSON}/ex-01#1`, { optionId: "a" });
  await answer(`${LESSON}/ex-01#2`, { optionId: "b" });

  const body = { series: FIXTURE_SERIES, lessonKey: LESSON, edition: "ru-de", language: "ru" };
  const prompt = await sendJson("POST", "/api/llm/review/prompt", body);
  const data = prompt.body.messages[1].content as string;
  expect(data).toContain("Right at the first attempt: 2 of 3 items.");
  expect(data).toMatch(/Exercises without mistakes: .+/);
  expect(data).toContain("learner: Guten Tag, [Herr] Weber.");

  const review = await sendJson("POST", "/api/llm/review", body);
  expect(review.result.topics[0].topic).toBe("Herr/Frau");
  const state = await getJson(`/api/llm/review?lessonKey=${LESSON}`);
  expect([state.possible, state.review.result.summary, state.stale]).toEqual([true, "Gut.", false]);

  await answer(`${LESSON}/ex-07#1`, { g1: "a", g2: "b" });
  expect((await getJson(`/api/llm/review?lessonKey=${LESSON}`)).stale).toBe(true);
});
