import { expect, test } from "bun:test";
import { fixture } from "@sprachanker/course-fixture";
import { checkSpeakingTask } from "../src/tasks/check-speaking.ts";
import { cleanCheck } from "../src/tasks/corrections.ts";
import { mistakeLine } from "../src/tasks/describe.ts";

const lesson = fixture.lessons.find((l) => l.key.endsWith("/00-02"));
const exercise = lesson?.pages
  .flatMap((p) => ("exercise" in p ? [p.exercise] : []))
  .find((e) => e.type === "speech_selfrate");
if (!lesson || !exercise) throw new Error("no speaking exercise in the fixture");
const locale = fixture.locales["ru-de"]?.lessons.find((l) => l.lesson === lesson.key)?.exercises[
  exercise.key
];

const input = {
  language: "ru",
  target: "de",
  lesson: {
    title: "Begrüßung",
    goals: [],
    grammarHtml: [],
    vocab: [{ target: "Guten Tag" }],
    level: "B1",
  },
  exercise,
  locale,
  index: 1,
  question: "Wie begrüßt du deinen Nachbarn?",
  sample: "Hallo! Guten Tag!",
  transcript: "  Hallo, guten tag  ",
};

test("check_speaking: the item, the question and the source's answer as heard, then the learner's", () => {
  const { name, request } = checkSpeakingTask(input);
  expect(name).toBe("speaking_check");
  const [system, user] = request.messages.map((m) => String(m.content));
  expect(system).toContain("speech recogniser");
  expect(system).toContain("in Russian");
  expect(system).toEndWith("Reply with the JSON object only.");
  expect(system).not.toMatch(/A1|beginner/);
  expect(user).toContain("Learner's level: B1");
  expect(user).toContain("Prompt (learner's language): Поздоровайся с соседом.");
  expect(user).toContain("Question heard: Wie begrüßt du deinen Nachbarn?");
  expect(user).toContain("The source's answer, heard: Hallo! Guten Tag!");
  expect(user).toContain("<answer>\nHallo, guten tag\n</answer>");
  // The learner's own rules replace the standing ones; the delimiting line stays.
  const own = checkSpeakingTask({ ...input, rules: "Be strict." }).request.messages[0]?.content;
  expect(own).toStartWith("Be strict.\nEverything inside");
});

test("a check's no-op corrections are dropped and an empty correction filled; a spoken mistake reads its correction", () => {
  const check = cleanCheck(
    {
      verdict: "minor_errors",
      corrected: " ",
      corrections: [
        { wrong: "tag", right: "tag", explanation: "" },
        { wrong: "Hallo,", right: "Hallo!", explanation: "" },
      ],
      feedback: "",
    },
    " Hallo, guten tag ",
  );
  expect(check.corrected).toBe("Hallo, guten tag");
  expect(check.corrections).toHaveLength(1);
  const line = mistakeLine({
    exercise,
    locale,
    index: 1,
    answer: { transcript: "Tschüss" },
    corrected: "Guten Tag!",
    fixed: false,
  });
  expect(line).toContain("Answer aloud.");
  expect(line).toContain("correct: Guten Tag!; learner: Tschüss");
});

test("check_speaking: an item's question and the source's written answer (a frame) are the model's", () => {
  const framed = {
    ...exercise,
    items: [{ key: `${exercise.key}#1`, prompt: "Hast du Geschwister?", reference: ["Ja, ich …"] }],
  } as typeof exercise;
  const user = String(
    checkSpeakingTask({ ...input, exercise: framed, locale: undefined, index: 0 }).request
      .messages[1]?.content,
  );
  expect(user).toContain("Prompt: Hast du Geschwister?");
  expect(user).toContain("Answer aloud. The source's answer: Ja, ich …");
});
