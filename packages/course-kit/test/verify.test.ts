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
  expect(report?.exercises.single_choice).toBe(1);
  expect(report?.media.missing).toBe(0);
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
  const problems = report?.problems.join("\n") ?? "";
  expect(problems).toContain('answer names option "zz"');
  expect(problems).toContain("fingerprint does not match");
  expect(problems).toContain("missing media: media/audio/hallo.mp3");
  expect(problems).toContain("ex-99: locale texts for an exercise the lesson does not have");
});
