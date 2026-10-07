import { expect, test } from "bun:test";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { setup } from "./setup.ts";

const LESSON = "sprachanker.fixture/demo/00-01";
const SETUP = {
  title: "Im Café",
  situation: "Вы в кафе.",
  partner: "Официант",
  goals: ["Поздороваться", "Заказать кофе"],
  opening: "Guten Tag! Was möchten Sie?",
};

/** A model answering scene_setup and scene_turn requests in order. */
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

test("a scene: setup, turns with corrections and goals, done when all goals are met", async () => {
  const m = model([
    SETUP,
    {
      reply: "Gern. Möchten Sie Kaffee?",
      translation: "…",
      corrections: [{ wrong: "Gutten", right: "Guten", explanation: "…" }],
      goalsMet: [0],
      done: false,
    },
    {
      reply: "Hier, bitte. Tschüss!",
      translation: "…",
      corrections: [{ wrong: "Gutten", right: "Guten", explanation: "repeat" }],
      goalsMet: [1],
      done: false,
    },
  ]);
  const { send, sendJson, getJson } = await setup({ fetch: m.fetch });
  await send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  const base = { series: FIXTURE_SERIES, lessonKey: LESSON, edition: "ru-de", language: "ru" };

  expect(await getJson(`/api/llm/scene?lessonKey=${LESSON}`)).toEqual({
    scenes: [],
    pending: null,
  });
  const started = await sendJson("POST", "/api/llm/scene/start", base);
  expect(started.turns).toEqual([
    {
      role: "assistant",
      text: SETUP.opening,
      model: "m",
      latencyMs: expect.any(Number),
      goalsMet: [],
      ts: expect.any(Number),
    },
  ]);

  const first = await sendJson("POST", "/api/llm/scene/turn", { ...base, text: "Gutten Tag!" });
  expect(first.turns.at(-2).corrections).toHaveLength(1);
  expect([first.goalsMet, first.done]).toEqual([[0], false]);

  const prompt = await sendJson("POST", "/api/llm/scene/prompt", { ...base, text: "Einen Kaffee" });
  expect(prompt.body.messages.at(-1).content).toBe("<line>Einen Kaffee</line>");

  const last = await sendJson("POST", "/api/llm/scene/turn", {
    ...base,
    text: "Einen Kaffee, bitte.",
  });
  // The repeated correction is dropped; goals accumulate; all met → the scene is done.
  expect(last.turns.at(-2).corrections).toEqual([]);
  expect([last.goalsMet, last.done]).toEqual([[0, 1], true]);
  expect(m.names).toEqual(["scene_setup", "scene_turn", "scene_turn"]);

  const res = await send("POST", "/api/llm/scene/turn", { ...base, text: "Noch was" });
  expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([
    409,
    "no_active_scene",
  ]);
  const [done] = (await getJson(`/api/llm/scene?lessonKey=${LESSON}`)).scenes;
  expect([done.id, done.done, done.turns.length]).toEqual([started.id, true, 5]);
});

test("the lesson's scenes stay readable: a new one ends the open one and comes first", async () => {
  const m = model([SETUP, { ...SETUP, title: "Am Bahnhof" }]);
  const { send, sendJson, getJson } = await setup({ fetch: m.fetch });
  await send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  const base = { series: FIXTURE_SERIES, lessonKey: LESSON, edition: "ru-de", language: "ru" };
  const first = await sendJson("POST", "/api/llm/scene/start", base);
  expect(first.done).toBe(false);
  const second = await sendJson("POST", "/api/llm/scene/start", base);
  const { scenes } = await getJson(`/api/llm/scene?lessonKey=${LESSON}`);
  expect(
    scenes.map((s: { id: string; setup: { title: string }; done: boolean }) => [
      s.id,
      s.setup.title,
      s.done,
    ]),
  ).toEqual([
    [second.id, "Am Bahnhof", false],
    [first.id, "Im Café", true],
  ]);
  expect(scenes[1].startedAt).toBeLessThanOrEqual(scenes[0].startedAt);
});

test("a scene being prepared is known to a page opened meanwhile; a second start waits its turn", async () => {
  let answer: (body: unknown) => void = () => {};
  const fetch = (async (url: string) => {
    if (url.endsWith("/api/v1/models")) return Response.json({ models: [] });
    // The model answers when the test says so.
    const body = await new Promise((resolve) => {
      answer = resolve;
    });
    return Response.json({ choices: [{ message: { content: JSON.stringify(body) } }] });
  }) as unknown as typeof globalThis.fetch;
  const { send, sendJson, getJson } = await setup({ fetch });
  await send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  const base = { series: FIXTURE_SERIES, lessonKey: LESSON, edition: "ru-de", language: "ru" };
  const started = sendJson("POST", "/api/llm/scene/start", base);
  await Bun.sleep(20);
  expect((await getJson(`/api/llm/scene?lessonKey=${LESSON}`)).pending).toEqual({
    preparing: true,
  });
  const second = await send("POST", "/api/llm/scene/start", base);
  expect([second.status, ((await second.json()) as { error: string }).error]).toEqual([
    409,
    "scene_busy",
  ]);
  answer(SETUP);
  expect((await started).setup.title).toBe("Im Café");
  const after = await getJson(`/api/llm/scene?lessonKey=${LESSON}`);
  expect([after.pending, after.scenes.length]).toEqual([null, 1]);
});
