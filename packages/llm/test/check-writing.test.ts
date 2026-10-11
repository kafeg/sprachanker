// "Write it yourself" (04, "AI practice in courses"; 07): the task — a situation with three content
// points, its length the level's — and the check of a text on it: each point rated, at most three
// corrections, a model text; the level's criteria and the target language's exam said with the data.
import { expect, test } from "bun:test";
import type { WritingCheck } from "@sprachanker/schema";
import {
  checkWritingRules,
  checkWritingTask,
  cleanWritingCheck,
  type WritingInput,
} from "../src/tasks/check-writing.ts";
import {
  type WritingTaskInput,
  writingTaskOf,
  writingTaskRules,
  writingTaskTask,
  writingWords,
} from "../src/tasks/writing-task.ts";

const lesson: WritingTaskInput["lesson"] = {
  title: "Im Café",
  goals: ["sich verabreden", "etwas über das Schulsystem erfahren"],
  grammarHtml: ["<p>Modalverben: müssen, können</p>"],
  vocab: [{ target: "die Verspätung", translation: "опоздание" }],
  level: "A1",
  place: { n: 12, of: 40 },
  knownWords: [{ target: "der Kaffee", translation: "кофе" }],
  topics: [{ title: "Modalverben", lesson: "3.2" }],
};

const TASK = {
  situation: "Вы договорились встретиться с Леной в кафе. Напишите ей сообщение.",
  points: ["Скажите, что опоздаете.", "Объясните почему.", "Напишите, когда придёте."],
  words: 30,
};

const input: WritingInput = {
  language: "ru",
  target: "de",
  lesson,
  task: TASK,
  text: "  Hallo Lena, ich komme spät. Ich muss arbeiten. Ich bin um 5 Uhr da.  ",
};

test("writing_task: a situation and three points from the lesson's goals, its length by the level, the exam's way said with the data", () => {
  const { name, request, schema } = writingTaskTask({ language: "ru", target: "de", lesson });
  expect(name).toBe("writing_task");
  const [system, user] = request.messages.map((m) => String(m.content));
  for (const part of [
    '"points": exactly three things the text must do, in Russian',
    "A goal of learning about something",
    "is no task: turn it into a situation where the learner tells, asks for or arranges something",
    "No goals given: take it from the lesson's title and its grammar.",
    "Write only in Russian and German",
    "The learner's gender is unknown",
  ])
    expect(system).toContain(part);
  // No level and no language's exam in the standing rules: they come with the data.
  expect(system).not.toContain("A1");
  expect(system).not.toContain("Goethe");
  for (const part of [
    "Goals: sich verabreden; etwas über das Schulsystem erfahren",
    "Learner's level: A1",
    "Grammar met so far: Modalverben",
    "Grammar notes of this lesson:\nModalverben: müssen, können",
    "Length of the text asked for: about 30 words.",
    "What a text at A1 needs: each point in one or two simple sentences",
    "Goethe-Zertifikat's Schreiben",
  ])
    expect(user).toContain(part);
  // The model gives the situation and exactly three points; the length is the app's.
  expect(schema.safeParse({ situation: "s", points: ["a", "b"] }).success).toBe(false);
  expect(schema.safeParse({ situation: "s", points: ["a", "b", "c"] }).success).toBe(true);
  // A lesson without goals says so; the level's length from the first of a span.
  const none = writingTaskTask({ language: "ru", target: "en", lesson: { ...lesson, goals: [] } });
  expect(String(none.request.messages[1]?.content)).toContain("Goals: none given");
  expect(String(none.request.messages[1]?.content)).not.toContain("Goethe");
  expect(writingWords("A2–B1")).toBe(40);
  expect(writingWords("B1")).toBe(80);
  expect(writingWords(undefined)).toBe(30);
  expect(writingTaskOf({ situation: "s", points: ["a", "b", "c"] }, "B1").words).toBe(80);
  // The learner's own rules replace the standing ones; the data stays delimited.
  const own = writingTaskTask({ language: "ru", target: "de", lesson, rules: "Kurz." });
  expect(String(own.request.messages[0]?.content)).toStartWith("Kurz.\nEverything inside <lesson>");
  expect(writingTaskRules("ru", "de")).toContain("You set a short writing task");
});

