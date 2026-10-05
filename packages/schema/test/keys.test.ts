import { describe, expect, test } from "bun:test";
import {
  courseGoalKey,
  courseKey,
  ExerciseKey,
  examItemKey,
  examKey,
  examSectionKey,
  exerciseKey,
  ItemKey,
  itemKey,
  LessonKey,
  LexemeKey,
  lemmaSlug,
  lessonGoalKey,
  lessonKey,
  lessonOf,
  lexemeKey,
  parseItemKey,
  parseLessonKey,
  parseLexemeKey,
  RuleId,
  ruleId,
  SceneKey,
  sceneKey,
  seriesKey,
  unitKey,
  VocabKey,
  vocabKey,
} from "../src/keys.ts";

const series = seriesKey("dw", "nicos-weg");
const course = courseKey(series, "a1");
const lesson = lessonKey(course, 0, 1);
const exercise = exerciseKey(lesson, 3);

describe("builders produce the keys of spec 02", () => {
  test.each([
    [series, "dw.nicos-weg"],
    [course, "dw.nicos-weg/a1"],
    [unitKey(course, 0), "dw.nicos-weg/a1/u00"],
    [lesson, "dw.nicos-weg/a1/00-01"],
    [exercise, "dw.nicos-weg/a1/00-01/ex-03"],
    [exerciseKey(lesson, 1, "ours"), "dw.nicos-weg/a1/00-01/x-01"],
    [itemKey(exercise, 2), "dw.nicos-weg/a1/00-01/ex-03#2"],
    [lessonGoalKey(lesson, 1), "dw.nicos-weg/a1/00-01/goal-1"],
    [courseGoalKey(course, "greet-people"), "dw.nicos-weg/a1/goal-greet-people"],
    [vocabKey(lesson, "Frau"), "dw.nicos-weg/a1/00-01/v-frau"],
    [vocabKey(lesson, "Frau", 2), "dw.nicos-weg/a1/00-01/v-frau.2"],
    [lexemeKey("de", "Frau", "noun", "f"), "lex:de:frau:noun:f"],
    [lexemeKey("de", "Wie geht es Ihnen?", "phrase"), "lex:de:wie-geht-es-ihnen:phrase"],
    [ruleId("de", "greeting", "du-sie"), "de.greeting.du-sie"],
    [sceneKey(series, "neighbour-morning"), "dw.nicos-weg/scene-neighbour-morning"],
  ])("%s", (built, expected) => {
    expect(built).toBe(expected as typeof built);
  });

  test("exam keys", () => {
    const exam = examKey(courseKey(seriesKey("bamf", "lid"), "lid"), "test");
    expect(exam).toBe("bamf.lid/lid/exam-test" as typeof exam);
    expect(examSectionKey(exam, "state")).toBe("bamf.lid/lid/exam-test/s-state" as never);
    expect(examItemKey(exam, "be-01")).toBe("bamf.lid/lid/exam-test/q-be-01" as never);
  });
});

describe("lemma slugs", () => {
  test.each([
    ["die Frau", "die-frau"],
    ["Größe", "größe"],
    ["Mach’s gut!", "machs-gut"],
    ["E-Mail", "e-mail"],
    ["Es ist 09:00 Uhr.", "es-ist-0900-uhr"],
    ["  Wie  geht's? ", "wie-gehts"],
    ["Привет!", "привет"],
    ["Café", "café"],
  ])("%s → %s", (lemma, slug) => {
    expect(lemmaSlug(lemma)).toBe(slug);
  });
});

describe("validation rejects malformed keys", () => {
  test.each([
    [LessonKey, "dw.nicos-weg/a1/0-1"],
    [LessonKey, "dw/a1/00-01"],
    [ExerciseKey, "dw.nicos-weg/a1/00-01/ex-3"],
    [ItemKey, "dw.nicos-weg/a1/00-01/ex-03#0"],
    [VocabKey, "dw.nicos-weg/a1/00-01/v-Frau"],
    [VocabKey, "dw.nicos-weg/a1/00-01/v-frau.1"],
    [LexemeKey, "lex:de:frau:noun:x"],
    [LexemeKey, "lex:de:frau"],
    [RuleId, "de.du-sie"],
    [SceneKey, "dw.nicos-weg/scene-"],
  ] as const)("%#: %s", (schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});

describe("parsers", () => {
  test("lesson", () => {
    expect(parseLessonKey(lesson)).toEqual({
      course,
      courseId: "a1",
      name: "00-01",
      unit: 0,
      lesson: 1,
    });
  });
  test("exercise → lesson, item → exercise", () => {
    expect(lessonOf(exercise)).toBe(lesson);
    expect(parseItemKey(itemKey(exercise, 12))).toEqual({ exercise, n: 12 });
  });
  test("lexeme", () => {
    expect(parseLexemeKey(lexemeKey("de", "Frau", "noun", "f"))).toEqual({
      lang: "de",
      lemma: "frau",
      pos: "noun",
      gender: "f",
    });
    expect(parseLexemeKey(lexemeKey("de", "auch", "word"))).toEqual({
      lang: "de",
      lemma: "auch",
      pos: "word",
    });
  });
});
