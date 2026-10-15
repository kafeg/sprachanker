import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLibrary } from "../src/library.ts";
import { nodeFs } from "../src/node-fs.ts";
import { MINI_LESSON, writeMiniLibrary } from "./mini-library.ts";

async function library() {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-lib-"));
  await writeMiniLibrary(root);
  return openLibrary(nodeFs, root);
}

test("lists installed courses with their editions and reads validated files", async () => {
  const lib = await library();
  expect(lib.courses()).toEqual([
    { series: "sprachanker.mini", course: "basic", editions: ["en-de", "ru-de"] },
  ]);
  const index = await lib.courseIndex("sprachanker.mini", "basic");
  expect(index.units[0]?.lessons).toEqual([MINI_LESSON]);
  expect((await lib.lesson("sprachanker.mini", MINI_LESSON)).pages).toHaveLength(1);
  expect((await lib.localeLesson("sprachanker.mini", MINI_LESSON, "ru-de"))?.title).toBe("Hallo");
  expect(await lib.localeLesson("sprachanker.mini", MINI_LESSON, "fr-de")).toBeUndefined();
});

test("media files stay inside the media folder", async () => {
  const lib = await library();
  expect(lib.mediaFile("sprachanker.mini", "media/audio/hallo.mp3")).toEndWith(
    "media/audio/hallo.mp3",
  );
  expect(lib.mediaFile("sprachanker.mini", "media/../canonical/basic/course.json")).toBeUndefined();
  expect(lib.mediaFile("sprachanker.mini", "media/audio/none.mp3")).toBeUndefined();
});

test("a lesson file's stamp: what it is now, another once it is replaced, empty while there is none", async () => {
  const lib = await library();
  const series = "sprachanker.mini";
  const before = lib.lessonStamp(series, MINI_LESSON);
  expect(before).not.toBe("");
  expect(lib.lessonStamp(series, MINI_LESSON, "ru-de")).not.toBe("");
  expect(lib.lessonStamp(series, MINI_LESSON, "fr-de")).toBe("");
  const file = join(lib.root, series, "canonical/basic/lessons/00-01.json");
  writeFileSync(file, `${readFileSync(file, "utf8")}\n`);
  expect(lib.lessonStamp(series, MINI_LESSON)).not.toBe(before);
});

test("a course file's stamp: its index's and each edition's, another once one is replaced", async () => {
  const lib = await library();
  const series = "sprachanker.mini";
  const before = lib.courseStamp(series, "basic");
  expect(before).not.toBe("");
  expect(lib.courseStamp(series, "basic", "ru-de")).not.toBe("");
  expect(lib.courseStamp(series, "basic", "fr-de")).toBe("");
  const file = join(lib.root, series, "canonical/basic/course.json");
  writeFileSync(file, `${readFileSync(file, "utf8")}\n`);
  expect(lib.courseStamp(series, "basic")).not.toBe(before);
});
