import { expect, test } from "bun:test";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import type { SpeechHost } from "../src/services/speech.ts";
import { setup } from "./setup.ts";

const LESSON = "sprachanker.fixture/demo/00-02";
const EXERCISE = `${LESSON}/ex-02`;
const CHECK = {
  verdict: "minor_errors",
  corrected: "Hallo, guten Tag!",
  corrections: [
    { wrong: "gute", right: "guten", explanation: "der Tag → guten Tag" },
    { wrong: "Hallo", right: "Hallo", explanation: "no change" },
  ],
  feedback: "Fast!",
};

/** The recogniser installed and a model that answers structured requests with CHECK. */
function machine() {
  const bodies: Array<Record<string, unknown>> = [];
  const heard: FormData[] = [];
  const speech: SpeechHost = {
    qwenBinary: () => undefined,
    spawnQwen: () => {
      throw new Error("no Qwen here");
    },
    whisperBinary: () => "/opt/whisper-server",
    freePort: async () => 9912,
    spawnWhisper: () => ({ exited: new Promise(() => {}), kill() {} }),
    models: {
      path: (file) => `/models/${file}`,
      async download() {},
      remove() {},
    },
  };
  const fetch = (async (url: string, init: RequestInit) => {
    if (url === "http://127.0.0.1:9912/health") return new Response("ok");
    if (url === "http://127.0.0.1:9912/inference") {
      heard.push(init.body as FormData);
      return Response.json({ text: " Hallo! Guten Tag!\n" });
    }
    if (url.endsWith("/api/v1/models")) return Response.json({ models: [] });
    bodies.push(JSON.parse(init.body as string));
    return Response.json({ choices: [{ message: { content: JSON.stringify(CHECK) } }] });
  }) as unknown as typeof globalThis.fetch;
  return { speech, fetch, bodies, heard };
}

test("speaking: an answer said aloud checked against the item and the source's answer as heard, kept once per answer in the run", async () => {
  const m = machine();
  const { send, sendJson, getJson } = await setup({ fetch: m.fetch, speech: m.speech });
  await send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  const request = {
    series: FIXTURE_SERIES,
    lessonKey: LESSON,
    edition: "ru-de",
    exerciseKey: EXERCISE,
    index: 1,
    transcript: "Hallo, gute Tag",
    runId: "01K00000000000000000000000",
    language: "ru",
  };
  // Kept in a run of the lesson: an unknown one is refused before the model is asked.
  expect((await send("POST", "/api/llm/speaking", request)).status).toBe(404);
  const runId = (
    await sendJson("POST", "/api/runs", {
      series: FIXTURE_SERIES,
      lessonKey: LESSON,
      edition: "ru-de",
    })
  ).run.id;

  const checked = await sendJson("POST", "/api/llm/speaking", { ...request, runId });
  expect(checked).toMatchObject({ itemKey: `${EXERCISE}#2`, input: "Hallo, gute Tag" });
  // The no-op correction is dropped.
  expect(checked.result.corrections).toHaveLength(1);
  const prompt = String(
    (m.bodies[0]?.messages as Array<{ content: string }> | undefined)?.[1]?.content,
  );
  expect(prompt).toContain("Prompt (learner's language): Поздоровайся с соседом.");
  expect(prompt).toContain("The source's answer, heard: Hallo! Guten Tag!");
  expect(prompt).toContain("<answer>\nHallo, gute Tag\n</answer>");
  // The source's recording heard in the language learnt, as the course file it is.
  expect(m.heard[0]?.get("language")).toBe("de");

  // The same words again: the kept check, no new call, the recording not heard again.
  await sendJson("POST", "/api/llm/speaking", { ...request, runId });
  expect(m.bodies).toHaveLength(1);
  expect(m.heard).toHaveLength(1);
  const list = await getJson(`/api/llm/speaking?lessonKey=${LESSON}&runId=${runId}`);
  expect(list.checks.map((c: { input: string }) => c.input)).toEqual(["Hallo, gute Tag"]);

  // A phrase to say is checked by the word diff, not the model.
  expect((await send("POST", "/api/llm/speaking", { ...request, runId, index: 0 })).status).toBe(
    404,
  );

  // Kept as the item's verdict: the tutor's mistakes read the correction.
  const events = (await getJson(`/api/runs/lesson?series=${FIXTURE_SERIES}&lessonKey=${LESSON}`))
    .state.events;
  expect(events.map((e: { type: string; itemKey: string }) => [e.type, e.itemKey])).toEqual([
    ["llm_verdict", `${EXERCISE}#2`],
  ]);

  const preview = await sendJson("POST", "/api/llm/speaking/prompt", { ...request, runId });
  expect(preview.body.response_format.json_schema.name).toBe("speaking_check");
});