test("check_writing: the task's points as data, each rated; at most three corrections; a model text; the learner's language last", () => {
  const { name, request, check } = checkWritingTask(input);
  expect(name).toBe("writing_check");
  const [system, user] = request.messages.map((m) => String(m.content));
  for (const part of [
    '"points": for each content point of the task, in its order',
    "never invent a requirement",
    '"corrections": at most three, the most important first',
    '"modelText": the task done well at the learner\'s level',
    "Write only in Russian and German",
  ])
    expect(system).toContain(part);
  expect(system).not.toContain("A1");
  expect(system).toEndWith("Reply with the JSON object only.");
  expect(user).toContain(
    "<task>\nSituation: Вы договорились встретиться с Леной в кафе. Напишите ей сообщение.\nContent points:\n1. Скажите, что опоздаете.\n2. Объясните почему.\n3. Напишите, когда придёте.\nLength: about 30 words.\n</task>",
  );
  expect(user).toContain(
    "<text>\nHallo Lena, ich komme spät. Ich muss arbeiten. Ich bin um 5 Uhr da.\n</text>",
  );
  expect(user).toContain("What a text at A1 needs:");
  expect(user).toContain("Goethe-Zertifikat's Schreiben");
  expect(user).toEndWith(
    "Remember: 3 points in the task's order, at most 3 corrections; comments, explanations and feedback in Russian.",
  );
  // A point for each of the task's, or the reply is repaired.
  const reply = {
    verdict: "good",
    corrected: "x",
    corrections: [],
    criteria: {
      task: { score: 2, comment: "" },
      communication: { score: 2, comment: "" },
      accuracy: { score: 2, comment: "" },
    },
    points: [{ score: 2, comment: "" }],
    modelText: "Hallo Lena!",
    feedback: "",
  } as WritingCheck;
  expect(check?.(reply)).toContain("3 content points");
  const three = { ...reply, points: [1, 2, 3].map(() => ({ score: 2, comment: "" })) };
  expect(check?.(three)).toBeUndefined();
});

test("a check kept: corrections that change nothing dropped, at most three of the rest", () => {
  const fix = (wrong: string, right: string) => ({ wrong, right, explanation: "" });
  const kept = cleanWritingCheck(
    {
      verdict: "minor_errors",
      corrected: "",
      corrections: [fix("a", "a"), fix("b", "B"), fix("c", "C"), fix("d", "D"), fix("e", "E")],
      criteria: {
        task: { score: 2, comment: "" },
        communication: { score: 2, comment: "" },
        accuracy: { score: 1, comment: "" },
      },
      feedback: "",
    },
    " Mein Text ",
  );
  expect(kept.corrections.map((c) => c.wrong)).toEqual(["b", "c", "d"]);
  expect(kept.corrected).toBe("Mein Text");
});

test("German spelling is said with the text, so it holds under the learner's own rules too", () => {
  const own = checkWritingTask({ ...input, rules: "Be strict." }).request.messages;
  expect(String(own[0]?.content)).toStartWith("Be strict.\nEverything inside");
  expect(String(own[1]?.content)).toContain('"ss" where German writes "ß" is an error');
  // Not in the standing rules (the template the learner edits), and not for other languages.
  expect(checkWritingRules("ru", "de")).not.toContain("ß");
  const english = checkWritingTask({ ...input, target: "en" as const }).request.messages[1]
    ?.content;
  expect(String(english)).not.toContain("Spelling is");
  expect(String(english)).not.toContain("Goethe");
  expect(checkWritingRules("ru", "de")).not.toContain("Goethe");
});
