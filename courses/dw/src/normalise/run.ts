// Normalisation of one downloaded course edition: raw pages → canonical/ and locale/ files (offline).
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  alignLocale,
  type MediaIndex,
  type NormaliseResult,
  writeLibraryFiles,
} from "@sprachanker/course-kit";
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

export async function normaliseCourse(
  seriesDir: string,
  dw: DwCourse,
  options: { lessons?: number[]; log: (line: string) => void },
): Promise<NormaliseResult> {
  const { log } = options;
  const rawDir = `raw/${dw.edition}/${dw.course}`;
  // Canonical files come from the course's first edition (normalised first); another edition adds its
  // locale files, re-keyed onto the canonical lessons by content (course-kit align).
  const primary = COURSES.find((c) => c.series === dw.series && c.course === dw.course) === dw;
  const read = async (file: string): Promise<ApolloState> =>
    JSON.parse(await readFile(join(seriesDir, rawDir, file), "utf8"));

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
  // Another edition against the canonical lessons: what could not be matched.
  const unaligned = { exercises: 0, approximate: 0, words: 0 };
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
    let locale = out.locale;
    if (!primary) {
      const file = join(seriesDir, `canonical/${dw.course}/lessons/${name}.json`);
      if (!existsSync(file)) {
        log(`${entry.key}: no canonical lesson yet (normalise the primary edition first)`);
        continue;
      }
      const aligned = alignLocale(
        Lesson.parse(JSON.parse(await readFile(file, "utf8"))),
        out.lesson,
        out.locale,
      );
      locale = aligned.locale;
      const r = aligned.report;
      unaligned.exercises += r.unmatchedExercises.length;
      unaligned.approximate += r.approximate.length;
      unaligned.words += r.unmatchedWords.length;
      for (const key of r.unmatchedExercises)
        log(`${dw.edition} ${key}: not in the canonical lesson`);
    }
    problems += await writeLibraryFiles(
      seriesDir,
      [
        ...(primary
          ? [
              {
                schema: Lesson,
                value: out.lesson,
                path: `canonical/${dw.course}/lessons/${name}.json`,
              },
            ]
          : []),
        {
          schema: LocaleLesson,
          value: locale,
          path: `locale/${dw.edition}/${dw.course}/lessons/${name}.json`,
        },
      ],
      log,
    );
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
    problems += await writeLibraryFiles(
      seriesDir,
      [
        ...(primary
          ? [
              {
                schema: CourseIndex,
                value: files.index,
                path: `canonical/${dw.course}/course.json`,
              },
            ]
          : []),
        {
          schema: LocaleCourse,
          value: files.locale,
          path: `locale/${dw.edition}/${dw.course}/course.json`,
        },
      ],
      log,
    );
  }
  if (!primary)
    log(
      `${dw.course} ${dw.edition} aligned: ${unaligned.exercises} exercises and ${unaligned.words} words not in the canonical lessons, ${unaligned.approximate} paired by position (edited)`,
    );
  log(
    `${dw.course} ${dw.edition}: ${lessonsDone} lessons normalised${unknownTotal ? `, ${unknownTotal} unknown exercises` : ""}${problems ? `, ${problems} files failed validation` : ""}`,
  );
  return { lessons: lessonsDone, unknown: unknownTotal, problems };
}
