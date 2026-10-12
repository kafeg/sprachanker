// What a Tutor section's chat practises: the languages the courses begun teach, the latest
// course's first; a new chat in the one chosen, read in the latest course of it; another refused.
import { describe, expect, test } from "bun:test";
import type { Content } from "../src/services/content.ts";
import { createCoursesContext } from "../src/services/courses-context.ts";
import type { LessonContexts } from "../src/services/lesson-context.ts";
import type { StudiedCourse } from "../src/services/lessons.ts";
import type { Mistakes } from "../src/services/mistakes.ts";

const course = (course: string, edition: string, lastAt: number): StudiedCourse => ({
  key: `s/${course}`,
  series: "s",
  course,
  edition,
  lastAt,
  lessons: [],
});

/** The courses begun, the latest first; each titled in its own edition only. */
function context(studied: StudiedCourse[]) {
  const content = {
    lesson: () => Promise.reject(new Error("not read")),
    localeLesson: () => Promise.reject(new Error("not read")),
    courseIndex: () => Promise.resolve(undefined),
    localeCourse: (_series: string, id: string, edition: string) =>
      Promise.resolve(
        studied.some((c) => c.course === id && c.edition === edition)
          ? { title: `${id} (${edition})` }
          : undefined,
      ),
  } as unknown as Content;
  return createCoursesContext({
    content,
    lessonContext: {} as LessonContexts,
    studied: () => Promise.resolve(studied),
    mistakes: { list: () => [] } as unknown as Mistakes,
  });
}

const titles = (known: Awaited<ReturnType<ReturnType<typeof context>["get"]>>) =>
  known?.courses.courses.map((c) => c.title);

describe("the language a Tutor section's chat practises", () => {
  const courses = context([
    course("deutsch-b", "ru-de", 3),
    course("english", "ru-en", 2),
    course("deutsch-a", "en-de", 1),
  ]);

  test("the languages the courses begun teach, each once, the latest course's first", async () => {
    expect(await courses.targets()).toEqual(["de", "en"]);
    expect(await context([]).targets()).toEqual([]);
  });

  test("a new chat in the language chosen: the latest course of it, its courses only", async () => {
    const english = await courses.get({ target: "en" });
    expect(english?.edition).toBe("ru-en");
    expect(titles(english)).toEqual(["english (ru-en)"]);
    // Unset: the course studied last, as before a choice was offered.
    const latest = await courses.get({});
    expect(latest?.edition).toBe("ru-de");
    expect(titles(latest)).toEqual(["deutsch-b (ru-de)", "deutsch-a (en-de)"]);
    expect((await courses.get({ target: "de" }))?.edition).toBe("ru-de");
  });

  test("a language no course begun teaches refused; nothing begun: no chat to begin", async () => {
    await expect(courses.get({ target: "fr" })).rejects.toMatchObject({
      code: "language_not_studied",
      status: 400,
    });
    expect(await context([]).get({ target: "de" })).toBeUndefined();
  });

  test("a chat's own language stands, whatever is chosen or studied now", async () => {
    expect((await courses.get({ edition: "en-fr" }))?.edition).toBe("en-fr");
    expect((await context([]).get({ edition: "ru-de" }))?.edition).toBe("ru-de");
  });

  test("the level the chat's courses say: their range; none said, none given", async () => {
    const levelled = context([
      course("nicos-weg-b1-ru", "ru-de", 3),
      course("english-c1", "ru-en", 2),
      course("nicos-weg-a1-ru", "ru-de", 1),
    ]);
    expect((await levelled.get({ target: "de" }))?.courses.level).toBe("A1–B1");
    expect((await levelled.get({ target: "en" }))?.courses.level).toBe("C1");
    expect((await courses.get({ target: "de" }))?.courses.level).toBeUndefined();
  });
});
