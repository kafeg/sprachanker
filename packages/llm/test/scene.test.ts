// The Dialogue's tasks (07): a setup with an information gap, a line judged (understood, fits, at
// most two corrections of that line), a summary with model lines.
import { expect, test } from "bun:test";
import type { LlmClient } from "../src/client.ts";
import { runStructured } from "../src/structured.ts";
import {
  cleanSceneSummary,
  cleanSceneTurn,
  type SceneTurn,
  sceneSetupTask,
  sceneSummaryTask,
  sceneTurnRequest,
} from "../src/tasks/scene.ts";

const turn = (extra: Partial<SceneTurn>): SceneTurn => ({
  reply: "Woher kommst du?",
  translation: "Откуда ты?",
  understood: true,
  fits: true,
  corrections: [],
  goalsMet: [],
  done: false,
  ...extra,
});

const SETUP = {
  title: "Am Bahnhof",
  situation: "Вы на вокзале.",
  partner: "Кассир",
  goals: ["Узнать, когда идёт поезд", "Узнать цену"],
  opening: "Guten Tag! Wohin möchten Sie?",
  partnerInfo: ["Der Zug nach Berlin fährt um 14:30.", "Das Ticket kostet 29 Euro."],
};

/** A model answering with `replies` in order. */
const scripted = (replies: unknown[]): LlmClient => ({
  models: async () => [],
  chat: () => (async function* () {})(),
  complete: async () => JSON.stringify(replies.shift()),
});

test("cleanSceneTurn: only corrections of the new line, at most two; goals accumulate, done when all met", () => {
  const cleaned = cleanSceneTurn(
    turn({
      corrections: [
        { wrong: "Ich bin heissen", right: "Ich heiße", explanation: "old line" },
        { wrong: "er heisst", right: "er heißt", explanation: "new" },
        { wrong: "Max", right: "Max", explanation: "no-op" },
        // Capitals alone are no error (a spoken line's are the recogniser's).
        { wrong: "max.", right: "Max.", explanation: "case" },
        { wrong: "heisst max", right: "heißt Max", explanation: "second" },
        { wrong: "das ist", right: "dies ist", explanation: "third: one too many" },
      ],
      goalsMet: [1, 7],
    }),
    "Das ist Max, er  heisst max.",
    2,
    [0],
  );
  expect(cleaned.corrections.map((c) => c.explanation)).toEqual(["new", "second"]);
  expect(cleaned.goalsMet).toEqual([0, 1]);
  expect(cleaned.done).toBe(true);
  expect([cleaned.understood, cleaned.fits]).toEqual([true, true]);
});

test("sceneTurnRequest: user first, the opening kept, the partner's facts in the scene, a spoken line marked", () => {
  const base = {
    language: "ru",
    target: "de",
    lesson: { title: "L", goals: [], vocab: [] },
    setup: SETUP,
    message: "wann fährt der zug nach berlin",
  };
  const fresh = sceneTurnRequest({
    ...base,
    history: [{ role: "assistant", text: SETUP.opening }],
    spoken: true,
  });
  expect(fresh.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
  expect(fresh.messages.at(-1)?.content).toBe("<line said>wann fährt der zug nach berlin</line>");
  const system = String(fresh.messages[0]?.content);
  expect(system).toContain("0. Узнать, когда идёт поезд; 1. Узнать цену");
  expect(system).toContain(
    "You know: Der Zug nach Berlin fährt um 14:30. Das Ticket kostet 29 Euro.",
  );
  // Recognised speech is taken as a listener would understand it (owner, 2026-10-11).
  expect(system).toContain("never errors");
  expect(system).toContain('"understood"');
  // Typed (no microphone): a plain line; a scene from before the Dialogue has no facts.
  const typed = sceneTurnRequest({
    ...base,
    setup: { ...SETUP, partnerInfo: undefined },
    history: [{ role: "assistant", text: SETUP.opening }],
  });
  expect(typed.messages.at(-1)?.content).toBe("<line>wann fährt der zug nach berlin</line>");
  expect(String(typed.messages[0]?.content)).not.toContain("You know:");
});

test("sceneSetupTask: the level and place with the data; of many earlier words the most recent are kept", () => {
  const knownWords = Array.from({ length: 2000 }, (_, i) => ({ target: `wort${i}` }));
  const task = sceneSetupTask({
    language: "ru",
    target: "de",
    lesson: {
      title: "Im Café",
      goals: [],
      vocab: [],
      level: "A2",
      place: { n: 3, of: 30 },
      knownWords,
      topics: ["Modalverben"],
    },
  });
  const [system, data] = task.request.messages.map((m) => String(m.content));
  expect(data).toContain("wort1999");
  expect(data).not.toContain("wort0;");
  expect(data).toContain("Learner's level: A2");
  expect(data).toContain("Place in the course: lesson 3 of 30");
  expect(data).toContain("Grammar met so far: Modalverben");
  expect(system).not.toContain("A1");
  expect(system).toContain("information gap");
});

test("sceneSetupTask: a setup without the partner's facts is repaired once", async () => {
  const task = sceneSetupTask({
    language: "ru",
    target: "de",
    lesson: { title: "Am Bahnhof", goals: [], vocab: [] },
  });
  const { partnerInfo: _, ...withoutFacts } = SETUP;
  const setup = await runStructured(scripted([withoutFacts, SETUP]), "m", task);
  expect(setup.partnerInfo).toEqual(SETUP.partnerInfo);
});

test("sceneSummaryTask: the goals reached, the lines with their corrections; cleaned to two corrections of the learner's lines, each with a model line", () => {
  const task = sceneSummaryTask({
    language: "ru",
    target: "de",
    lesson: { title: "Am Bahnhof", goals: [], vocab: [], level: "A1" },
    setup: SETUP,
    goalsMet: [0],
    turns: [
      { role: "assistant", text: SETUP.opening },
      {
        role: "user",
        text: "wann fahrt der zug",
        corrections: [{ wrong: "fahrt", right: "fährt", explanation: "Umlaut." }],
      },
      { role: "assistant", text: "Um 14:30." },
    ],
  });
  expect(task.name).toBe("scene_summary");
  const data = String(task.request.messages[1]?.content);
  expect(data).toContain("Goals reached: 1 of 2 (Узнать, когда идёт поезд)");
  expect(data).toContain("Learner: wann fahrt der zug\n  (corrected: fahrt → fährt)");
  expect(data).toContain("Partner: Um 14:30.");
  expect(data).toContain("Learner's level: A1");

  const cleaned = cleanSceneSummary(
    {
      corrections: [
        { wrong: "fahrt", right: "fährt", explanation: "", model: "Wann fährt der Zug?" },
        { wrong: "not said", right: "x", explanation: "", model: "x" },
        { wrong: "wann", right: "Wann", explanation: "case", model: "Wann?" },
        { wrong: "der zug", right: "der Zug nach Berlin", explanation: "", model: "" },
        { wrong: "wann", right: "Wann genau", explanation: "", model: "Wann genau?" },
      ],
      feedback: "Gut.",
    },
    ["wann fahrt der zug"],
  );
  expect(cleaned.corrections.map((c) => [c.right, c.model])).toEqual([
    ["fährt", "Wann fährt der Zug?"],
    ["der Zug nach Berlin", "der Zug nach Berlin"],
  ]);
});
