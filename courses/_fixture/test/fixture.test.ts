import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fingerprint } from "@sprachanker/course-kit";
import {
  CourseIndex,
  EXERCISE_TYPES,
  Exam,
  Lesson,
  LocaleCourse,
  LocaleExam,
  LocaleLesson,
  RulesRegistry,
} from "@sprachanker/schema";
import { parse } from "yaml";
import { fixture } from "../src/index.ts";

const exercises = fixture.lessons.flatMap((lesson) => lesson.pages.map((page) => page.exercise));

describe("fixture course validates against the schemas", () => {
  test("canonical files", () => {
    expect(() => CourseIndex.parse(fixture.courseIndex)).not.toThrow();
    for (const lesson of fixture.lessons) expect(() => Lesson.parse(lesson)).not.toThrow();
    for (const exam of fixture.exams) expect(() => Exam.parse(exam)).not.toThrow();
  });

  test("two editions of locale files", () => {
    expect(Object.keys(fixture.locales).sort()).toEqual(["en-de", "ru-de"]);
    for (const locale of Object.values(fixture.locales)) {
      expect(() => LocaleCourse.parse(locale.course)).not.toThrow();
      for (const lesson of locale.lessons) expect(() => LocaleLesson.parse(lesson)).not.toThrow();
      for (const exam of locale.exams) expect(() => LocaleExam.parse(exam)).not.toThrow();
    }
  });
});

test("every exercise type appears", () => {
  expect([...new Set(exercises.map((e) => e.type))].sort()).toEqual([...EXERCISE_TYPES].sort());
});

test("fingerprints match the content", () => {
  for (const exercise of exercises) expect(fingerprint(exercise)).toBe(exercise.fingerprint);
});

test("the rules registry is valid and has every rule the fixture uses", async () => {
  const yaml = await Bun.file(join(import.meta.dir, "../../_shared/rules/de.yaml")).text();
  const registry = RulesRegistry.parse(parse(yaml));
  const ids = new Set(registry.map((rule) => rule.id));
  for (const id of exercises.flatMap((e) => e.ruleIds)) expect(ids).toContain(id);
});
