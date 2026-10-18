// An exam's speaking part as a script (`exam_part`): written once from the Teil's cards — the
// examiner's lines, the partner's from their card, the learner's places with a hint and a good line —,
// then said through and rated with what was said in the learner's places.
import { expect, test } from "bun:test";
import type { ExamPart } from "@sprachanker/schema";
import {
  conversationText,
  examConversationRules,
  examPartTask,
  scriptConversation,
  scriptQuality,
} from "../src/tasks/exam-conversation.ts";

const input = {
  language: "ru" as const,
  target: "de" as const,
  exam: "Goethe-Zertifikat A2",
  part: "Teil 3",
  task: ["Finden Sie einen Termin.", "Samstag: 14–15 Uhr frei"],
  partner: "Samstag: 14–15 Uhr Schwimmen",
};

const SCRIPT: ExamPart = {
  examiner: { gender: "f" },
  partner: { name: "Jonas", gender: "m" },
  lines: [
    { speaker: "examiner", text: "Teil 3. Finden Sie einen Termin." },
    { speaker: "partner", text: "Hast du um zwei Zeit?" },
    {
      speaker: "learner",
      text: "Ja, um zwei habe ich Zeit.",
      hint: "Скажите, что в 14 вы свободны.",
    },
    { speaker: "partner", text: "Schade, da schwimme ich. Um vier?" },
    { speaker: "learner", text: "Um vier passt gut.", hint: "Согласитесь на 16 часов." },
    { speaker: "examiner", text: "Danke." },
  ],
};

test("the request: the part's task and the partner's own card; the rules: the part as the exam runs it", () => {
  const sent = examPartTask(input)
    .request.messages.map((m) => m.content)
    .join("\n");
  expect(sent).toContain("<task>\nFinden Sie einen Termin.\nSamstag: 14–15 Uhr frei\n</task>");
  expect(sent).toContain("<partner>\nSamstag: 14–15 Uhr Schwimmen\n</partner>");
  expect(examConversationRules("ru", "de")).toContain("never helping or correcting");
  expect(examConversationRules("ru", "de")).toContain("never the German words");
});

test("a script without the learner, or not opened by the examiner, is asked again; hints must be the learner's language", () => {
  const task = examPartTask(input);
  expect(task.check?.(SCRIPT)).toBeUndefined();
  expect(
    task.check?.({ ...SCRIPT, lines: SCRIPT.lines.filter((l) => l.speaker !== "learner") }),
  ).toContain("the learner speaks");
  expect(task.check?.({ ...SCRIPT, lines: SCRIPT.lines.slice(1) })).toContain("examiner opens");
  const german = {
    ...SCRIPT,
    lines: SCRIPT.lines.map((l) =>
      l.hint ? { ...l, hint: "Sagen Sie, dass Sie Zeit haben." } : l,
    ),
  };
  expect(task.quality?.(german)).toContain("hint");
});

test("said through: the script's lines with what was said in the learner's places, a place not said left out", () => {
  expect(scriptConversation(SCRIPT, ["Um zwei ich habe Zeit.", ""])).toEqual([
    { speaker: "examiner", text: "Teil 3. Finden Sie einen Termin." },
    { speaker: "partner", text: "Hast du um zwei Zeit?" },
    { speaker: "learner", text: "Um zwei ich habe Zeit." },
    { speaker: "partner", text: "Schade, da schwimme ich. Um vier?" },
    { speaker: "examiner", text: "Danke." },
  ]);
});

test("a line typed marked as typed; a part the examiner ended has no lines after the first place not said but the closing", () => {
  const typed = scriptConversation(SCRIPT, [{ text: "Um zwei ich habe Zeit.", typed: true }], true);
  expect(typed).toEqual([
    { speaker: "examiner", text: "Teil 3. Finden Sie einen Termin." },
    { speaker: "partner", text: "Hast du um zwei Zeit?" },
    { speaker: "learner", text: "Um zwei ich habe Zeit.", typed: true },
    { speaker: "partner", text: "Schade, da schwimme ich. Um vier?" },
    { speaker: "examiner", text: "Danke." },
  ]);
  expect(conversationText(typed)[2]).toBe("Learner (A) (typed): Um zwei ich habe Zeit.");
  // Nothing said before the time ran out: the opening and the closing.
  expect(scriptConversation(SCRIPT, [], true)).toEqual([
    { speaker: "examiner", text: "Teil 3. Finden Sie einen Termin." },
    { speaker: "partner", text: "Hast du um zwei Zeit?" },
    { speaker: "examiner", text: "Danke." },
  ]);
});

test("a script made better: the partner's question answered by the learner next; the learner's job without a gender's form", () => {
  expect(scriptQuality(SCRIPT, "de")).toBeUndefined();
  const unanswered = {
    ...SCRIPT,
    lines: [
      SCRIPT.lines[0],
      SCRIPT.lines[1],
      { speaker: "examiner", text: "Und Sie?" },
      ...SCRIPT.lines.slice(2),
    ],
  } as ExamPart;
  expect(scriptQuality(unanswered, "de")).toContain("answered in the learner's next line");
  const nurse = {
    ...SCRIPT,
    lines: SCRIPT.lines.map((l) =>
      l.speaker === "learner" ? { ...l, text: "Ich bin Krankenschwester in Berlin." } : l,
    ),
  } as ExamPart;
  expect(scriptQuality(nurse, "de")).toContain("without a woman's or a man's form");
  const office = {
    ...SCRIPT,
    lines: SCRIPT.lines.map((l) =>
      l.speaker === "learner" ? { ...l, text: "Ich bin in Berlin und arbeite im Krankenhaus." } : l,
    ),
  } as ExamPart;
  expect(scriptQuality(office, "de")).toBeUndefined();
});
