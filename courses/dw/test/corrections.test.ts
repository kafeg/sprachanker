// Synthetic texts only: the corrections' mechanics, and the real file's shape (no source text here).
import { expect, test } from "bun:test";
import {
  courseKey,
  exerciseKey,
  LOCALE_FORMAT,
  type LocaleLesson,
  lessonKey,
  lessonOf,
  parseLessonKey,
  seriesKey,
} from "@sprachanker/schema";
import { COURSES, seriesId } from "../src/catalog.ts";
import { CORRECTIONS, Correction, courseCorrections } from "../src/normalise/corrections.ts";

const course = courseKey(seriesKey("test", "series"), "c1");
const lesson = lessonKey(course, 1, 2);
const first = exerciseKey(lesson, 1);
const second = exerciseKey(lesson, 2);

const locale = (): LocaleLesson => ({
  format: LOCALE_FORMAT,
  edition: "ru-de",
  lesson,
  sourceId: "1",
  title: "Урок",
  exercises: {
    [first]: {
      sourceId: "11",
      title: "Суп из морковки",
      instructionHtml: "<p>Выбери один ответ.</p>",
      textHtml: "<p>Ответ: Montag.</p>",
      items: { "#1": { hintHtml: "<p>Подсказка.</p>" }, "#2": { prompt: "Скажи что дома." } },
    },
    [second]: { sourceId: "12", items: {} },
  },
  vocab: {},
  tabs: { grammar: [], culture: [] },
  downloads: [],
});

const fix = (c: object) => Correction.parse({ why: "test", ...c });

test("a correction applies where its text is found; the rest are reported stale", () => {
  const corrections = [
    fix({ exercise: first, field: "title", from: "морковки", to: "свёклы" }),
    fix({ exercise: first, field: "instructionHtml", from: "один ответ", to: "два ответа" }),
    fix({ exercise: first, item: "#2", field: "prompt", from: "что дома", to: "что ты дома" }),
    fix({ exercise: first, field: "textHtml", from: "Montag", to: null }),
    fix({ exercise: first, item: "#1", field: "hintHtml", from: "Подсказка", to: null }),
    fix({ exercise: first, field: "title", from: "капусты", to: "свёклы" }),
    fix({ exercise: second, field: "instructionHtml", from: "один", to: "два" }),
    fix({ exercise: exerciseKey(lesson, 3), field: "title", from: "один", to: "два" }),
  ];
  const run = courseCorrections(course, corrections);
  const out = locale();
  run.lesson(out);
  expect(out.exercises[first]).toEqual({
    sourceId: "11",
    title: "Суп из свёклы",
    instructionHtml: "<p>Выбери два ответа.</p>",
    items: { "#2": { prompt: "Скажи что ты дома." } },
  });
  expect(out.exercises[second]).toEqual({ sourceId: "12", items: {} });
  expect(run.report()).toEqual({
    applied: 5,
    stale: [`${first} title`, `${second} instructionHtml`, `${exerciseKey(lesson, 3)} title`],
  });
});

test("another course's corrections are not its own: no report", () => {
  const other = courseKey(seriesKey("test", "series"), "c2");
  const run = courseCorrections(other, [
    fix({ exercise: first, field: "title", from: "морковки", to: "свёклы" }),
  ]);
  const out = locale();
  run.lesson(out);
  expect(out.exercises[first]?.title).toBe("Суп из морковки");
  expect(run.report()).toBeUndefined();
});

test("an item's field needs its item; an exercise's has none", () => {
  expect(() => fix({ exercise: first, field: "prompt", from: "a", to: "b" })).toThrow();
  expect(() => fix({ exercise: first, item: "#1", field: "title", from: "a", to: "b" })).toThrow();
  expect(() => fix({ exercise: first, field: "title", from: "", to: "b" })).toThrow();
});

test("the corrections file: courses of the catalogue, each fix once, a phrase not a text", () => {
  const courses = new Set(COURSES.map((c) => courseKey(seriesId(c.series), c.id)));
  const seen = new Set<string>();
  for (const c of CORRECTIONS) {
    expect(courses).toContain(parseLessonKey(lessonOf(c.exercise)).course);
    const id = `${c.exercise}${"item" in c ? c.item : ""} ${c.field} ${c.from}`;
    expect(seen).not.toContain(id);
    seen.add(id);
    // Repo rule 4: never more of the source than the phrase replaced.
    expect(c.from.split(/\s+/).length).toBeLessThanOrEqual(12);
  }
  expect(CORRECTIONS.length).toBeGreaterThan(0);
});
