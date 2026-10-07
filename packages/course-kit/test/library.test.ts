import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLibrary } from "../src/library.ts";
import { MINI_LESSON, writeMiniLibrary } from "./mini-library.ts";

async function library() {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-lib-"));
  await writeMiniLibrary(root);
  return openLibrary(root);
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
