// The fixture course (spec 10, "Fixture library"): invented, every exercise type, two editions.
import { courseIndex, exams, lessons } from "./course.ts";
import { EDITIONS, localeCourse, localeExam, localeLessons } from "./locales.ts";

export { FIXTURE_BLOBS } from "./blobs.ts";
export { COURSE, SERIES } from "./course.ts";

export const fixture = {
  courseIndex,
  lessons,
  exams,
  locales: Object.fromEntries(
    (["ru", "en"] as const).map((lang) => [
      EDITIONS[lang],
      { course: localeCourse(lang), lessons: localeLessons(lang), exams: [localeExam(lang)] },
    ]),
  ),
};
