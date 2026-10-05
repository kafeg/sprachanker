import { expect, test } from "bun:test";
import { fixture } from "@sprachanker/course-fixture";
import { type ChatTurnInput, chatTurnMessages } from "../src/tasks/chat-turn.ts";

const lesson = fixture.lessons[0];
const exercise = lesson?.pages[5]?.exercise;
if (!exercise) throw new Error("fixture exercise missing");

const input = (extra: Partial<ChatTurnInput> = {}): ChatTurnInput => ({
  language: "ru",
  target: "de",
  lesson: {
    title: "Im Café",
    goals: ["etwas bestellen"],
    grammarHtml: ["<p>Verb an Position 2</p>"],
    vocab: [{ target: "der Kaffee", translation: "кофе" }, { target: "gern" }],
  },
  knownVocab: ["hallo", "tschüss"],
  earlierLessons: ["Hallo!"],
  history: [],
  message: "Объясни грамматику",
  ...extra,
});

test("system message: rules, course context as data, exercise with answers", () => {
  const [system, user] = chatTurnMessages(input({ exercise: { exercise } }));
  expect(system?.role).toBe("system");
  expect(system?.content).toContain("Explain in Russian");
  for (const part of [
    "<course>",
    "Current lesson: Im Café",
    "Goals: etwas bestellen",
    "Earlier lessons: Hallo!",
    "Words of this lesson: der Kaffee (кофе); gern",
    "Words from earlier lessons: hallo; tschüss",
    "Grammar notes of this lesson:\nVerb an Position 2",
    "Exercise on screen:\nItem 1:",
    "Answer: Guten Tag, [Frau] Weber.",
  ]) {
    expect(system?.content).toContain(part);
  }
  expect(user).toEqual({ role: "user", content: "Объясни грамматику" });
});

test("first lesson, no exercise: no empty sections", () => {
  const [system] = chatTurnMessages(input({ earlierLessons: [], knownVocab: [] }));
  expect(system?.content).toContain("This is the first lesson.");
  expect(system?.content).not.toContain("Exercise on screen");
  expect(system?.content).not.toContain("Words from earlier lessons");
});

test("history: the most recent turns within budget, starting with a user turn", () => {
  const long = "x".repeat(1500);
  const history = [
    { role: "user" as const, text: long },
    { role: "assistant" as const, text: long },
    { role: "user" as const, text: "q2" },
    { role: "assistant" as const, text: long },
    { role: "user" as const, text: "q3" },
    { role: "assistant" as const, text: "a3" },
  ];
  const messages = chatTurnMessages(input({ history }));
  expect(messages.slice(1).map((m) => m.role)).toEqual([
    "user",
    "assistant",
    "user",
    "assistant",
    "user",
  ]);
  expect(messages[1]?.content).toBe("q2");
});

test("known vocabulary keeps the most recent words when it is too long", () => {
  const words = Array.from({ length: 2000 }, (_, i) => `wort${i}`);
  const [system] = chatTurnMessages(input({ knownVocab: words }));
  expect(system?.content).toContain("wort1999");
  expect(system?.content).not.toContain("wort0;");
  expect(system?.content).toContain("Words from earlier lessons: … ");
});
