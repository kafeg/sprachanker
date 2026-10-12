// Speaking (04, "AI practice in courses"; 07): a monologue card set at the lesson's level, its time the
// app's; said and checked as a writing check is, said aloud; the next task a role-play — a
// conversation the text generator drafted, the learner's lines given hints, the partner a voice of
// their gender —, said line by line and checked once. Tasks and attempts kept in the lesson run, read
// across its runs; made ahead as the lesson starts.
import { expect, test } from "bun:test";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { setup } from "./setup.ts";

const LESSON = "sprachanker.fixture/demo/00-01";
const START = { series: FIXTURE_SERIES, lessonKey: LESSON, edition: "ru-de" };
const IDS = { ...START, language: "ru" };

const CARD = {
  setting: "О себе",
  instruction: "Расскажите о себе: скажите три пункта ниже.",
  topic: "Über mich",
  points: ["Name?", "Woher?", "Hobby?"],
  model: "Ich heiße Mara. Ich komme aus Polen. Ich lese gern.",
};

const DRAFT = {
  setting: "В кафе",
  title: "Кофе, пожалуйста",
  situation: "Гость заказывает кофе.",
  people: [
    { name: "Herr Brandt", gender: "m", age: "senior", role: "официант" },
    { name: "Gast", gender: "f", age: "adult", role: "гость" },
  ],
  beats: ["официант спрашивает", "гость заказывает"],
  facts: ["ein Kaffee", "ohne Zucker", "sofort"],
  text: [
    "Herr Brandt: Guten Tag! Was möchten Sie heute trinken? Wir haben Kaffee, Tee und Saft.",
    "Gast: Einen Kaffee, bitte.",
    "Herr Brandt: Gern. Möchten Sie den Kaffee mit Milch und Zucker oder lieber schwarz?",
    "Gast: Nein, ohne Zucker.",
    "Herr Brandt: Gut, ein Kaffee ohne Zucker. Ich bringe ihn sofort. Einen Moment, bitte.",
  ].join("\n"),
};
const JUDGED = {
  ratings: [1, 2, 3].map((n) => ({
    n,
    gist: "Гость заказывает кофе.",
    natural: 4,
    coherent: 4,
    realistic: 4,
    level: 4,
    lesson: 4,
    interest: 4,
    problems: [],
  })),
};
const CUES = {
  cues: [
    { n: 1, cue: "Закажите кофе." },
    { n: 3, cue: "Скажите, что без сахара." },
  ],
};
const SPOKEN = {
  verdict: "minor_errors",
  corrected: "Ich heiße Anna. Ich komme aus Spanien.",
  corrections: [{ wrong: "heisse", right: "heiße", explanation: "…" }],
  criteria: {
    task: { score: 1, comment: "" },
    communication: { score: 2, comment: "" },
    accuracy: { score: 1, comment: "" },
  },
  points: [
    { score: 2, comment: "" },
    { score: 2, comment: "" },
    { score: 0, comment: "Нет хобби." },
  ],
  modelText: "Ich heiße Anna. Ich komme aus Spanien. Ich tanze gern.",
  feedback: "Расскажите ещё о хобби.",
};
const TURNS = {
  turns: [
    {
      n: 1,
      fits: true,
      corrections: [
        { wrong: "Ein", right: "Einen", explanation: "Винительный падеж." },
        { wrong: "bitte", right: "bitte", explanation: "—" },
      ],
    },
    { n: 3, fits: false, corrections: [] },
  ],
  feedback: "Хорошо!",
};

/** A model answering each task (by its schema's name) with its replies in turn, the last again once
 *  they run out; the tasks asked and their bodies kept in order. */
function model(replies: Record<string, unknown[]>) {
  const bodies: Array<{ name: string; messages: Array<{ content: string }> }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    if (url.endsWith("/api/v1/models")) return Response.json({ models: [] });
    const body = JSON.parse(init.body as string);
    bodies.push({ ...body, name: body.response_format?.json_schema?.name });
    const list = replies[body.response_format?.json_schema?.name] ?? [];
    const reply = list.length > 1 ? list.shift() : list[0];
    return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, bodies };
}

async function withModel() {
  const m = model({
    talk_card: [CARD],
    understanding_draft: [DRAFT],
    understanding_judge: [JUDGED],
    talk_cues: [CUES],
    writing_check: [SPOKEN],
    talk_check: [TURNS],
  });
  // The first of each draw: a monologue first, a conversation's genre.
  const api = await setup({ fetch: m.fetch, random: () => 0 });
  await api.send("PUT", "/api/llm/providers/custom", { baseUrl: "http://127.0.0.1:9/v1" });
  await api.send("PUT", "/api/llm/route", { provider: "custom", model: "m" });
  return { ...api, bodies: m.bodies };
}

const names = (bodies: Array<{ name: string }>) => bodies.map((b) => b.name);

