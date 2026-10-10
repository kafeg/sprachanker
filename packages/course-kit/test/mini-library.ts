// A tiny synthetic library for course-kit's own tests, written with course-kit's functions: one course,
// one lesson with a choice and a recording, an exam of three questions, two editions. Course packages (courses/*) depend on
// course-kit, so its tests never import one of them.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type CourseIndex,
  courseKey,
  type Exam,
  type Exercise,
  examItemKey,
  examKey,
  examSectionKey,
  exerciseKey,
  itemKey,
  type Lesson,
  type LocaleCourse,
  type LocaleExam,
  type LocaleLesson,
  lessonKey,
  type MediaPath,
  seriesKey,
  unitKey,
} from "@sprachanker/schema";
import { prettyJson } from "../src/canonical-json.ts";
import { draftExercise } from "../src/exercise-draft.ts";

export const MINI_SERIES = seriesKey("sprachanker", "mini");
const COURSE = courseKey(MINI_SERIES, "basic");
const UNIT = unitKey(COURSE, 0);
export const MINI_LESSON = lessonKey(COURSE, 0, 1);
export const MINI_AUDIO = "media/audio/hallo.mp3" as MediaPath;
const CHOICE = exerciseKey(MINI_LESSON, 1);

const choice: Exercise = draftExercise({
  key: CHOICE,
  type: "single_choice",
  media: { audio: MINI_AUDIO },
  items: [
    {
      key: itemKey(CHOICE, 1),
      prompt: "Hallo?",
      options: [
        { id: "a", text: "Hallo!" },
        { id: "b", text: "Tschüss!" },
      ],
      answer: { optionIds: ["a"] },
    },
  ],
});

export const MINI_EXAM = examKey(COURSE, "quiz");
const question = (
  id: string,
  state: string | null,
  extra: Partial<Exam["items"][number]> = {},
) => ({
  key: examItemKey(MINI_EXAM, id),
  type: "single_choice" as const,
  tags: { federalState: state },
  prompt: `Frage ${id}?`,
  options: [
    { id: "a", text: "ja" },
    { id: "b", text: "nein" },
  ],
  answer: { optionIds: ["a"] },
  ...extra,
});
const exam: Exam = {
  format: 1,
  key: MINI_EXAM,
  timeLimitSec: 600,
  sections: [
    {
      key: examSectionKey(MINI_EXAM, "general"),
      pool: [examItemKey(MINI_EXAM, "001"), examItemKey(MINI_EXAM, "002")],
      draw: 1,
      filter: null,
    },
    {
      key: examSectionKey(MINI_EXAM, "state"),
      pool: [examItemKey(MINI_EXAM, "be-01")],
      draw: 1,
      filter: { tag: "federalState", setting: "exam.federalState" },
    },
  ],
  items: [
    question("001", null, {
      media: { image: "media/image/frage.png" as MediaPath, credit: "© Mini" },
    }),
    question("002", null),
    question("be-01", "be"),
  ],
  thresholds: [{ id: "pass", minPoints: 2 }],
};
const localeExam = (edition: string): LocaleExam => ({
  format: 1,
  edition: edition as LocaleExam["edition"],
  exam: MINI_EXAM,
  title: "Quiz",
  sections: {
    [examSectionKey(MINI_EXAM, "general")]: { title: "Allgemein" },
    [examSectionKey(MINI_EXAM, "state")]: { title: "Land" },
  },
  thresholds: { pass: { title: "Bestanden" } },
  items: {},
});

const index: CourseIndex = {
  format: 1,
  key: COURSE,
  units: [{ key: UNIT, lessons: [MINI_LESSON] }],
  exams: [MINI_EXAM],
  goals: [],
};

const lesson: Lesson = {
  format: 1,
  key: MINI_LESSON,
  unit: UNIT,
  media: {},
  goals: [],
  pages: [{ exercise: choice }],
  vocab: [],
  unmapped: [],
};

const editions = { ru: "ru-de", en: "en-de" } as const;

const localeCourse = (edition: string): LocaleCourse => ({
  format: 1,
  edition: edition as LocaleCourse["edition"],
  course: COURSE,
  sourceId: "1",
  title: "Mini",
  units: { [UNIT]: { title: "Hallo" } },
  goals: {},
});

const localeLesson = (edition: string): LocaleLesson => ({
  format: 1,
  edition: edition as LocaleLesson["edition"],
  lesson: MINI_LESSON,
  sourceId: "2",
  title: "Hallo",
  exercises: { [CHOICE]: { sourceId: "3", items: {} } },
  vocab: {},
  tabs: { grammar: [], culture: [] },
  downloads: [],
});

/** Writes `<libraryRoot>/sprachanker.mini/…`; returns the series folder. */
export async function writeMiniLibrary(libraryRoot: string): Promise<string> {
  const series = join(libraryRoot, MINI_SERIES);
  const put = async (path: string, data: string) => {
    await mkdir(dirname(join(series, path)), { recursive: true });
    await writeFile(join(series, path), data);
  };
  await put("canonical/basic/course.json", prettyJson(index));
  await put("canonical/basic/lessons/00-01.json", prettyJson(lesson));
  await put("canonical/basic/exams/quiz.json", prettyJson(exam));
  for (const edition of Object.values(editions)) {
    await put(`locale/${edition}/basic/course.json`, prettyJson(localeCourse(edition)));
    await put(`locale/${edition}/basic/lessons/00-01.json`, prettyJson(localeLesson(edition)));
    await put(`locale/${edition}/basic/exams/quiz.json`, prettyJson(localeExam(edition)));
  }
  await put(MINI_AUDIO, "sprachanker-mini:hallo");
  await put("media/image/frage.png", "sprachanker-mini:frage");
  return series;
}
