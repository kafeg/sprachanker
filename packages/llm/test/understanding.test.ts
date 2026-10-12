// Understanding's tasks (07): a text with its questions from what the learner knows, its length by
// the level; a second reading that answers them from the text alone; the questions it does not
// settle as the key does left out.
import { expect, test } from "bun:test";
import type { UnderstandingText } from "@sprachanker/schema";
import type { LlmClient } from "../src/client.ts";
import { runStructured, structuredRequest } from "../src/structured.ts";
import {
  settledQuestions,
  textLength,
  understandingCheckTask,
  understandingProblem,
  understandingTextRules,
  understandingTextTask,
} from "../src/tasks/understanding.ts";
import { PLACEHOLDER_NAMES } from "../src/text.ts";

const TEXT: UnderstandingText = {
  kind: "dialogue",
  title: "В пекарне",
  situation: "Анна покупает булочки.",
  lines: [
    { speaker: "Anna", text: "Guten Morgen! Zwei Brötchen, bitte." },
    { speaker: "Verkäufer", text: "Gern. Das macht 1,20 Euro." },
  ],
  glossary: [{ word: "Brötchen", translation: "булочка" }],
  questions: [
    {
      phase: "listening",
      question: "Anna möchte drei Brötchen.",
      options: ["Richtig", "Falsch"],
      answer: 1,
    },
    { phase: "listening", question: "Wie viel kostet das?", accepted: ["1,20", "1,20 Euro"] },
    {
      phase: "listening",
      question: "Wann ist das?",
      options: ["am Morgen", "am Abend", "in der Nacht"],
      answer: 0,
    },
    {
      phase: "reading",
      question: "Wer verkauft?",
      options: ["Anna", "der Verkäufer", "niemand"],
      answer: 1,
    },
  ],
};

/** A model answering with `replies` in order; what it was sent is kept. */
const scripted = (replies: unknown[]) => {
  const sent: string[] = [];
  const client: LlmClient = {
    models: async () => [],
    chat: () => (async function* () {})(),
    complete: async (request) => {
      sent.push(String(request.messages.at(-1)?.content));
      return JSON.stringify(replies.shift());
    },
  };
  return { client, sent };
};

const LESSON = {
  title: "Beim Bäcker",
  goals: ["Einkaufen"],
  vocab: [{ target: "das Brötchen", translation: "булочка" }],
  level: "A2",
  place: { n: 5, of: 40 },
  knownWords: [{ target: "der Morgen", translation: "утро" }],
  topics: [{ title: "Zahlen", lesson: "1.1" }],
  grammarHtml: ["<h2>Perfekt</h2><p>Ich habe gekauft.</p>"],
  characters: ["Nico", "Lisa"],
};

test("the text's length follows the level: the first of a span, a beginner's without one", () => {
  expect(textLength("A1")).toEqual([40, 70]);
  expect(textLength("A2")).toEqual([80, 120]);
  expect(textLength("B1")).toEqual([150, 200]);
  expect(textLength("A1–A2")).toEqual([40, 70]);
  expect(textLength(undefined)).toEqual([40, 70]);
});

test("understanding_text: what the learner knows and how long, with the language's own line in the data; the rules name no level or language", () => {
  const task = understandingTextTask({ language: "ru", target: "de", lesson: LESSON });
  const request = structuredRequest(task);
  expect(request.jsonSchema?.name).toBe("understanding_text");
  const [system, data] = request.messages.map((m) => String(m.content));
  expect(data).toContain("Learner's level: A2");
  expect(data).toContain("Place in the course: lesson 5 of 40");
  expect(data).toContain("Goals: Einkaufen");
  expect(data).toContain("das Brötchen (булочка)");
  expect(data).toContain("der Morgen (утро)");
  expect(data).toContain("Grammar met so far: Zahlen");
  expect(data).toContain("about 80–120 words");
  expect(data).toContain('"Richtig" and "Falsch"');
  // The lesson's grammar, used twice from A2 on; the course's people, none of them in the text.
  expect(data).toContain("This lesson's grammar:\nPerfekt\nIch habe gekauft.");
  expect(data).toContain("Use this lesson's grammar at least 2 times in the text.");
  expect(data).toContain("The course's characters: Nico, Lisa");
  const a1 = understandingTextTask({
    language: "ru",
    target: "de",
    lesson: { ...LESSON, level: "A1" },
  });
  expect(String(a1.request.messages[1]?.content)).not.toContain("at least 2 times");
  const template = understandingTextRules("ru", "de", PLACEHOLDER_NAMES);
  expect(template).not.toMatch(/A1|A2|German|Russian|Richtig/);
  for (const rule of [
    "never a word a question asks about, never one the learner knows",
    "never a character of the course",
    "in {language}, never in {target}",
    "options in the question's language",
    "Only a number, a price or a time is typed",
  ])
    expect(template).toContain(rule);
  expect(system).toContain('"phase": "listening"');
  expect(system).toContain("Reply with the JSON object only.");
});

