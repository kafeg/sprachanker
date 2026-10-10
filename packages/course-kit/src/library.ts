// Reading installed courses from the library folder (02, "Library layout"). Files are validated
// against the schemas on read; an invalid file is an error, never partially used.
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import {
  CourseIndex,
  CourseSlug,
  EditionId,
  Exam,
  type ExamKey,
  ExamSources,
  issuesText,
  Lesson,
  type LessonKey,
  LocaleCourse,
  LocaleExam,
  LocaleLesson,
  parseExamKey,
  parseLessonKey,
  SeriesKey,
} from "@sprachanker/schema";
import type { z } from "zod";
import { type LibraryView, NotInstalledError } from "./library-view.ts";
import { verifyCourse } from "./verify.ts";

export { type InstalledCourse, type LibraryView, NotInstalledError } from "./library-view.ts";

const dirs = (path: string) =>
  existsSync(path)
    ? readdirSync(path, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    : [];

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
  /** A lesson's canonical file, or with an edition its locale file. */
  const lessonFile = (series: string, key: LessonKey, edition?: string) => {
    const { courseId, name } = parseLessonKey(key);
    return edition === undefined
      ? join(seriesDir(series), "canonical", courseId, "lessons", `${name}.json`)
      : join(
          seriesDir(series),
          "locale",
          named(EditionId, edition),
          courseId,
          "lessons",
          `${name}.json`,
        );
  };
  /** An exam's canonical file, or with an edition its locale file. */
  const examFile = (series: string, key: ExamKey, edition?: string) => {
    const { courseId, slug } = parseExamKey(key);
    const where =
      edition === undefined
        ? join(seriesDir(series), "canonical", courseId)
        : join(seriesDir(series), "locale", named(EditionId, edition), courseId);
    return join(where, "exams", `${slug}.json`);
  };
  const stamp = (file: string) => {
    const stat = statSync(file, { throwIfNoEntry: false });
    return stat ? `${stat.size}:${stat.mtimeMs}` : "";
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
    lesson: (series, key) => read(Lesson, lessonFile(series, key)),
    async localeLesson(series, key, edition) {
      const file = lessonFile(series, key, edition);
      return existsSync(file) ? read(LocaleLesson, file) : undefined;
    },
    lessonStamp: (series, key, edition) => stamp(lessonFile(series, key, edition)),
    exam: (series, key) => read(Exam, examFile(series, key)),
    async localeExam(series, key, edition) {
      const file = examFile(series, key, edition);
      return existsSync(file) ? read(LocaleExam, file) : undefined;
    },
    examStamp: (series, key, edition) => stamp(examFile(series, key, edition)),
    async examSources(series, key) {
      const { courseId, slug } = parseExamKey(key);
      const file = join(seriesDir(series), "canonical", courseId, "sources", `${slug}.json`);
      return existsSync(file) ? read(ExamSources, file) : undefined;
    },
    rawFile(series, path) {
      if (!SeriesKey.safeParse(series).success) return undefined;
      const base = join(seriesDir(series), "raw") + sep;
      const file = normalize(join(seriesDir(series), path));
      return file.startsWith(base) && existsSync(file) ? file : undefined;
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
