import { expect, test } from "bun:test";
import {
  checkWritingRules,
  checkWritingTask,
  type WritingInput,
} from "../src/tasks/check-writing.ts";

const input: WritingInput = {
  language: "ru",
  target: "de",
  lesson: {
    title: "Begrüßung",
    goals: ["sich vorstellen"],
    grammarHtml: [],
    vocab: [{ target: "heißen" }],
    level: "A1",
  },
  text: "  Ich heisse Anna. Ich komme aus Polen.  ",
};

test("check_writing: the task from the lesson's goals, the text as data, the learner's language last", () => {
  const { name, request } = checkWritingTask(input);
  expect(name).toBe("writing_check");
  const [system, user] = request.messages.map((m) => String(m.content));
  expect(system).toContain("CEFR writing exams of that level");
  expect(system).not.toContain("A1");
  expect(system).toContain("in Russian");
  expect(user).toContain("Learner's level: A1");
  expect(user).toContain("Goethe-Zertifikat's Schreiben");
  expect(system).toEndWith(
    "Reply with the JSON object only.\nWrite only in Russian and German: not a word in any other language.",
  );
  expect(user).toContain(
    "Task: Write 3–5 sentences in the target language on this lesson's topic (sich vorstellen).",
  );
  expect(user).toContain("<text>\nIch heisse Anna. Ich komme aus Polen.\n</text>");
  expect(user).toEndWith("Remember: comments, explanations and feedback in Russian.");
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
