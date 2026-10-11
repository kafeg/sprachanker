// Synthetic texts only: the corrections' mechanics, and the real file's shape (no source text here).
import { expect, test } from "bun:test";
import { fingerprint, withFingerprint } from "@sprachanker/course-kit";
import {
  CANONICAL_FORMAT,
  courseKey,
  exerciseKey,
  findExercise,
  itemKey,
  type Lesson,
  LOCALE_FORMAT,
  type LocaleLesson,
  lessonKey,
  lessonOf,
  parseLessonKey,
  seriesKey,
  unitKey,
} from "@sprachanker/schema";
import { COURSES, seriesId } from "../src/catalog.ts";
import {
  CORRECTIONS,
  Correction,
  correctionName,
  courseCorrections,
} from "../src/normalise/corrections.ts";

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
  tabs: {
    grammar: [
      {
        title: "Глаголы",
        bodyHtml: "<td>2-е лицо</td><td>du gehst</td><td>2-е лицо</td><td>er geht</td>",
      },
    ],
    culture: [
      { bodyHtml: "<p>Немцы любит праздники.</p>" },
      { bodyHtml: "<p>Немцы любит пиво.</p>" },
    ],
  },
  downloads: [],
});

const canonical = (): Lesson => ({
  format: CANONICAL_FORMAT,
  key: lesson,
  unit: unitKey(course, 1),
  media: {},
  goals: [],
  pages: [
    {
      exercise: withFingerprint({
        key: first,
        type: "gap_text",
        text: "Herr Maier wartet.",
        newWords: [],
        ruleIds: [],
        items: [
          {
            key: itemKey(first, 1),
            prompt: "Herr Maier fährt mit der Bahn.",
            segments: ["Herr Maier kauft eine ", { gap: "g1" }, "."],
            answer: { g1: { accepted: ["Hin-und Rückfahrt"] } },
          },
          {
            key: itemKey(first, 2),
            prompt: "Herr Maier hat kein Bahncard.",
            segments: ["Ja, ", { gap: "g1" }],
            answer: { g1: { accepted: ["Falsc"] } },
          },
        ],
      }),
    },
    {
      exercise: withFingerprint({
        key: second,
        type: "single_choice",
        newWords: [],
        ruleIds: [],
        items: [
          {
            key: itemKey(second, 1),
            media: { audio: "media/Maier.mp3" },
            options: [
              { id: "a", text: "Richtig" },
              { id: "b", text: "Falsc" },
            ],
            answer: { optionIds: ["b"] },
          },
        ],
      }),
    },
  ],
  vocab: [],
  unmapped: [],
});

const both = () => ({ lesson: canonical(), locale: locale() });

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
  run.lesson({ lesson: canonical(), locale: out });
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

test("a correction whose fix holds its phrase is not made twice: a source fixed the same way is stale", () => {
  const run = courseCorrections(course, [
    fix({ exercise: first, field: "title", from: "Суп", to: "Суп дня" }),
  ]);
  const out = locale();
  run.lesson({ lesson: canonical(), locale: out });
  expect(out.exercises[first]?.title).toBe("Суп дня из морковки");
  run.lesson({ lesson: canonical(), locale: out });
  expect(out.exercises[first]?.title).toBe("Суп дня из морковки");
  // A source already fixed that way: nothing done, the correction reported stale.
  const fixed = courseCorrections(course, [
    fix({ exercise: first, field: "title", from: "Суп", to: "Суп дня" }),
  ]);
  fixed.lesson({ lesson: canonical(), locale: out });
  expect(out.exercises[first]?.title).toBe("Суп дня из морковки");
  expect(fixed.report()?.stale).toEqual([`${first} title`]);
});

test("another course's corrections are not its own: no report", () => {
  const other = courseKey(seriesKey("test", "series"), "c2");
  const run = courseCorrections(other, [
    fix({ exercise: first, field: "title", from: "морковки", to: "свёклы" }),
  ]);
  const out = locale();
  run.lesson({ lesson: canonical(), locale: out });
  expect(out.exercises[first]?.title).toBe("Суп из морковки");
  expect(run.report()).toBeUndefined();
});

test("an item's field needs its item; an exercise's has none", () => {
  expect(() => fix({ exercise: first, field: "prompt", from: "a", to: "b" })).toThrow();
  expect(() => fix({ exercise: first, item: "#1", field: "title", from: "a", to: "b" })).toThrow();
  expect(() => fix({ exercise: first, field: "title", from: "", to: "b" })).toThrow();
});