test("understanding_text: a question without its answer, or a dialogue of three, is repaired once", async () => {
  const task = understandingTextTask({ language: "ru", target: "de", lesson: LESSON });
  const broken = {
    ...TEXT,
    questions: TEXT.questions.map((q, i) => (i === 0 ? { ...q, answer: 5 } : q)),
  };
  const model = scripted([broken, TEXT]);
  expect(await runStructured(model.client, "m", task)).toEqual(TEXT);
  expect(model.sent[1]).toContain("the index of one of its options");

  const three = {
    ...TEXT,
    lines: [...TEXT.lines, { speaker: "Max", text: "Und ich?" }],
  };
  const again = scripted([three, TEXT]);
  await runStructured(again.client, "m", task);
  expect(again.sent[1]).toContain("two speakers at most");
});

test("understandingProblem: a course character in the text, a title in the learnt language, a question's options in the learner's — asked again once", async () => {
  const input = { language: "ru", target: "de", lesson: LESSON } as const;
  expect(understandingProblem(TEXT, input)).toBeUndefined();
  const nico = { ...TEXT, lines: [{ speaker: "Nico", text: "Hallo!" }, ...TEXT.lines.slice(1)] };
  expect(understandingProblem(nico, input)).toBe(
    "the people are new, none of the course's characters (Nico)",
  );
  const named = { ...TEXT, lines: [...TEXT.lines, { speaker: "Anna", text: "Und Lisa?" }] };
  expect(understandingProblem(named, input)).toContain("(Lisa)");
  // Names as whole words, a name of several words as a whole: a role or a longer word is no name.
  const people = { ...LESSON, characters: ["Nico", "Lisa", "Frau Berg"] };
  const ordinary = {
    ...TEXT,
    lines: [
      { speaker: "Frau Weber", text: "Guten Tag! Alle Brötchen sind frisch, sagt der Mann." },
      { speaker: "Verkäufer", text: "Lisas Brötchen? Nicola kommt. Herr Berg auch." },
    ],
  };
  expect(understandingProblem(ordinary, { ...input, lesson: people })).toBeUndefined();
  const berg = {
    ...TEXT,
    lines: [...TEXT.lines, { speaker: "Anna", text: "Guten Tag, Frau  Berg!" }],
  };
  expect(understandingProblem(berg, { ...input, lesson: people })).toContain("(Frau Berg)");
  const german = { ...TEXT, title: "Beim Bäcker", situation: "Anna kauft Brötchen." };
  expect(understandingProblem(german, input)).toBe('"title" and "situation" in Russian');
  const mixed = {
    ...TEXT,
    questions: TEXT.questions.map((q, i) =>
      i === 2 ? { ...q, options: ["утром", "вечером", "ночью"] } : q,
    ),
  };
  expect(understandingProblem(mixed, input)).toBe("a question in German has its options in German");
  // Languages written alike are not told apart: no check.
  expect(understandingProblem(german, { ...input, language: "en" })).toBeUndefined();
  // The task's check: repaired once.
  const model = scripted([german, TEXT]);
  await runStructured(model.client, "m", understandingTextTask(input));
  expect(model.sent[1]).toContain('"title" and "situation" in Russian');
});

test("understanding_check: the text with its speakers and the questions without their answers", () => {
  const request = structuredRequest(
    understandingCheckTask({ language: "ru", target: "de", text: TEXT }),
  );
  expect(request.jsonSchema?.name).toBe("understanding_check");
  const data = String(request.messages[1]?.content);
  expect(data).toContain("Verkäufer: Gern. Das macht 1,20 Euro.");
  expect(data).toContain("1. Anna möchte drei Brötchen.\n   a) Richtig\n   b) Falsch");
  expect(data).toContain("2. Wie viel kostet das?\n   (answer typed)");
  expect(data).not.toContain("1,20 Euro\n");
  expect(data).not.toContain('"answer"');
});

test("settledQuestions: one answered otherwise, ambiguous or left out is dropped; an answer typed checked as the learner's", () => {
  const typed: string[] = [];
  const kept = settledQuestions(
    TEXT,
    {
      answers: [
        { n: 1, choice: "B", ambiguous: false },
        { n: 2, answer: "1,20 €", ambiguous: false },
        { n: 3, choice: "a", ambiguous: true },
        // Question 4 not answered.
      ],
    },
    (q, answer) => {
      typed.push(answer);
      return q.accepted?.some((a) => answer.startsWith(a)) ?? false;
    },
  );
  expect(kept.questions.map((q) => q.question)).toEqual([
    "Anna möchte drei Brötchen.",
    "Wie viel kostet das?",
  ]);
  expect(typed).toEqual(["1,20 €"]);
  const wrong = settledQuestions(
    TEXT,
    { answers: [{ n: 1, choice: "a", ambiguous: false }] },
    () => true,
  );
  expect(wrong.questions).toEqual([]);
  // Typed only a number, a price or a time: one typed otherwise is left out, however answered.
  const word = {
    ...TEXT,
    questions: [{ phase: "reading" as const, question: "Wer verkauft?", accepted: ["Verkäufer"] }],
  };
  const none = settledQuestions(
    word,
    { answers: [{ n: 1, answer: "Verkäufer", ambiguous: false }] },
    () => true,
  );
  expect(none.questions).toEqual([]);
});
