// Reading installed courses from the library folder (02, "Library layout"). Files are validated
// against the schemas on read; an invalid file is an error, never partially used.
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import {
  CourseIndex,
  type EditionId,
  issuesText,
  Lesson,
  type LessonKey,
  LocaleCourse,
  LocaleLesson,
  type MediaPath,
  parseLessonKey,
} from "@sprachanker/schema";
import type { z } from "zod";
import type { LibraryView } from "./library-view.ts";
import { verifyCourse } from "./verify.ts";

export type { InstalledCourse, LibraryView } from "./library-view.ts";

const dirs = (path: string) =>
  existsSync(path)
    ? readdirSync(path, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    : [];

async function read<S extends z.ZodType>(schema: S, file: string): Promise<z.infer<S>> {
  const result = schema.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!result.success) throw new Error(`${file}: ${issuesText(result.error, 1)}`);
  return result.data;
}

export function openLibrary(root: string): LibraryView {
  const seriesDir = (series: string) => join(root, series);
  const view: LibraryView = {
    root,
    courses() {
      return dirs(root)
        .sort()
        .flatMap((series) =>
          dirs(join(seriesDir(series), "canonical"))
            .sort()
            .filter((course) =>
              existsSync(join(seriesDir(series), "canonical", course, "course.json")),
            )
            .map((course) => ({
              series,
              course,
              editions: dirs(join(seriesDir(series), "locale"))
                .filter((e) =>
                  existsSync(join(seriesDir(series), "locale", e, course, "course.json")),
                )
                .sort() as EditionId[],
            })),
        );
    },
    courseIndex: (series, course) =>
      read(CourseIndex, join(seriesDir(series), "canonical", course, "course.json")),
    async localeCourse(series, course, edition) {
      const file = join(seriesDir(series), "locale", edition, course, "course.json");
      return existsSync(file) ? read(LocaleCourse, file) : undefined;
    },
    lesson(series, key) {
      const { courseId, name } = parseLessonKey(key);
      return read(
        Lesson,
        join(seriesDir(series), "canonical", courseId, "lessons", `${name}.json`),
      );
    },
    async localeLesson(series, key, edition) {
      const { courseId, name } = parseLessonKey(key);
      const file = join(seriesDir(series), "locale", edition, courseId, "lessons", `${name}.json`);
      return existsSync(file) ? read(LocaleLesson, file) : undefined;
    },
    mediaFile(series, path) {
      const base = join(seriesDir(series), "media") + sep;
      const file = normalize(join(seriesDir(series), path));
      return file.startsWith(base) && existsSync(file) ? file : undefined;
    },
    check(series, course) {
      const editions = view
        .courses()
        .find((c) => c.series === series && c.course === course)?.editions;
      return verifyCourse(view, series, course, editions ?? []);
    },
  };
  return view;
}
