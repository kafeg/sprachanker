// Normalisation of one downloaded course edition: raw pages → canonical/ and locale/ files (offline).
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type MediaIndex, prettyJson } from "@sprachanker/course-kit";
import {
  CourseIndex,
  courseKey,
  type GoalKey,
  Lesson,
  type LessonKey,
  LocaleCourse,
  LocaleLesson,
  parseLessonKey,
  seriesKey,
} from "@sprachanker/schema";
import { type ApolloState, exerciseIds } from "../apollo.ts";
import { COURSES, type DwCourse } from "../catalog.ts";

import { createContext, html } from "./context.ts";
import { courseFiles, courseLessons } from "./course.ts";
import { normaliseLesson } from "./lesson.ts";

export interface NormaliseResult {
  lessons: number;
  unknown: number;
  problems: number;
}

export async function normaliseCourse(
  seriesDir: string,
  dw: DwCourse,
  options: { lessons?: number[]; log: (line: string) => void },
): Promise<NormaliseResult> {
  const { log } = options;
  const rawDir = `raw/${dw.edition}/${dw.course}`;
  // Canonical files come from the course's first edition; other editions only add their locale files
  // (aligning editions is stage 11).
  const primary = COURSES.find((c) => c.series === dw.series && c.course === dw.course) === dw;
  const read = async (file: string): Promise<ApolloState> =>
    JSON.parse(await readFile(join(seriesDir, rawDir, file), "utf8"));
  const write = async (path: string, value: unknown) => {
    await mkdir(dirname(join(seriesDir, path)), { recursive: true });
    await writeFile(join(seriesDir, path), prettyJson(value));
  };

  const ctx = createContext(
    JSON.parse(await readFile(join(seriesDir, "media.json"), "utf8")) as MediaIndex,
  );
  const course = courseKey(seriesKey("dw", dw.series), dw.course);
  const wanted = options.lessons;
  const courseState = await read("course.json");
  const all = courseLessons(course, courseState);
  const titles = new Map<LessonKey, string>();
  const goals = new Map<LessonKey, Record<GoalKey, string>>();
  let problems = 0;
  let unknownTotal = 0;
  let lessonsDone = 0;
  for (const [i, entry] of all.entries()) {
    if (wanted && !wanted.includes(i + 1)) continue;
    const lesson = await read(`l-${entry.sourceId}.json`);
    const exercises = new Map<number, ApolloState>();
    for (const id of exerciseIds(lesson, entry.sourceId))
      exercises.set(id, await read(`e-${id}.json`));
    const downloads = existsSync(join(seriesDir, rawDir, `le-${entry.sourceId}.json`))
      ? await read(`le-${entry.sourceId}.json`)
      : {};
    const out = normaliseLesson(ctx, {
      ...entry,
      edition: dw.edition,
      rawDir,
      lesson,
      downloads,
      exercises,
    });
    titles.set(entry.key, out.locale.title);
    goals.set(entry.key, out.goals);
    const { name } = parseLessonKey(entry.key);
    const files = [
      ...(primary
        ? [[Lesson, out.lesson, `canonical/${dw.course}/lessons/${name}.json`] as const]
        : []),
      [LocaleLesson, out.locale, `locale/${dw.edition}/${dw.course}/lessons/${name}.json`] as const,
    ];
    for (const [schema, value, path] of files) {
      const result = schema.safeParse(value);
      if (!result.success) {
        problems++;
        log(
          `${path}: ${result.error.issues
            .slice(0, 3)
            .map((x) => `${x.path.join(".")} ${x.message}`)
            .join("; ")}`,
        );
      }
      await write(path, value);
    }
    unknownTotal += out.lesson.unmapped.length;
    lessonsDone++;
  }
  if (!wanted) {
    const courseEntity = Object.entries(courseState).find(([k]) => k.startsWith("Course:"))?.[1];
    const files = courseFiles(
      course,
      dw.edition,
      courseState,
      all,
      titles,
      goals,
      html(ctx, courseEntity?.description),
    );
    for (const [schema, value, path] of [
      ...(primary
        ? [[CourseIndex, files.index, `canonical/${dw.course}/course.json`] as const]
        : []),
      [LocaleCourse, files.locale, `locale/${dw.edition}/${dw.course}/course.json`] as const,
    ]) {
      const result = schema.safeParse(value);
      if (!result.success) {
        problems++;
        log(
          `${path}: ${result.error.issues
            .slice(0, 3)
            .map((x) => `${x.path.join(".")} ${x.message}`)
            .join("; ")}`,
        );
      }
      await write(path, value);
    }
  }
  log(
    `${dw.course} ${dw.edition}: ${lessonsDone} lessons normalised${unknownTotal ? `, ${unknownTotal} unknown exercises` : ""}${problems ? `, ${problems} files failed validation` : ""}`,
  );
  return { lessons: lessonsDone, unknown: unknownTotal, problems };
}
