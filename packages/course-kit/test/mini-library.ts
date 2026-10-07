// A tiny synthetic library for course-kit's own tests, written with course-kit's functions: one course,
// one lesson with a choice and a recording, two editions. Course packages (courses/*) depend on
// course-kit, so its tests never import one of them.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type CourseIndex,
  courseKey,
  type Exercise,
  exerciseKey,
  itemKey,
  type Lesson,
  type LocaleCourse,
  type LocaleLesson,
  lessonKey,
  type MediaPath,
  seriesKey,
  unitKey,
} from "@sprachanker/schema";
import { prettyJson } from "../src/canonical-json.ts";
import { type ExerciseDraft, withFingerprint } from "../src/fingerprint.ts";

export const MINI_SERIES = seriesKey("sprachanker", "mini");
const COURSE = courseKey(MINI_SERIES, "basic");
const UNIT = unitKey(COURSE, 0);
export const MINI_LESSON = lessonKey(COURSE, 0, 1);
export const MINI_AUDIO = "media/audio/hallo.mp3" as MediaPath;
const CHOICE = exerciseKey(MINI_LESSON, 1);

const choice: Exercise = withFingerprint({
  key: CHOICE,
  type: "single_choice",
  newWords: [],
  ruleIds: [],
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
} as ExerciseDraft);

const index: CourseIndex = {
  format: 1,
  key: COURSE,
  units: [{ key: UNIT, lessons: [MINI_LESSON] }],
  exams: [],
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
  for (const edition of Object.values(editions)) {
    await put(`locale/${edition}/basic/course.json`, prettyJson(localeCourse(edition)));
    await put(`locale/${edition}/basic/lessons/00-01.json`, prettyJson(localeLesson(edition)));
  }
  await put(MINI_AUDIO, "sprachanker-mini:hallo");
  return series;
}
