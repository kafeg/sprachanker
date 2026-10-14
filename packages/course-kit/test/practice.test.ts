// A course's practice written: variants added to a lesson's practice, its recordings beside.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type LessonKey, type PracticeText, practiceRecordingPath } from "@sprachanker/schema";
import { openLibrary } from "../src/library.ts";
import { addPractice } from "../src/practice.ts";
import { MINI_SERIES, writeMiniLibrary } from "./mini-library.ts";

const LESSON = `${MINI_SERIES}/basic/00-01` as LessonKey;

const heard = (id: string, recording?: string): PracticeText => ({
  id,
  model: "m",
  madeAt: 1,
  text: {
    kind: "announcement",
    step: "listening",
    title: "Durchsage",
    situation: "Объявление.",
    lines: [{ text: "Achtung!" }],
    glossary: [],
    questions: [{ phase: "listening", question: "Что?", accepted: ["Achtung"] }],
    ...(recording && { recording }),
  },
});

test("variants added to a lesson's practice, one after another, each with its recording", async () => {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-practice-"));
  await writeMiniLibrary(root);
  const at = practiceRecordingPath(LESSON, "ru-de", "aaaaaaaa");
  expect(at).toBe("practice/ru-de/basic/00-01/aaaaaaaa.wav");
  await addPractice(root, MINI_SERIES, {
    lesson: LESSON,
    edition: "ru-de",
    language: "ru",
    add: { step: "listening", variant: heard("aaaaaaaa", at) },
    recordings: [{ path: at, wav: new Uint8Array([1, 2, 3]) }],
  });
  await addPractice(root, MINI_SERIES, {
    lesson: LESSON,
    edition: "ru-de",
    language: "ru",
    add: { step: "listening", variant: heard("bbbbbbbb") },
  });
  const library = openLibrary(root);
  const practice = await library.practice(MINI_SERIES, LESSON, "ru-de");
  expect(practice?.listening.map((v) => v.id)).toEqual(["aaaaaaaa", "bbbbbbbb"]);
  expect(practice?.reading).toEqual([]);
  expect([...readFileSync(library.practiceFile(MINI_SERIES, at) as string)]).toEqual([1, 2, 3]);
  // A recording outside the lesson's folder is refused.
  await expect(
    addPractice(root, MINI_SERIES, {
      lesson: LESSON,
      edition: "ru-de",
      language: "ru",
      add: { step: "listening", variant: heard("cccccccc") },
      recordings: [{ path: "practice/ru-de/basic/00-02/x.wav", wav: new Uint8Array() }],
    }),
  ).rejects.toThrow("not the lesson's");
});
