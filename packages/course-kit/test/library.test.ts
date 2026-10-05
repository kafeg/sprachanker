import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFixtureLibrary } from "@sprachanker/course-fixture";
import { openLibrary } from "../src/library.ts";

async function library() {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-lib-"));
  await writeFixtureLibrary(root);
  return openLibrary(root);
}

test("lists installed courses with their editions and reads validated files", async () => {
  const lib = await library();
  expect(lib.courses()).toEqual([
    { series: "sprachanker.fixture", course: "demo", editions: ["en-de", "ru-de"] },
  ]);
  const index = await lib.courseIndex("sprachanker.fixture", "demo");
  const key = index.units[0]?.lessons[0];
  if (!key) throw new Error("fixture has no lesson");
  expect((await lib.lesson("sprachanker.fixture", key)).pages.length).toBeGreaterThan(0);
  expect((await lib.localeLesson("sprachanker.fixture", key, "ru-de"))?.title).toBe("Im Café");
  expect(await lib.localeLesson("sprachanker.fixture", key, "fr-de")).toBeUndefined();
});

test("media files stay inside the media folder", async () => {
  const lib = await library();
  expect(lib.mediaFile("sprachanker.fixture", "media/audio/kaffee.mp3")).toEndWith(
    "media/audio/kaffee.mp3",
  );
  expect(
    lib.mediaFile("sprachanker.fixture", "media/../canonical/demo/course.json"),
  ).toBeUndefined();
  expect(lib.mediaFile("sprachanker.fixture", "media/audio/none.mp3")).toBeUndefined();
});
