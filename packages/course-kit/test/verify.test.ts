import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLibrary } from "../src/library.ts";
import { verifyLibrary } from "../src/verify.ts";
import { MINI_LESSON, writeMiniLibrary } from "./mini-library.ts";

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-verify-"));
  await writeMiniLibrary(root);
  return root;
}

test("a clean course verifies clean, with its counts", async () => {
  const [report] = await verifyLibrary(openLibrary(await fixture()));
  expect(report?.problems).toEqual([]);
  expect(report?.editions).toEqual(["en-de", "ru-de"]);
  expect(report?.lessons).toBe(1);
  expect(report?.exams).toBe(1);
  expect(report?.exercises.single_choice).toBe(1);
  // The exercise's item and the exam's three questions.
  expect(report?.items).toBe(4);
  expect(report?.media.referenced).toBe(2);
  expect(report?.media.missing).toBe(0);
});

test("an exam that does not hold together is reported", async () => {
  const root = await fixture();
  const examFile = join(root, "sprachanker.mini/canonical/basic/exams/quiz.json");
  const exam = JSON.parse(readFileSync(examFile, "utf8"));
  exam.items[1].answer.optionIds = ["zz"];
  exam.sections[0].pool.push(`${exam.key}/q-404`);
  exam.sections[1].draw = 2;
  exam.thresholds[0].minPoints = 9;
  writeFileSync(examFile, JSON.stringify(exam));
  rmSync(join(root, "sprachanker.mini/media/image/frage.png"));
  const localeFile = join(root, "sprachanker.mini/locale/en-de/basic/exams/quiz.json");
  const locale = JSON.parse(readFileSync(localeFile, "utf8"));
  locale.sections = {};
  writeFileSync(localeFile, JSON.stringify(locale));
  rmSync(join(root, "sprachanker.mini/locale/ru-de/basic/exams/quiz.json"));

  const [report] = await verifyLibrary(openLibrary(root));
  const problems = report?.problems.map((p) => p.text) ?? [];
  const quiz = "sprachanker.mini/basic/exam-quiz";
  expect(problems).toEqual(
    expect.arrayContaining([
      `${quiz}/q-002: answer names option "zz" it does not have`,
      `${quiz}/s-general: pool names ${quiz}/q-404, not a question of the exam`,
      `${quiz}/s-state: draws 2 of 1 questions (be)`,
      `${quiz}: pass mark pass is 9 of 2 points`,
      "media/image/frage.png: missing media",
      `en-de ${quiz}: no title for ${quiz}/s-general`,
      `ru-de ${quiz}: no locale file`,
    ]),
  );
});

test("an exam's modules, examples and pass marks over modules are checked", async () => {
  const root = await fixture();
  const examFile = join(root, "sprachanker.mini/canonical/basic/exams/quiz.json");
  const exam = JSON.parse(readFileSync(examFile, "utf8"));
  const quiz = "sprachanker.mini/basic/exam-quiz";
  exam.modules = [{ id: "hoeren", timeLimitSec: 60, scaleTo: 25 }];
  exam.sections[0].module = "hoeren";
  exam.sections[1].module = "lesen";
  exam.sections[0].examples = [exam.sections[0].pool[0]];
  exam.thresholds = [{ id: "pass", minPoints: 30, modules: ["hoeren", "sprechen"] }];
  writeFileSync(examFile, JSON.stringify(exam));
  const [report] = await verifyLibrary(openLibrary(root));
  const problems = report?.problems.map((p) => p.text) ?? [];
  expect(problems).toEqual(
    expect.arrayContaining([
      `${quiz}: time ${exam.timeLimitSec} s, its modules' 60 s`,
      `${quiz}/s-state: module lesen is not the exam's`,
      `${quiz}/s-general: example ${exam.sections[0].pool[0]} is no question of its own`,
      `${quiz}: pass mark pass names module sprechen`,
      `${quiz}: pass mark pass is 30 of 25 points`,
      `en-de ${quiz}: no title for module hoeren`,
    ]),
  );
});

test("broken data is reported: a wrong answer id, a missing medium, a stray locale exercise", async () => {
  const root = await fixture();
  const lessonFile = join(root, "sprachanker.mini/canonical/basic/lessons/00-01.json");
  const lesson = JSON.parse(readFileSync(lessonFile, "utf8"));
  const choice = lesson.pages.find(
    (p: { exercise: { type: string } }) => p.exercise.type === "single_choice",
  ).exercise;
  choice.items[0].answer.optionIds = ["zz"];
  writeFileSync(lessonFile, JSON.stringify(lesson));
  rmSync(join(root, "sprachanker.mini/media/audio/hallo.mp3"));
  const localeFile = join(root, "sprachanker.mini/locale/ru-de/basic/lessons/00-01.json");
  const locale = JSON.parse(readFileSync(localeFile, "utf8"));
  locale.exercises[`${MINI_LESSON}/ex-99`] = { sourceId: "x", items: {} };
  writeFileSync(localeFile, JSON.stringify(locale));

  const [report] = await verifyLibrary(openLibrary(root));
  const problems = report?.problems.map((p) => p.text).join("\n") ?? "";
  expect(problems).toContain('answer names option "zz"');
  expect(problems).toContain("fingerprint does not match");
  expect(problems).toContain("media/audio/hallo.mp3: missing media");
  expect(report?.problems.find((p) => p.at === "media/audio/hallo.mp3")?.kind).toBe("missingMedia");
  expect(problems).toContain("ex-99: locale texts for an exercise the lesson does not have");
});

test("a lesson whose exercise key is met twice does not read: verify says so", async () => {
  const root = await fixture();
  const lessonFile = join(root, "sprachanker.mini/canonical/basic/lessons/00-01.json");
  const lesson = JSON.parse(readFileSync(lessonFile, "utf8"));
  const page = lesson.pages[0];
  // A numbering that gave two tasks one number.
  lesson.pages.push(page);
  writeFileSync(lessonFile, JSON.stringify(lesson));
  const [report] = await verifyLibrary(openLibrary(root));
  expect(report?.problems.map((p) => p.text).join("\n")).toContain(
    `exercise key ${page.exercise.key} met twice`,
  );
});
