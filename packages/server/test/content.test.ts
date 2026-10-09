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

test("a course whose files do not read is left out of the list; the others still list", async () => {
  const library = {
    courses: () => [
      { series: "a.b", course: "good", editions: [] },
      { series: "a.b", course: "broken", editions: [] },
    ],
    courseIndex: async (_series: string, course: string) => {
      if (course === "broken") throw new Error("course.json: format 2 is not known");
      return { key: "a.b/good", units: [{ lessons: ["a.b/good/01-01"] }] };
    },
  } as unknown as LibraryView;
  const courses = await createContent(library).courses();
  expect(courses.map((c) => c.key)).toEqual(["a.b/good"]);
});
