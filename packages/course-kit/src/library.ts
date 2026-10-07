// Reading installed courses from the library folder (02, "Library layout"). Files are validated
// against the schemas on read; an invalid file is an error, never partially used.
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import {
  CourseIndex,
  CourseSlug,
  EditionId,
  issuesText,
  Lesson,
  LocaleCourse,
  LocaleLesson,
  parseLessonKey,
  SeriesKey,
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

/** A course, lesson or file that is not in the library (a stale link, a course removed). */
export class NotInstalledError extends Error {}

async function read<S extends z.ZodType>(schema: S, file: string): Promise<z.infer<S>> {
  if (!existsSync(file)) throw new NotInstalledError(file);
  const result = schema.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!result.success) throw new Error(`${file}: ${issuesText(result.error, 1)}`);
  return result.data;
}

export function openLibrary(root: string): LibraryView {
  // Only a series key names a folder: nothing from a request can point outside the library.
  const seriesDir = (series: string) => {
    if (!SeriesKey.safeParse(series).success) throw new NotInstalledError(series);
    return join(root, series);
  };
  const named = (schema: z.ZodType, name: string) => {
    if (!schema.safeParse(name).success) throw new NotInstalledError(name);
    return name;
  };
  const view: LibraryView = {
    root,
    courses() {
      return dirs(root)
        .filter((series) => SeriesKey.safeParse(series).success)
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
      read(
        CourseIndex,
        join(seriesDir(series), "canonical", named(CourseSlug, course), "course.json"),
      ),
    async localeCourse(series, course, edition) {
      const file = join(
        seriesDir(series),
        "locale",
        named(EditionId, edition),
        named(CourseSlug, course),
        "course.json",
      );
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
      const file = join(
        seriesDir(series),
        "locale",
        named(EditionId, edition),
        courseId,
        "lessons",
        `${name}.json`,
      );
      return existsSync(file) ? read(LocaleLesson, file) : undefined;
    },
    mediaFile(series, path) {
      if (!SeriesKey.safeParse(series).success) return undefined;
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