test("speaking: a monologue card, said and checked as said aloud; then a role-play drafted, hinted, said line by line and checked; across the lesson's runs; the prompt", async () => {
  const { send, sendJson, getJson, bodies } = await withModel();
  const state = () => getJson(`/api/llm/talk?lessonKey=${LESSON}`);
  expect(await state()).toEqual({
    task: null,
    attempts: [],
    preparing: false,
    checking: false,
    step: null,
  });
  // The request that sets a card, before there is a task.
  const prompt = await sendJson("POST", "/api/llm/talk/prompt", IDS);
  expect(prompt.body.response_format.json_schema.name).toBe("talk_card");

  // A task belongs to a run of the lesson.
  const early = await send("POST", "/api/llm/talk", IDS);
  expect([early.status, ((await early.json()) as { error: string }).error]).toEqual([
    409,
    "no_lesson_run",
  ]);
  const run = (await sendJson("POST", "/api/runs", START)).run.id;

  // The card: the model's, its kind and time the app's (A1: half a minute).
  const card = await sendJson("POST", "/api/llm/talk", IDS);
  expect(card.result).toEqual({ kind: "monologue", ...CARD, seconds: 30 });
  expect(card.runId).toBe(run);
  const asked = bodies.at(-1) as (typeof bodies)[number];
  expect(asked.messages[1]?.content).toContain("Time to speak: about 30 seconds (about 60 words).");

  // Said: checked as a writing check, said aloud — no greeting asked, the recogniser's way forgiven.
  const said = [{ n: 0, text: "Ich heisse Anna. Ich komme aus Spanien." }];
  const stray = await send("POST", "/api/llm/talk/check", {
    ...IDS,
    taskId: "01HZY0000000000000000000AA",
    said,
  });
  expect(stray.status).toBe(404);
  const spoken = await sendJson("POST", "/api/llm/talk/check", { ...IDS, taskId: card.id, said });
  expect(spoken.input).toBe("Ich heisse Anna. Ich komme aus Spanien.");
  expect(spoken.result.task).toEqual(card.result);
  expect(spoken.result.check.points.map((p: { score: number }) => p.score)).toEqual([2, 2, 0]);
  const checked = bodies.at(-1) as (typeof bodies)[number];
  expect(checked.name).toBe("writing_check");
  expect(checked.messages[1]?.content).toContain("said aloud and heard by a speech recogniser");
  expect(checked.messages[1]?.content).toContain("Content points:\n1. Name?");

  // The next task, the kinds taking turns: a role-play — a conversation drafted three times and
  // rated, its learner's lines given hints; the learner the second person.
  bodies.length = 0;
  const play = await sendJson("POST", "/api/llm/talk", IDS);
  expect(names(bodies).sort()).toEqual([
    "talk_cues",
    "understanding_draft",
    "understanding_draft",
    "understanding_draft",
    "understanding_judge",
  ]);
  expect(bodies.find((b) => b.name === "understanding_draft")?.messages[1]?.content).toContain(
    'The learner will play the second person in "people" by voice',
  );
  expect(play.result).toMatchObject({
    kind: "roleplay",
    genre: "conversation",
    setting: "В кафе",
    situation: "Гость заказывает кофе.",
    role: "гость",
    learner: "Gast",
    partner: { name: "Herr Brandt", gender: "m", age: "senior" },
    cues: CUES.cues,
  });
  expect(play.result.lines).toHaveLength(5);
  expect(play.result.lines[1]).toEqual({ speaker: "Gast", text: "Einen Kaffee, bitte." });
  expect(bodies.find((b) => b.name === "talk_cues")?.messages[1]?.content).toContain(
    'The learner plays "Gast": lines 1, 3.',
  );

  // Said line by line, checked once: each learner line beside its hint and a good line.
  const lines = [
    { n: 1, text: "Ein Kaffee, bitte." },
    { n: 3, text: "Ja, danke." },
  ];
  const played = await sendJson("POST", "/api/llm/talk/check", {
    ...IDS,
    taskId: play.id,
    said: lines,
  });
  const sent = (bodies.at(-1) as (typeof bodies)[number]).messages[1]?.content;
  expect(sent).toContain(
    "1. LEARNER (hint: Закажите кофе.; a good line: Einen Kaffee, bitte.): Ein Kaffee, bitte.",
  );
  expect(sent).toContain("0. Herr Brandt: Guten Tag! Was möchten Sie heute trinken?");
  // A correction changing nothing dropped.
  expect(played.result.check.turns[0].corrections).toHaveLength(1);
  expect(played.result.check.turns.map((t: { fits: boolean }) => t.fits)).toEqual([true, false]);

  // A new run of the lesson: the tasks and attempts read across its runs, newest first.
  await sendJson("POST", "/api/runs", { ...START, restart: true });
  const after = await state();
  expect(after.task.id).toBe(play.id);
  expect(after.attempts.map((a: { id: string }) => a.id)).toEqual([played.id, spoken.id]);
});
