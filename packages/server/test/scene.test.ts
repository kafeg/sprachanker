// The Dialogue (04, "AI practice in courses"; 07): a setup with what the partner knows (hidden until
// it is over), lines said and heard or typed, each judged, a summary once it ends — all kept in the
// scene run.
import { expect, test } from "bun:test";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { setup } from "./setup.ts";
import { until } from "./until.ts";

const LESSON = "sprachanker.fixture/demo/00-01";
const SETUP = {
  title: "Im Café",
  situation: "Вы в кафе.",
  partner: "Официант",
  goals: ["Поздороваться", "Узнать цену кофе"],
  opening: "Guten Tag! Was möchten Sie?",
  openingTranslation: "Здравствуйте! Что желаете?",
  partnerInfo: ["Ein Kaffee kostet 2,50 Euro."],
};
const SUMMARY = {
  corrections: [
    { wrong: "Gutten", right: "Guten", explanation: "…", model: "Guten Tag!" },
    { wrong: "never said", right: "x", explanation: "…", model: "x" },
  ],
  feedback: "Gut gemacht.",
};
const line = (extra: object) => ({
  reply: "Gern.",
  translation: "…",
  understood: true,
  fits: true,
  corrections: [],
  goalsMet: [],
  done: false,
  ...extra,
});

