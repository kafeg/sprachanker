// Normalisation of one downloaded course edition: raw pages → canonical/ and locale/ files (offline).
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  libraryWriter,
  type NormaliseResult,
  openKeyMap,
  readMediaIndex,
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
} from "@sprachanker/schema";
import { type ApolloState, exerciseIds } from "../apollo.ts";
import { type DwCourse, seriesId } from "../catalog.ts";

import { createContext, html } from "./context.ts";
import { courseFiles, courseLessons } from "./course.ts";
import { normaliseLesson } from "./lesson.ts";

export async function normaliseCourse(
  seriesDir: string,
  dw: DwCourse,
  options: { log: (line: string) => void },
): Promise<NormaliseResult> {
  const { log } = options;
  const rawDir = `raw/${dw.edition}/${dw.course}`;
  const read = async (file: string): Promise<ApolloState> =>
    JSON.parse(await readFile(join(seriesDir, rawDir, file), "utf8"));

  const ctx = createContext(await readMediaIndex(join(seriesDir, "media.json")));
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
      exerciseNumber: (id, position) => keys.number(entry.key, String(id), position),
    });
    titles.set(entry.key, out.locale.title);
    goals.set(entry.key, out.goals);
    const { name } = parseLessonKey(entry.key);
    await writer.write([
      { schema: Lesson, value: out.lesson, path: `canonical/${dw.id}/lessons/${name}.json` },
      {
        schema: LocaleLesson,
        value: out.locale,
        path: `locale/${dw.edition}/${dw.id}/lessons/${name}.json`,
      },
    ]);
    // Unknown: exercises of a mechanic not mapped; left out: what the source does not have (a gone
    // page) or a word that did not read — both listed in the lesson's `unmapped`.
    unknownTotal += out.lesson.pages.filter(
      (p) => "exercise" in p && p.exercise.type === "unknown",
    ).length;
    leftOut += out.lesson.unmapped.length;
    lessonsDone++;
  }
  const courseEntity = Object.entries(courseState).find(([k]) => k.startsWith("Course:"))?.[1];
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
  await writer.write([
    { schema: CourseIndex, value: files.index, path: `canonical/${dw.id}/course.json` },
    {
      schema: LocaleCourse,
      value: files.locale,
      path: `locale/${dw.edition}/${dw.id}/course.json`,
    },
  ]);
  await writer.finish();
  await keys.save();
  const { problems } = writer;
  log(
    `${dw.id} (${dw.edition}): ${lessonsDone} lessons normalised${unknownTotal ? `, ${unknownTotal} unknown exercises` : ""}${leftOut ? `, ${leftOut} parts left out (unmapped)` : ""}${problems ? `, ${problems} files failed validation` : ""}`,
  );
  return { lessons: lessonsDone, unknown: unknownTotal, problems };
}
