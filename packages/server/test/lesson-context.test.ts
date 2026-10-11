// What the learner knows by now (07, the knowledge snapshot): the course's level from its id, the
// lesson's place, the earlier lessons' words with translations and the grammar topics met so far.
import { describe, expect, test } from "bun:test";
import type { LessonKey } from "@sprachanker/schema";
import type { Content } from "../src/services/content.ts";
import { createLessonContext, levelOf } from "../src/services/lesson-context.ts";

const key = (n: number) => `s/a2-ru/01-0${n}` as LessonKey;
const word = (lesson: number, target: string) => ({ key: `${key(lesson)}/${target}`, target });

/** Three lessons in two units; each with words, the first two with grammar pages. */
function content(): Content {
  const lessons = [
    { vocab: [word(1, "hallo"), word(1, "tschüss")], grammar: ["Begrüßung"] },
    {
      vocab: [word(2, "der Kaffee"), word(2, "hallo")],
      grammar: ["Verb an Position 2", "Begrüßung"],
    },
    { vocab: [word(3, "die Rechnung")], grammar: ["Modalverben"] },
  ];
  const at = (k: string) => lessons[Number(k.at(-1)) - 1];
  return {
    courseMap: async () => ({
      index: {
        units: [
          { key: "s/a2-ru/u1", lessons: [key(1), key(2)] },
          { key: "s/a2-ru/u2", lessons: [key(3)] },
        ],
      },
      locale: {
        goals: { g3: { text: "заплатить" } },
        units: { "s/a2-ru/u2": { title: "Im Café" } },
      },
      titles: { [key(1)]: "Hallo!", [key(2)]: "Kaffee", [key(3)]: "Zahlen, bitte" },
    }),
    lesson: async (_s: string, k: string) => ({
      goals: k === key(3) ? ["g3"] : [],
      vocab: at(k)?.vocab ?? [],
    }),
    localeLesson: async (_s: string, k: string) => ({
      title: `title ${k}`,
      vocab: Object.fromEntries(
        (at(k)?.vocab ?? []).map((v) => [v.key, { translation: `ru:${v.target}` }]),
      ),
      tabs: {
        grammar: (at(k)?.grammar ?? []).map((title) => ({ title, bodyHtml: `<p>${title}</p>` })),
      },
    }),
  } as unknown as Content;
}

describe("the knowledge snapshot", () => {
  test("a lesson: its level, place, goals, words; earlier words with translations; topics met", async () => {
    const ctx = await createLessonContext(content()).get("s", key(3), "ru-de");
    expect(ctx.info).toEqual({
      title: `title ${key(3)}`,
      goals: ["заплатить"],
      grammarHtml: ["<p>Modalverben</p>"],
      vocab: [{ target: "die Rechnung", translation: "ru:die Rechnung" }],
      level: "A2",
      place: { n: 3, of: 3, unit: "Im Café" },
      // Each word once, where it was met last (taught again: as recent as that lesson, the last to
      // be cut); in course order.
      knownWords: [
        { target: "tschüss", translation: "ru:tschüss" },
        { target: "der Kaffee", translation: "ru:der Kaffee" },
        { target: "hallo", translation: "ru:hallo" },
      ],
      // Each topic with the lesson that taught it first ("unit.lesson", as the app names it).
      topics: [
        { title: "Begrüßung", lesson: "1.1", lessonTitle: "Hallo!" },
        { title: "Verb an Position 2", lesson: "1.2", lessonTitle: "Kaffee" },
        { title: "Modalverben", lesson: "1.3", lessonTitle: "Zahlen, bitte" },
      ],
    });
    expect(ctx.earlierLessons).toEqual(["Hallo!", "Kaffee"]);
  });

  test("the first lesson knows no earlier words; a unit without a title is left out", async () => {
    const ctx = await createLessonContext(content()).get("s", key(1), "ru-de");
    expect(ctx.info.place).toEqual({ n: 1, of: 3 });
    expect(ctx.info.knownWords).toEqual([]);
    expect(ctx.info.topics).toEqual([{ title: "Begrüßung", lesson: "1.1", lessonTitle: "Hallo!" }]);
  });

  test("the level a course's id or a deck's name says", () => {
    expect(levelOf("a1-ru")).toBe("A1");
    expect(levelOf("a1-a2-ru")).toBe("A1–A2");
    expect(levelOf("A1A2")).toBe("A1–A2");
    // A range reads low to high, whatever the order named; several names joined: their range.
    expect(levelOf("B1 + A2")).toBe("A2–B1");
    expect(levelOf("b1-ru a1-ru a2-ru")).toBe("A1–B1");
    expect(levelOf("b1-de")).toBe("B1");
    expect(levelOf("Deutsch A2")).toBe("A2");
    expect(levelOf("слова_b1")).toBe("B1");
    expect(levelOf("dib")).toBeUndefined();
    expect(levelOf("level-1")).toBeUndefined();
    expect(levelOf("ba12")).toBeUndefined();
  });
});
