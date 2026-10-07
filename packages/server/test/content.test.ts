import { expect, test } from "bun:test";
import type { LibraryView } from "@sprachanker/course-kit";
import type { Lesson, LessonKey } from "@sprachanker/schema";
import { createContent } from "../src/services/content.ts";

test("a lesson read is kept; a failed read is not (the file may appear, e.g. a download finishing)", async () => {
  let reads = 0;
  const key = "a.b/c/01-01" as LessonKey;
  const library = {
    lesson: async () => {
      reads++;
      if (reads === 1) throw new Error("not there yet");
      return { key } as unknown as Lesson;
    },
  } as unknown as LibraryView;
  const content = createContent(library);
  expect(await content.lesson("a.b", key).catch((e: Error) => e.message)).toBe("not there yet");
  expect((await content.lesson("a.b", key)).key).toBe(key);
  await content.lesson("a.b", key);
  expect(reads).toBe(2);
});
