import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture } from "@sprachanker/course-fixture";
import { prettyJson } from "../src/canonical-json.ts";
import { openLibrary } from "../src/library.ts";

async function writeFixtureLibrary() {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-lib-"));
  const series = join(root, "sprachanker.fixture");
  const put = (path: string, value: unknown) => Bun.write(join(series, path), prettyJson(value));
  await put("canonical/demo/course.json", fixture.courseIndex);
  for (const lesson of fixture.lessons)
    await put(`canonical/demo/lessons/${lesson.key.split("/").pop()}.json`, lesson);
  for (const [edition, loc] of Object.entries(fixture.locales)) {
    await put(`locale/${edition}/demo/course.json`, loc.course);
    for (const lesson of loc.lessons)
      await put(`locale/${edition}/demo/lessons/${lesson.lesson.split("/").pop()}.json`, lesson);
  }
  await Bun.write(join(series, "media/audio/kaffee.mp3"), "x");
  return root;
}

test("lists installed courses with their editions and reads validated files", async () => {
  const library = openLibrary(await writeFixtureLibrary());
  expect(library.courses()).toEqual([
    { series: "sprachanker.fixture", course: "demo", editions: ["en-de", "ru-de"] },
  ]);
  const index = await library.courseIndex("sprachanker.fixture", "demo");
  const key = index.units[0]?.lessons[0];
  if (!key) throw new Error("fixture has no lesson");
  expect((await library.lesson("sprachanker.fixture", key)).pages.length).toBeGreaterThan(0);
  expect((await library.localeLesson("sprachanker.fixture", key, "ru-de"))?.title).toBe("Im Café");
  expect(await library.localeLesson("sprachanker.fixture", key, "fr-de")).toBeUndefined();
});

test("media files stay inside the media folder", async () => {
  const library = openLibrary(await writeFixtureLibrary());
  expect(library.mediaFile("sprachanker.fixture", "media/audio/kaffee.mp3")).toEndWith(
    "media/audio/kaffee.mp3",
  );
  expect(
    library.mediaFile("sprachanker.fixture", "media/../canonical/demo/course.json"),
  ).toBeUndefined();
  expect(library.mediaFile("sprachanker.fixture", "media/audio/none.mp3")).toBeUndefined();
});
