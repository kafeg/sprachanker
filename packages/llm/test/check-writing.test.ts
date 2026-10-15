// "Write it yourself": the task — a situation with three content
// points, its length the level's — and the check of a text on it: each point rated, at most three
// corrections, a model text; the level's criteria and the target language's exam said with the data.
import { expect, test } from "bun:test";
import type { WritingCheck } from "@sprachanker/schema";
import type { LlmClient } from "../src/client.ts";
import { runStructured } from "../src/structured.ts";
import {
  checkWritingRules,
  checkWritingTask,
  cleanWritingCheck,
  type WritingInput,
} from "../src/tasks/check-writing.ts";
import { GENDER_FREE } from "../src/tasks/rules.ts";
import {
  repeatedPoints,
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
  // A task that teaches keeps a command-line agent's default effort; the check, which the learner
  // waits for, thinks not.
  expect(request.effort).toBeUndefined();
  expect(checkWritingTask(input).request.effort).toBe("none");
  const [system, user] = request.messages.map((m) => String(m.content));
  for (const part of [
    '"points": exactly three things the text must do, in Russian',
    "three different things — none repeats another in other words",
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

test("writing_task: points that ask for the same thing in other words are asked again once", async () => {
  expect(repeatedPoints(TASK.points)).toBeUndefined();
  const same = [
    "Спросите, сколько стоит билет.",
    "Узнайте, сколько стоит билет на поезд.",
    "Предложите время встречи.",
  ];
  expect(repeatedPoints(same)).toBe(
    "points 1 and 2 ask for the same thing: three different things",
  );
  // Two shared words are no repeat ("ask when it opens", "ask when it closes").
  expect(
    repeatedPoints([
      "Спросите, когда открывается магазин.",
      "Спросите, когда закрывается музей.",
      "Пригласите друга.",
    ]),
  ).toBeUndefined();
  // The same friend and school, two things asked: stop words and the words all three share aside.
  expect(
    repeatedPoints([
      "Tell your friend about your school.",
      "Ask your friend about their school.",
      "Invite your friend to your school party.",
    ]),
  ).toBeUndefined();
  expect(
    repeatedPoints([
      "Tell your friend about your school.",
      "Ask your friend about their school.",
      "Suggest a day to meet.",
    ]),
  ).toBeUndefined();
  const sent: string[] = [];
  const replies = [
    { situation: "s", points: same },
    { situation: "s", points: TASK.points },
  ];
  const client: LlmClient = {
    models: async () => [],
    chat: () => (async function* () {})(),
    complete: async (request) => {
      sent.push(String(request.messages.at(-1)?.content));
      return JSON.stringify(replies.shift());
    },
  };
  const task = await runStructured(
    client,
    "m",
    writingTaskTask({ language: "ru", target: "de", lesson }),
  );
  expect(task.points).toEqual(TASK.points);
  expect(sent[1]).toContain("points 1 and 2 ask for the same thing");
});

test("check_writing: the task's points as data, each rated; at most three corrections; a model text; the learner's language last", () => {
  const { name, request, check } = checkWritingTask(input);
  expect(name).toBe("writing_check");
  const [system, user] = request.messages.map((m) => String(m.content));
  for (const part of [
    '"points": for each content point of the task, in its order',
    // Points rate the content; language is rated in accuracy.
    "its content only: a point done with errors in its words is done",
    // "corrected" makes the corrections only, nothing right changed ("angefangen" → "begann").
    "the corrections made and nothing else changed",
    "everything correct kept as written",
    "never a correct form replaced by another correct one (another tense, a synonym)",
    "Read every sentence for errors",
    "never invent a requirement",
    '"corrections": every error, at most 10, the most important first',
    "the learner is shown the first 3",
    '"modelText": the task done well at the learner\'s level',
    "Write only in Russian and German",
  ])
    expect(system).toContain(part);
  expect(system).not.toContain("A1");
  expect(system).toEndWith(
    `Reply with the JSON object only.\nWrite only in Russian and German: not a word in any other language. Each word in its own language's letters: never two alphabets in one word, never a German word spelt in Russian letters.\n${GENDER_FREE.ru}`,
  );
  expect(user).toContain(
    "<task>\nSituation: Вы договорились встретиться с Леной в кафе. Напишите ей сообщение.\nContent points:\n1. Скажите, что опоздаете.\n2. Объясните почему.\n3. Напишите, когда придёте.\nLength: about 30 words.\n</task>",
  );
  expect(user).toContain(
    "<text>\nHallo Lena, ich komme spät. Ich muss arbeiten. Ich bin um 5 Uhr da.\n</text>",
  );
  expect(user).toContain("What a text at A1 needs:");
  expect(user).toContain("Goethe-Zertifikat's Schreiben");
  expect(user).toEndWith(
    'Remember: 3 points in the task\'s order; every change of "corrected" is a correction, the most important first; comments, explanations and feedback in Russian.',
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

test("a check's corrected text makes only the changes its corrections list: a word left out or added silently is asked again once (a real check)", () => {
  const text =
    "Hallo zusammen! Mein Lieblingsfach war immer Geschichte, weil ich finde Geschichte sehr spannend. Wenn ich mehr Zeit hätte, ich würde Physik nochmal lernen. Ihr solltet mit euren Lehrern sprechen, wenn ihr ein Problem habt. Viele Grüße, Anna";
  const fix = (wrong: string, right: string) => ({ wrong, right, explanation: "…" });
  const corrections = [
    fix("weil ich finde Geschichte sehr spannend", "weil ich Geschichte sehr spannend finde"),
    fix("Wenn ich mehr Zeit hätte, ich würde", "Wenn ich mehr Zeit hätte, würde ich"),
    fix(
      "Ihr solltet mit euren Lehrern sprechen, wenn ihr ein Problem habt.",
      "Du solltest mit deinen Lehrern sprechen, wenn du ein Problem hast.",
    ),
  ];
  const quality = (corrected: string, listed = corrections) =>
    checkWritingTask({ ...input, text }).quality?.({
      verdict: "minor_errors",
      corrected,
      corrections: listed,
      criteria: {
        task: { score: 2, comment: "" },
        communication: { score: 2, comment: "" },
        accuracy: { score: 1, comment: "" },
      },
      points: [],
      feedback: "",
    });
  const made = (greeting: string) =>
    `${greeting} Mein Lieblingsfach war immer Geschichte, weil ich Geschichte sehr spannend finde. Wenn ich mehr Zeit hätte, würde ich Physik nochmal lernen. Du solltest mit deinen Lehrern sprechen, wenn du ein Problem hast. Viele Grüße, Anna`;
  // The model's "Hallo zusammen!" made "Hallo!" without a correction.
  expect(quality(made("Hallo!"))).toContain('"zusammen" of the text is left out');
  expect(quality(made("Hallo Tom!"))).toContain('"tom" is neither in the text');
  expect(quality(made("Hallo zusammen!"))).toBeUndefined();
  // Listed, the change is no problem.
  expect(
    quality(made("Hallo!"), [...corrections, fix("Hallo zusammen!", "Hallo!")]),
  ).toBeUndefined();
});

test("a check kept: corrections that change nothing or quote words the text lacks dropped, at most three of the rest", () => {
  const fix = (wrong: string, right: string) => ({ wrong, right, explanation: "" });
  const kept = cleanWritingCheck(
    {
      verdict: "minor_errors",
      corrected: "",
      corrections: [
        fix("a", "a"),
        // Not the learner's words (a false change of a form the text does not have, a word's part).
        fix("hat angefangen", "begann"),
        fix("Tex", "Text"),
        fix("b,", "B"),
        fix("c", "C"),
        fix("d", "D"),
        fix("e", "E"),
      ],
      criteria: {
        task: { score: 2, comment: "" },
        communication: { score: 2, comment: "" },
        accuracy: { score: 1, comment: "" },
      },
      feedback: "",
    },
    " Mein Text: a b, c d e. ",
  );
  expect(kept.corrections.map((c) => c.wrong)).toEqual(["b,", "c", "d"]);
  expect(kept.corrected).toBe("Mein Text: a b, c d e.");
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