/** A model answering the Dialogue's requests in order (`null`: a reply out of shape). */
function model(replies: unknown[]) {
  const names: string[] = [];
  const asked: string[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    if (url.endsWith("/api/v1/models")) return Response.json({ models: [] });
    const body = JSON.parse(init.body as string);
    names.push(body.response_format?.json_schema?.name);
    asked.push(body.messages.at(-1).content);
    const reply = replies.shift();
    return Response.json({
      choices: [{ message: { content: reply === null ? "{}" : JSON.stringify(reply) } }],
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, names, asked };
}

async function signedIn(replies: unknown[]) {
  const m = model(replies);
  const app = await setup({ fetch: m.fetch });
  await app.send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await app.send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  return { ...app, m };
}

const base = { series: FIXTURE_SERIES, lessonKey: LESSON, edition: "ru-de", language: "ru" };
const RECORDING = "01K7A0Z8ZQ4J1V2W3X4Y5Z6A7B";

test("a Dialogue held by voice: setup with a hidden information gap, lines heard and judged, done when its goals are met, then summed up", async () => {
  const { send, sendJson, getJson, m } = await signedIn([
    SETUP,
    line({
      corrections: [
        { wrong: "Gutten", right: "Guten", explanation: "…" },
        { wrong: "tag", right: "Tag", explanation: "capitals: the recogniser's" },
      ],
      goalsMet: [0],
    }),
    line({
      reply: "2,50 Euro. Tschüss!",
      corrections: [{ wrong: "Gutten", right: "Guten", explanation: "repeat" }],
      goalsMet: [1],
      fits: false,
    }),
    SUMMARY,
  ]);

  expect(await getJson(`/api/llm/scene?lessonKey=${LESSON}`)).toEqual({
    scenes: [],
    pending: null,
  });
  const started = await sendJson("POST", "/api/llm/scene/start", base);
  // What the partner knows stays hidden while the Dialogue runs.
  expect(started.setup.partnerInfo).toBeUndefined();
  expect(started.setup.goals).toEqual(SETUP.goals);
  expect([started.turns.length, started.summary]).toEqual([1, null]);
  // The opening with its translation: "Translate" works on the first line too.
  expect(started.turns[0]).toMatchObject({
    role: "assistant",
    text: SETUP.opening,
    translation: SETUP.openingTranslation,
  });

  const first = await sendJson("POST", "/api/llm/scene/turn", {
    ...base,
    text: "Gutten tag",
    spoken: true,
    recording: RECORDING,
  });
  // Said aloud: the line goes as heard, marked; the model's facts go with the scene.
  expect(m.asked.at(-1)).toBe("<line said>Gutten tag</line>");
  const said = first.turns.at(-2);
  expect(said).toMatchObject({
    role: "user",
    text: "Gutten tag",
    spoken: true,
    recording: RECORDING,
    understood: true,
    fits: true,
  });
  // The case-only correction is dropped: a recogniser's capitals are no error.
  expect(said.corrections.map((c: { right: string }) => c.right)).toEqual(["Guten"]);
  expect([first.goalsMet, first.done]).toEqual([[0], false]);

  const prompt = await sendJson("POST", "/api/llm/scene/prompt", { ...base, text: "Was kostet" });
  expect(prompt.body.messages.at(-1).content).toBe("<line>Was kostet</line>");
  // The prompt viewer is the learner's: what the partner knows stays hidden there too.
  expect(prompt.body.messages[0].content).toContain("You know: (hidden until the end)");
  expect(prompt.body.messages[0].content).not.toContain("2,50");

  const last = await sendJson("POST", "/api/llm/scene/turn", {
    ...base,
    text: "Was kostet der Kaffee?",
  });
  // Typed (no microphone): no take, not marked spoken; the repeated correction is dropped; goals
  // accumulate; all met → done, the final line back at once, its summary the next step.
  expect(last.turns.at(-2).spoken).toBeUndefined();
  expect(last.turns.at(-2)).toMatchObject({ corrections: [], fits: false });
  expect([last.goalsMet, last.done, last.summary]).toEqual([[0, 1], true, null]);
  expect(last.turns.at(-1).text).toBe("2,50 Euro. Tschüss!");
  expect(last.setup.partnerInfo).toEqual(SETUP.partnerInfo);
  await until(async () => (await getJson(`/api/llm/scene?lessonKey=${LESSON}`)).pending === null);
  const [summed] = (await getJson(`/api/llm/scene?lessonKey=${LESSON}`)).scenes;
  expect(summed.summary).toEqual({
    corrections: [SUMMARY.corrections[0]],
    feedback: "Gut gemacht.",
    model: "m",
  });
  expect(m.names).toEqual(["scene_setup", "scene_turn", "scene_turn", "scene_summary"]);
  expect(m.asked.at(-1)).toContain("Goals reached: 2 of 2");

  const res = await send("POST", "/api/llm/scene/turn", { ...base, text: "Noch was" });
  expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([
    409,
    "no_active_scene",
  ]);
  const [done] = (await getJson(`/api/llm/scene?lessonKey=${LESSON}`)).scenes;
  expect([done.id, done.done, done.turns.length, done.summary.feedback]).toEqual([
    started.id,
    true,
    5,
    "Gut gemacht.",
  ]);
});

test("ended by the learner: summed up; a summary that fails is asked for again", async () => {
  const { sendJson, send, m } = await signedIn([
    SETUP,
    line({ goalsMet: [0] }),
    // The summary out of shape twice (one repair): none kept, the Dialogue ended all the same.
    null,
    null,
    SUMMARY,
  ]);
  await sendJson("POST", "/api/llm/scene/start", base);
  await sendJson("POST", "/api/llm/scene/turn", { ...base, text: "Gutten Tag" });
  const ended = await sendJson("POST", "/api/llm/scene/end", base);
  expect([ended.done, ended.summary, ended.goalsMet]).toEqual([true, null, [0]]);
  expect(ended.setup.partnerInfo).toEqual(SETUP.partnerInfo);
  const again = await sendJson("POST", "/api/llm/scene/summary", base);
  expect(again.summary.corrections).toHaveLength(1);
  expect(m.names.filter((n) => n === "scene_summary")).toHaveLength(3);
  // Nothing open to end any more.
  const res = await send("POST", "/api/llm/scene/end", base);
  expect(res.status).toBe(409);
});

test("the lesson's Dialogues stay readable: a new one ends the open one and comes first", async () => {
  const { sendJson, getJson } = await signedIn([SETUP, { ...SETUP, title: "Am Bahnhof" }]);
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

test("a Dialogue being prepared is known to a page opened meanwhile; a second start waits its turn", async () => {
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
