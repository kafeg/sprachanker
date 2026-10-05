import { expect, test } from "bun:test";
import { cleanSceneTurn, type SceneTurn, sceneTurnRequest } from "../src/tasks/scene.ts";

const turn = (extra: Partial<SceneTurn>): SceneTurn => ({
  reply: "Woher kommst du?",
  translation: "Откуда ты?",
  corrections: [],
  goalsMet: [],
  done: false,
  ...extra,
});

test("cleanSceneTurn: only corrections of the new line, goals accumulate, done when all met", () => {
  const cleaned = cleanSceneTurn(
    turn({
      corrections: [
        { wrong: "Ich bin heissen", right: "Ich heiße", explanation: "old line" },
        { wrong: "er heisst", right: "er heißt", explanation: "new" },
        { wrong: "Max", right: "Max", explanation: "no-op" },
      ],
      goalsMet: [1, 7],
    }),
    "Das ist Max, er  heisst Max.",
    2,
    [0],
  );
  expect(cleaned.corrections.map((c) => c.right)).toEqual(["er heißt"]);
  expect(cleaned.goalsMet).toEqual([0, 1]);
  expect(cleaned.done).toBe(true);
});

test("sceneTurnRequest: user first, the opening kept, the new line marked", () => {
  const setup = {
    title: "t",
    situation: "s",
    partner: "Mark",
    goals: ["a", "b"],
    opening: "Hallo! Wie heißt du?",
  };
  const base = {
    language: "ru",
    target: "de",
    lesson: { title: "L", goals: [], vocab: [] },
    knownVocab: [],
    setup,
    message: "Ich heiße Vitaly.",
  };
  const fresh = sceneTurnRequest({
    ...base,
    history: [{ role: "assistant", text: setup.opening }],
  });
  expect(fresh.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
  expect(fresh.messages.at(-1)?.content).toBe("<line>Ich heiße Vitaly.</line>");
  expect(fresh.messages[0]?.content).toContain("0. a; 1. b");
});
