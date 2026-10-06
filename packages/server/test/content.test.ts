import { expect, test } from "bun:test";
import type { LibraryView } from "@sprachanker/course-kit";
import type { LessonKey } from "@sprachanker/schema";
import { createContent } from "../src/services/content.ts";

test("a course's cached lessons are read again after forget", async () => {
  let reads = 0;
  const library = {
    lesson: async (_series: string, key: string) => ({ key, read: ++reads }),
  } as unknown as LibraryView;
  const content = createContent(library);
  const key = "s/c/00-01" as LessonKey;
  const other = "s/d/00-01" as LessonKey;
  await content.lesson("s", key);
  await content.lesson("s", other);
  expect(await content.lesson("s", key)).toMatchObject({ read: 1 });
  content.forget("s", "c");
  expect(await content.lesson("s", key)).toMatchObject({ read: 3 });
  expect(await content.lesson("s", other)).toMatchObject({ read: 2 });
});
