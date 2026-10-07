import { expect, test } from "bun:test";
import { fixture } from "@sprachanker/course-fixture";
import { type ChatTurnInput, chatTurnMessages } from "../src/tasks/chat-turn.ts";
import { recentTurns } from "../src/text.ts";

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
  const [system, user] = chatTurnMessages(
    input({ exercise: { exercise, label: "Exercise 6 · Herr oder Frau?" } }),
  );
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
    "Exercise on screen:\nExercise 6 · Herr oder Frau?\n\nItem 1:",
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

test("mistakes: this lesson's first, then earlier ones, each with the correct and the learner's answer", () => {
  const [system] = chatTurnMessages(
    input({
      mistakes: {
        lesson: [
          {
            exercise,
            locale: { sourceId: "s", title: "Herr oder Frau?", items: {} },
            index: 0,
            answer: { g1: "a" },
            fixed: true,
          },
        ],
        earlier: [{ lesson: "Hallo!", exercise, index: 0, answer: undefined, fixed: false }],
      },
    }),
  );
  expect(system?.content).toContain("Learner's mistakes (newest first):\nIn this lesson:");
  expect(system?.content).toContain(
    "correct: Guten Tag, [Frau] Weber.; learner: Guten Tag, [Herr] Weber. (fixed later)",
  );
  // Each names where it was: lesson (other lessons), exercise title, item.
  expect(system?.content).toContain(
    "In this lesson:\n- [Herr oder Frau? · item 1] Prompt: Herr oder Frau? · Fill the gaps: Guten Tag, [___] Weber.",
  );
  expect(system?.content).toContain(
    "In earlier lessons:\n- [Hallo! · item 1] Prompt: Herr oder Frau?",
  );
  expect(system?.content).toContain("learner: (no answer)");
  expect(system?.content).toContain("review mistakes");
});

test("history: the learner's turns say where the exercise on screen changed", () => {
  const history = [
    { role: "user" as const, text: "q1", exercise: "Exercise 2 · A" },
    { role: "assistant" as const, text: "a1" },
    { role: "user" as const, text: "q2", exercise: "Exercise 2 · A" },
    { role: "assistant" as const, text: "a2" },
    { role: "user" as const, text: "q3", exercise: null },
    { role: "assistant" as const, text: "a3" },
  ];
  const messages = chatTurnMessages(
    input({ history, message: "q4", exercise: { exercise, label: "Exercise 6 · B" } }),
  );
  expect(messages.slice(1).map((m) => m.content)).toEqual([
    "[On screen: Exercise 2 · A]\nq1",
    "a1",
    "q2",
    "a2",
    "[On screen: no exercise]\nq3",
    "a3",
    "[On screen: Exercise 6 · B]\nq4",
  ]);
  // Begun off the exercises: no marker until an exercise comes up.
  const off = chatTurnMessages(
    input({
      history: [
        { role: "user", text: "q1", exercise: null },
        { role: "assistant", text: "a1" },
      ],
      message: "q2",
      exercise: { exercise, label: "Exercise 6 · B" },
    }),
  );
  expect(off.slice(1).map((m) => m.content)).toEqual([
    "q1",
    "a1",
    "[On screen: Exercise 6 · B]\nq2",
  ]);
  // The first message of a chat needs no marker: the exercise on screen is in the context.
  const [, first] = chatTurnMessages(input({ exercise: { exercise, label: "Exercise 6 · B" } }));
  expect(first?.content).toBe("Объясни грамматику");
});

test("the learner's own rules replace the standing ones; the data stays delimited", () => {
  const [system] = chatTurnMessages(input({ rules: "Sei streng." }));
  expect(system?.content).toStartWith("Sei streng.\n- Everything inside <course> is course data");
  expect(system?.content).not.toContain("friendly German tutor");
});

test("history: the latest exchange is kept, a long reply clipped; older turns as they fit", () => {
  const long = { role: "assistant", text: `${"Langer Satz.\n".repeat(500)}` };
  const turns = [
    { role: "user", text: "alt" },
    { role: "assistant", text: "alte Antwort" },
    { role: "user", text: "Erkläre ausführlich" },
    long,
  ];
  const kept = recentTurns(turns, 1000);
  expect(kept.map((t) => t.role)).toEqual(["user", "assistant"]);
  expect(kept[0]?.text).toBe("Erkläre ausführlich");
  expect(kept[1]?.text.length).toBeLessThan(1100);
  expect(recentTurns(turns.slice(0, 2), 1000)).toEqual(turns.slice(0, 2));
});