test("German texts: the phrase replaced in every text of the exercise or item, its fingerprint renewed", () => {
  const corrections = [
    fix({ exercise: first, field: "canonical", from: "Herr Maier", to: "Herr Meier" }),
    fix({ exercise: first, item: "#1", field: "canonical", from: "Hin-und", to: "Hin- und" }),
    fix({ exercise: second, item: "#1", field: "canonical", from: "Falsc", to: "Falsch" }),
    fix({ exercise: second, item: "#2", field: "canonical", from: "Falsc", to: "Falsch" }),
    fix({ exercise: first, field: "canonical", from: "Frau Maier", to: "Frau Meier" }),
  ];
  const run = courseCorrections(course, corrections);
  const out = both();
  const before = findExercise(out.lesson, first)?.fingerprint;
  run.lesson(out);
  const ex = findExercise(out.lesson, first);
  expect(ex).toMatchObject({
    text: "Herr Meier wartet.",
    items: [
      {
        prompt: "Herr Meier fährt mit der Bahn.",
        segments: ["Herr Meier kauft eine ", { gap: "g1" }, "."],
        answer: { g1: { accepted: ["Hin- und Rückfahrt"] } },
      },
      { prompt: "Herr Meier hat kein Bahncard.", answer: { g1: { accepted: ["Falsc"] } } },
    ],
  });
  expect(ex?.fingerprint).not.toBe(before);
  expect(ex?.fingerprint).toBe(fingerprint(ex as NonNullable<typeof ex>));
  // Options' texts change; ids, keys and media do not.
  expect(findExercise(out.lesson, second)?.items[0]).toMatchObject({
    media: { audio: "media/Maier.mp3" },
    options: [
      { id: "a", text: "Richtig" },
      { id: "b", text: "Falsch" },
    ],
  });
  expect(run.report()).toEqual({
    applied: 3,
    stale: [`${second}#2 canonical`, `${first} canonical`],
  });
});

test("a German fix whose text holds its phrase is not made twice: a source fixed the same way is stale", () => {
  const run = courseCorrections(course, [
    fix({ exercise: second, field: "canonical", from: "Falsc", to: "Falsch" }),
  ]);
  const out = both();
  run.lesson(out);
  const once = structuredClone(findExercise(out.lesson, second));
  expect(once?.items[0]).toMatchObject({ options: [{ text: "Richtig" }, { text: "Falsch" }] });
  run.lesson(out);
  expect(findExercise(out.lesson, second)).toEqual(once);
  const fixed = courseCorrections(course, [
    fix({ exercise: second, field: "canonical", from: "Falsc", to: "Falsch" }),
  ]);
  fixed.lesson(out);
  expect(findExercise(out.lesson, second)).toEqual(once);
  expect(fixed.report()?.stale).toEqual([`${second} canonical`]);
});

test("grammar and culture pages: the phrase replaced in the lesson's pages of that kind", () => {
  const other = lessonKey(course, 1, 3);
  const corrections = [
    // Another lesson's: its phrase is here too, but this lesson is not its own.
    fix({ lesson: other, tab: "culture", from: "любит", to: "любят" }),
    fix({ lesson, tab: "grammar", from: "2-е лицо</td><td>er", to: "3-е лицо</td><td>er" }),
    fix({ lesson, tab: "culture", from: "Немцы любит", to: "Немцы любят" }),
    fix({ lesson, tab: "grammar", from: "Немцы любит", to: "Немцы любят" }),
  ];
  const run = courseCorrections(course, corrections);
  const out = both();
  run.lesson(out);
  expect(out.locale.tabs.grammar[0]?.bodyHtml).toBe(
    "<td>2-е лицо</td><td>du gehst</td><td>3-е лицо</td><td>er geht</td>",
  );
  expect(out.locale.tabs.culture.map((t) => t.bodyHtml)).toEqual([
    "<p>Немцы любят праздники.</p>",
    "<p>Немцы любят пиво.</p>",
  ]);
  expect(run.report()).toEqual({
    applied: 2,
    stale: [`${other} culture`, `${lesson} grammar`],
  });
});

test("a page fix whose text holds its phrase is not made twice: a source fixed the same way is stale", () => {
  const fix1 = fix({ lesson, tab: "culture", from: "любит", to: "любит и ценит" });
  const run = courseCorrections(course, [fix1]);
  const out = both();
  run.lesson(out);
  run.lesson(out);
  expect(out.locale.tabs.culture[0]?.bodyHtml).toBe("<p>Немцы любит и ценит праздники.</p>");
  const fixed = courseCorrections(course, [fix1]);
  fixed.lesson(out);
  expect(out.locale.tabs.culture[1]?.bodyHtml).toBe("<p>Немцы любит и ценит пиво.</p>");
  expect(fixed.report()?.stale).toEqual([`${lesson} culture`]);
});

test("German and page fixes never drop a text; a page fix names its lesson and a tab with pages", () => {
  expect(() => fix({ exercise: first, field: "canonical", from: "a", to: null })).toThrow();
  expect(() => fix({ lesson, tab: "grammar", from: "a", to: null })).toThrow();
  expect(() => fix({ lesson, tab: "script", from: "a", to: "b" })).toThrow();
  expect(() => fix({ exercise: first, tab: "grammar", from: "a", to: "b" })).toThrow();
});

test("the corrections file: courses of the catalogue, each fix once, a phrase not a text", () => {
  const courses = new Set(COURSES.map((c) => courseKey(seriesId(c.series), c.id)));
  const seen = new Set<string>();
  for (const c of CORRECTIONS) {
    expect(courses).toContain(parseLessonKey("tab" in c ? c.lesson : lessonOf(c.exercise)).course);
    const id = `${correctionName(c)} ${c.from}`;
    expect(seen).not.toContain(id);
    seen.add(id);
    // Repo rule 4: never more of the source than the phrase replaced.
    expect(c.from.split(/\s+/).length).toBeLessThanOrEqual(12);
  }
  expect(CORRECTIONS.length).toBeGreaterThan(0);
});
