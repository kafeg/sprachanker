// A course removed from the library: its folders and the media no other course of its series names.
import { expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotInstalledError, openLibrary } from "../src/library.ts";
import { removeCourse, SERIES_LOCK } from "../src/remove.ts";
import { MINI_AUDIO, MINI_SERIES, writeMiniLibrary } from "./mini-library.ts";

test("a course removed: its folders, its copies and the media only it names go; media another course names, the key map and the other course stay", async () => {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-remove-"));
  const series = await writeMiniLibrary(root);
  // Another course of the series with the same lesson: it names the lesson's audio, not the exam's
  // picture.
  cpSync(join(series, "canonical/basic/course.json"), join(series, "canonical/other/course.json"));
  cpSync(join(series, "canonical/basic/lessons"), join(series, "canonical/other/lessons"), {
    recursive: true,
  });
  cpSync(
    join(series, "locale/en-de/basic/course.json"),
    join(series, "locale/en-de/other/course.json"),
  );
  writeFileSync(
    join(series, "media.json"),
    JSON.stringify({
      "https://example.org/hallo.mp3": {
        kind: "audio",
        path: MINI_AUDIO,
        sha256: "a".repeat(64),
        size: 22,
        mime: "audio/mpeg",
      },
      "https://example.org/frage.png": {
        kind: "image",
        path: "media/image/frage.png",
        sha256: "b".repeat(64),
        size: 22,
        mime: "image/png",
      },
    }),
  );
  writeFileSync(
    join(series, "keys.json"),
    JSON.stringify({ [`${MINI_SERIES}/basic/u00`]: { "11": 1 } }),
  );

  const removed = await removeCourse(root, MINI_SERIES, "basic");
  expect(removed.shared).toBe(1);
  expect(existsSync(join(series, "canonical/basic"))).toBe(false);
  expect(existsSync(join(series, "locale/en-de/basic"))).toBe(false);
  expect(existsSync(join(series, "media/image/frage.png"))).toBe(false);
  expect(existsSync(join(series, MINI_AUDIO))).toBe(true);
  expect(Object.keys(JSON.parse(readFileSync(join(series, "media.json"), "utf8")))).toEqual([
    "https://example.org/hallo.mp3",
  ]);
  expect(existsSync(join(series, "keys.json"))).toBe(true);
  expect(
    openLibrary(root)
      .courses()
      .map((c) => c.course),
  ).toEqual(["other"]);
  // Gone: removing it again is no course here.
  await expect(removeCourse(root, MINI_SERIES, "basic")).rejects.toBeInstanceOf(NotInstalledError);
});

test("the series' only course removed: no empty folder nor a media index naming nothing left, the key map kept", async () => {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-remove-"));
  const series = await writeMiniLibrary(root);
  writeFileSync(
    join(series, "media.json"),
    JSON.stringify({
      "https://example.org/hallo.mp3": {
        kind: "audio",
        path: MINI_AUDIO,
        sha256: "a".repeat(64),
        size: 22,
        mime: "audio/mpeg",
      },
    }),
  );
  writeFileSync(join(series, "keys.json"), "{}");
  // The import lock and another process's, being taken (empty a moment): never touched.
  mkdirSync(join(series, SERIES_LOCK));
  writeFileSync(join(series, SERIES_LOCK, "pid"), "1");
  mkdirSync(join(series, `${SERIES_LOCK}.4242-1`));
  await removeCourse(root, MINI_SERIES, "basic");
  expect(readdirSync(series).sort()).toEqual([SERIES_LOCK, `${SERIES_LOCK}.4242-1`, "keys.json"]);
  expect(openLibrary(root).courses()).toEqual([]);
});

test("a course removed keeps its practice made by the model: the course downloaded again has it", async () => {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-remove-"));
  const series = await writeMiniLibrary(root);
  mkdirSync(join(series, "practice/ru-de/basic/00-01"), { recursive: true });
  writeFileSync(join(series, "practice/ru-de/basic/00-01.json"), "{}");
  writeFileSync(join(series, "practice/ru-de/basic/00-01/aaaaaaaa.wav"), "wav");
  await removeCourse(root, MINI_SERIES, "basic");
  expect(existsSync(join(series, "canonical/basic"))).toBe(false);
  expect(readFileSync(join(series, "practice/ru-de/basic/00-01/aaaaaaaa.wav"), "utf8")).toBe("wav");
  expect(existsSync(join(series, "practice/ru-de/basic/00-01.json"))).toBe(true);
});
