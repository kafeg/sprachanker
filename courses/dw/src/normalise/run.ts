// Normalisation of one downloaded course edition: raw pages → canonical/ and locale/ files (offline).
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  libraryFile,
  libraryWriter,
  type NormaliseResult,
  openKeyMap,
  readMediaIndex,
} from "@sprachanker/course-kit";
import { courseKey, type GoalKey, type LessonKey } from "@sprachanker/schema";
import { type ApolloState, entitiesOf, exerciseIds } from "../apollo.ts";
import { type DwCourse, seriesId } from "../catalog.ts";
import { rawDir as rawDirOf } from "../pages.ts";

import { createContext, html } from "./context.ts";
import { courseCorrections } from "./corrections.ts";
import { courseFiles, courseLessons } from "./course.ts";
import { normaliseLesson } from "./lesson.ts";

export async function normaliseCourse(
  seriesDir: string,
  dw: DwCourse,
  options: { log: (line: string) => void },
): Promise<NormaliseResult> {
  const { log } = options;
  const rawDir = rawDirOf(dw);
  const read = async (file: string): Promise<ApolloState> =>
    JSON.parse(await readFile(join(seriesDir, rawDir, file), "utf8"));

  const ctx = createContext(await readMediaIndex(seriesDir), dw.edition);
  const course = courseKey(seriesId(dw.series), dw.id);
  const writer = libraryWriter(seriesDir, log);
  const courseState = await read("course.json");
  const keys = await openKeyMap(seriesDir);
  const all = courseLessons(course, courseState, keys);
  const titles = new Map<LessonKey, string>();
  const goals = new Map<LessonKey, Record<GoalKey, string>>();
  let unknownTotal = 0;
  let leftOut = 0;
  let lessonsDone = 0;
  const corrections = courseCorrections(course);
  for (const entry of all) {
    const lesson = await read(`l-${entry.sourceId}.json`);
    const exercises = new Map<number, ApolloState>();
    // A page the source no longer serves was not stored: the lesson goes on without it.
    for (const id of exerciseIds(lesson, entry.sourceId))
      if (existsSync(join(seriesDir, rawDir, `e-${id}.json`)))
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
      exerciseNumber: (occurrence, position) => keys.number(entry.key, occurrence, position),
    });
    corrections.lesson(out.locale);
    titles.set(entry.key, out.locale.title);
    goals.set(entry.key, out.goals);
    await writer.write([libraryFile.lesson(out.lesson), libraryFile.localeLesson(out.locale)]);
    // Unknown: exercises of a mechanic not mapped; left out: what the source does not have (a gone
    // page) or a word that did not read — both listed in the lesson's `unmapped`.
    unknownTotal += out.lesson.pages.filter(
      (p) => "exercise" in p && p.exercise.type === "unknown",
    ).length;
    leftOut += out.lesson.unmapped.length;
    lessonsDone++;
  }
  const courseEntity = entitiesOf(courseState, "Course")[0];
  const files = courseFiles(
    course,
    dw.edition,
    courseState,
    all,
    titles,
    goals,
    html(ctx, courseEntity?.description),
    dw.course,
  );
  await writer.write([libraryFile.course(files.index), libraryFile.localeCourse(files.locale)]);
  await writer.finish();
  await keys.save();
  const { problems } = writer;
  const fixed = corrections.report();
  for (const name of fixed?.stale ?? [])
    log(`correction not applied (its source text not found): ${name}`);
  log(
    `${dw.id} (${dw.edition}): ${lessonsDone} lessons normalised${unknownTotal ? `, ${unknownTotal} unknown exercises` : ""}${leftOut ? `, ${leftOut} parts left out (unmapped)` : ""}${problems ? `, ${problems} files failed validation` : ""}`,
  );
  return {
    lessons: lessonsDone,
    unknown: unknownTotal,
    problems,
    ...(fixed && { corrections: fixed }),
  };
}
