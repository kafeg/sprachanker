// Reading installed courses from the library folder (02, "Library layout"). Files are validated
// against the schemas on read; an invalid file is an error, never partially used.
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import {
  CourseIndex,
  type EditionId,
  Lesson,
  type LessonKey,
  LocaleCourse,
  LocaleLesson,
  type MediaPath,
  parseLessonKey,
} from "@sprachanker/schema";
import type { z } from "zod";

export interface InstalledCourse {
  series: string;
  /** Course id inside the series (`a1`). */
  course: string;
  editions: EditionId[];
}

export interface LibraryView {
  root: string;
  courses(): InstalledCourse[];
  courseIndex(series: string, course: string): Promise<CourseIndex>;
  localeCourse(series: string, course: string, edition: string): Promise<LocaleCourse | undefined>;
  lesson(series: string, key: LessonKey): Promise<Lesson>;
  localeLesson(series: string, key: LessonKey, edition: string): Promise<LocaleLesson | undefined>;
  /** Absolute file of a media path, or undefined when it does not exist or leaves the media folder. */
  mediaFile(series: string, path: MediaPath | string): string | undefined;
}

const dirs = (path: string) =>
  existsSync(path)
    ? readdirSync(path, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    : [];

async function read<S extends z.ZodType>(schema: S, file: string): Promise<z.infer<S>> {
  const result = schema.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!result.success)
    throw new Error(
      `${file}: ${result.error.issues[0]?.path.join(".")} ${result.error.issues[0]?.message}`,
    );
  return result.data;
}

export function openLibrary(root: string): LibraryView {
  const seriesDir = (series: string) => join(root, series);
  return {
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
  };
}
