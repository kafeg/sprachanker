import { expect, test } from "bun:test";
import { fixture } from "@sprachanker/course-fixture";
import { checkSpeakingTask } from "../src/tasks/check-speaking.ts";
import { cleanCheck, quotes, unlistedChange } from "../src/tasks/corrections.ts";
import { mistakeLine } from "../src/tasks/describe.ts";
import { GENDER_FREE, languagesLine, NEUTRAL } from "../src/tasks/rules.ts";

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
  // The notes' forms, each right form at once, nothing made up.
  expect(system).toContain("the case after a preposition, an ending) as the notes give them");
  expect(system).toContain("never write a correction and correct it again");
  expect(system).toContain("nor circumstances of the learner");
  expect(system).toEndWith(
    `Reply with the JSON object only.\nWrite only in Russian and German: not a word in any other language.\n${GENDER_FREE.ru}`,
  );
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

test("a correction quoting the text in pieces, a compound, a number as the recogniser wrote it or a word left out is kept; one quoting words the text lacks goes", () => {
  const said = "ich habe gestern um 3 uhr fahrradfahren gegangen dann stehe ich früh auf";
  const fix = (wrong: string) => ({ wrong, right: "x", explanation: "" });
  const kept = cleanCheck(
    {
      verdict: "minor_errors",
      corrected: "c",
      corrections: [
        fix("habe … gegangen"),
        fix("stehe...auf"),
        fix("drei Uhr"),
        fix("Fahrrad fahren"),
        fix(""),
        // In the wrong order, or words not said.
        fix("gegangen … habe"),
        fix("um 4 Uhr"),
        fix("bin gegangen"),
      ],
      feedback: "",
    },
    said,
  );
  expect(kept.corrections.map((c) => c.wrong)).toEqual([
    "habe … gegangen",
    "stehe...auf",
    "drei Uhr",
    "Fahrrad fahren",
    "",
  ]);
  // Digits in the correction, the number said as a word.
  expect(quotes("um drei uhr", "um 3 Uhr")).toBe(true);
});

test("a spoken answer's corrected text makes only the changes its corrections list: a word spelled anew is asked again once", () => {
  const heard = "ich lasse meine haare beim friseur um 3 uhr schneiden";
  const check = (corrected: string, corrections: Array<{ wrong: string; right: string }> = []) =>
    checkSpeakingTask({ ...input, transcript: heard }).quality?.({
      verdict: corrections.length ? "minor_errors" : "good",
      corrected,
      corrections: corrections.map((c) => ({ ...c, explanation: "" })),
      feedback: "",
    });
  expect(check("Ich lasse meine Haare beim Friisör um drei Uhr schneiden.")).toContain("friisör");
  // A correction's words, a number said as a word, case and punctuation: no change of its own.
  expect(
    check("Ich lasse mir die Haare beim Friseur um drei Uhr schneiden.", [
      { wrong: "meine", right: "mir die" },
    ]),
  ).toBeUndefined();
  expect(unlistedChange({ corrected: "", corrections: [] }, heard)).toBeUndefined();
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

test("check_speaking: no question heard — the content cannot be checked, only the form", () => {
  const { request } = checkSpeakingTask({ ...input, question: undefined, sample: undefined });
  const [system, user] = request.messages.map((m) => String(m.content));
  expect(user).toContain("No question was heard");
  expect(system).toContain("the content cannot be checked");
  expect(system).toContain("never invent facts");
  expect(system).toContain("What is correct is never corrected");
  const heard = String(checkSpeakingTask(input).request.messages[1]?.content);
  expect(heard).not.toContain("No question was heard");
});

test("a good answer's corrected text is the learner's words: a right form is never rewritten", () => {
  // From a real check: "meine Haare schneiden lassen" is right; the model still wrote "mir die Haare".
  const said = "ich lasse meine haare beim friseur schneiden";
  const rewritten = cleanCheck(
    {
      verdict: "good",
      corrected: "Ich lasse mir die Haare beim Friseur schneiden.",
      corrections: [],
      feedback: "",
    },
    said,
  );
  expect(rewritten.corrected).toBe(said);
  // Case and punctuation set by the model are kept: the words are the learner's.
  const tidied = cleanCheck(
    {
      verdict: "good",
      corrected: "Ich hätte gerne ein Einzelzimmer.",
      corrections: [],
      feedback: "",
    },
    "ich hätte gerne ein einzelzimmer",
  );
  expect(tidied.corrected).toBe("Ich hätte gerne ein Einzelzimmer.");
  // With errors the correction stands.
  const fixed = cleanCheck(
    {
      verdict: "minor_errors",
      corrected: "Ich bleibe zwei Nächte.",
      corrections: [{ wrong: "zwei Nacht", right: "zwei Nächte", explanation: "" }],
      feedback: "",
    },
    "ich bleibe zwei nacht",
  );
  expect(fixed.corrected).toBe("Ich bleibe zwei Nächte.");
});

test("every task's reply stays in its two languages (one when they are the same)", () => {
  expect(languagesLine("ru", "de")).toBe(
    "Write only in Russian and German: not a word in any other language.",
  );
  expect(languagesLine("de", "de")).toBe("Write only in German: not a word in any other language.");
  const own = checkSpeakingTask({ ...input, rules: "Be strict." }).request.messages[0]?.content;
  // How the learner's language keeps their gender unmarked holds under their own rules too.
  expect(own).toEndWith(`${languagesLine("ru", "de")}\n${GENDER_FREE.ru}`);
  const english = checkSpeakingTask({ ...input, language: "en" }).request.messages[0]?.content;
  expect(english).toEndWith(languagesLine("en", "de"));
});

test("a learner's language that marks gender gets its own line on how to avoid it: Russian's past forms, no forms side by side", () => {
  expect(GENDER_FREE.ru).toContain("ты нашёл");
  expect(GENDER_FREE.ru).toContain("у тебя получилось");
  expect(GENDER_FREE.ru).toContain("смог(ла)");
  for (const lang of ["uk", "pl", "bs", "fr", "es", "pt", "ro", "el", "ar", "hi"] as const)
    expect(GENDER_FREE[lang]).toBeString();
  expect(GENDER_FREE.en).toBeUndefined();
  expect(GENDER_FREE.de).toBeUndefined();
  expect(NEUTRAL).toContain('never both forms side by side ("a(b)", "a/b")');
});
