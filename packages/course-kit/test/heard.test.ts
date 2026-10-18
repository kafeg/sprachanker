// A course's recordings heard: written beside the course, read back by the library.
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CourseKey, heardTexts } from "@sprachanker/schema";
import { addHeard } from "../src/heard.ts";
import { openLibrary } from "../src/library.ts";
import { nodeFs } from "../src/node-fs.ts";
import { MINI_SERIES, writeMiniLibrary } from "./mini-library.ts";

const course = `${MINI_SERIES}/basic` as CourseKey;
const heard = (text: string) => ({ text, model: "small-q5_1", heardAt: 1 });

test("recordings heard are added to the course's file, one heard again replaced; the library reads them", async () => {
  const root = mkdtempSync(join(tmpdir(), "sprachanker-heard-"));
  await writeMiniLibrary(root);
  const library = openLibrary(nodeFs, root);
  expect(await library.heard(MINI_SERIES, "basic")).toBeUndefined();
  expect(library.heardStamp(MINI_SERIES, "basic")).toBe("");
  await addHeard(nodeFs, root, MINI_SERIES, {
    course,
    lang: "de",
    recordings: { "media/audio/a.mp3": heard("A."), "media/audio/b.mp3": heard("B.") },
  });
  await addHeard(nodeFs, root, MINI_SERIES, {
    course,
    lang: "de",
    recordings: { "media/audio/b.mp3": heard("B again.") },
  });
  expect(heardTexts(await library.heard(MINI_SERIES, "basic"))).toEqual({
    "media/audio/a.mp3": "A.",
    "media/audio/b.mp3": "B again.",
  });
  expect(library.heardStamp(MINI_SERIES, "basic")).not.toBe("");
  await expect(
    addHeard(nodeFs, root, "../x", { course, lang: "de", recordings: {} }),
  ).rejects.toThrow();
});
