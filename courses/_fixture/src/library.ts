// Writes the fixture course into a library folder, as an import would (tests, e2e).
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { prettyJson } from "@sprachanker/course-kit";
import { courseIndex, exams, lessons, SERIES } from "./course.ts";
import { EDITIONS, localeCourse, localeExam, localeLessons } from "./locales.ts";
import { FIXTURE_MEDIA } from "./media.ts";

/** The fixture's series key as a plain string (tests compare with it). */
export const FIXTURE_SERIES: string = SERIES;

/** Writes `<libraryRoot>/sprachanker.fixture/…`; returns the series folder. */
export async function writeFixtureLibrary(libraryRoot: string): Promise<string> {
  const series = join(libraryRoot, FIXTURE_SERIES);
  const put = async (path: string, data: string) => {
    await mkdir(dirname(join(series, path)), { recursive: true });
    await writeFile(join(series, path), data);
  };
  const name = (key: string) => key.split("/").pop();
  await put("canonical/demo/course.json", prettyJson(courseIndex));
  for (const lesson of lessons)
    await put(`canonical/demo/lessons/${name(lesson.key)}.json`, prettyJson(lesson));
  for (const exam of exams)
    await put(
      `canonical/demo/exams/${name(exam.key)?.replace(/^exam-/, "")}.json`,
      prettyJson(exam),
    );
  for (const lang of ["ru", "en"] as const) {
    const edition = EDITIONS[lang];
    await put(`locale/${edition}/demo/course.json`, prettyJson(localeCourse(lang)));
    for (const lesson of localeLessons(lang))
      await put(`locale/${edition}/demo/lessons/${name(lesson.lesson)}.json`, prettyJson(lesson));
    await put(`locale/${edition}/demo/exams/mini.json`, prettyJson(localeExam(lang)));
  }
  for (const [path, { content }] of FIXTURE_MEDIA) await put(path, content);
  return series;
}
