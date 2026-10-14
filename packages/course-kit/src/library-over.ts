// Reading installed courses over a file system given (library.ts: the data folder through Node; the
// phone app: its own files). Files are validated against the schemas on read; an invalid file is an
// error, never partially used. No Node APIs: paths are POSIX, joined here.
import {
  CourseIndex,
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
  PracticeLesson,
  PracticeRecording,
  parseExamKey,
  parseLessonKey,
  SeriesKey,
  Slug,
} from "@sprachanker/schema";
import type { z } from "zod";
import { type CourseReport, type LibraryView, NotInstalledError } from "./library-view.ts";

/** What reading the library needs of a file system (absolute POSIX paths). */
export interface LibraryFs {
  /** The folders in a folder ([] when there is none). */
  dirs(path: string): string[];
  /** The files in a folder ([] when there is none). */
  files(path: string): string[];
  exists(path: string): boolean;
  /** A file's size and time of change, if it is there. */
  stat(path: string): { size: number; mtimeMs: number } | undefined;
  readText(path: string): Promise<string>;
}

/** Path parts joined, `.` and `..` resolved (POSIX). */
export function joinPath(...parts: string[]) {
  const absolute = parts[0]?.startsWith("/");
  const out: string[] = [];
  for (const part of parts.join("/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `${absolute ? "/" : ""}${out.join("/")}`;
}

export function libraryOver(
  root: string,
  fs: LibraryFs,
  check: (
    view: LibraryView,
    series: string,
    course: string,
    editions: string[],
  ) => Promise<CourseReport>,
): LibraryView {
  async function read<S extends z.ZodType>(schema: S, file: string): Promise<z.infer<S>> {
    if (!fs.exists(file)) throw new NotInstalledError(file);
    const result = schema.safeParse(JSON.parse(await fs.readText(file)));
    if (!result.success) throw new Error(`${file}: ${issuesText(result.error, 1)}`);
    return result.data;
  }
  // Only a series key names a folder: nothing from a request can point outside the library.
  const seriesDir = (series: string) => {
    if (!SeriesKey.safeParse(series).success) throw new NotInstalledError(series);
    return joinPath(root, series);
  };
  const named = (schema: z.ZodType, name: string) => {
    if (!schema.safeParse(name).success) throw new NotInstalledError(name);
    return name;
  };
  /** A lesson's canonical file, or with an edition its locale file. */
  const lessonFile = (series: string, key: LessonKey, edition?: string) => {
    const { courseId, name } = parseLessonKey(key);
    return edition === undefined
      ? joinPath(seriesDir(series), "canonical", courseId, "lessons", `${name}.json`)
      : joinPath(
          seriesDir(series),
          "locale",
          named(EditionId, edition),
          courseId,
          "lessons",
          `${name}.json`,
        );
  };
  /** A course's canonical file (`course.json`), or with an edition its locale file. */
  const courseFile = (series: string, course: string, edition?: string) =>
    edition === undefined
      ? joinPath(seriesDir(series), "canonical", named(Slug, course), "course.json")
      : joinPath(
          seriesDir(series),
          "locale",
          named(EditionId, edition),
          named(Slug, course),
          "course.json",
        );
  /** An exam's canonical file, or with an edition its locale file. */
  const examFile = (series: string, key: ExamKey, edition?: string) => {
    const { courseId, slug } = parseExamKey(key);
    const where =
      edition === undefined
        ? joinPath(seriesDir(series), "canonical", courseId)
        : joinPath(seriesDir(series), "locale", named(EditionId, edition), courseId);
    return joinPath(where, "exams", `${slug}.json`);
  };
  const stamp = (file: string) => {
    const stat = fs.stat(file);
    return stat ? `${stat.size}:${stat.mtimeMs}` : "";
  };
  /** A file of the series under `folder`, never outside it (`..` resolved first). */
  const inside = (series: string, folder: string, path: string) => {
    if (!SeriesKey.safeParse(series).success) return undefined;
    const base = `${joinPath(seriesDir(series), folder)}/`;
    const file = joinPath(seriesDir(series), path);
    return file.startsWith(base) && fs.exists(file) ? file : undefined;
  };
  const view: LibraryView = {
    root,
    courses() {
      return fs
        .dirs(root)
        .filter((series) => SeriesKey.safeParse(series).success)
        .sort()
        .flatMap((series) =>
          fs
            .dirs(joinPath(seriesDir(series), "canonical"))
            .sort()
            .filter((course) =>
              fs.exists(joinPath(seriesDir(series), "canonical", course, "course.json")),
            )
            .map((course) => ({
              series,
              course,
              editions: fs
                .dirs(joinPath(seriesDir(series), "locale"))
                .filter((e) =>
                  fs.exists(joinPath(seriesDir(series), "locale", e, course, "course.json")),
                )
                .sort() as EditionId[],
            })),
        );
    },
    courseIndex: (series, course) => read(CourseIndex, courseFile(series, course)),
    async localeCourse(series, course, edition) {
      const file = courseFile(series, course, edition);
      return fs.exists(file) ? read(LocaleCourse, file) : undefined;
    },
    courseStamp: (series, course, edition) => stamp(courseFile(series, course, edition)),
    lesson: (series, key) => read(Lesson, lessonFile(series, key)),
    async localeLesson(series, key, edition) {
      const file = lessonFile(series, key, edition);
      return fs.exists(file) ? read(LocaleLesson, file) : undefined;
    },
    lessonStamp: (series, key, edition) => stamp(lessonFile(series, key, edition)),
    exam: (series, key) => read(Exam, examFile(series, key)),
    async localeExam(series, key, edition) {
      const file = examFile(series, key, edition);
      return fs.exists(file) ? read(LocaleExam, file) : undefined;
    },
    examStamp: (series, key, edition) => stamp(examFile(series, key, edition)),
    async examSources(series, key) {
      const { courseId, slug } = parseExamKey(key);
      const file = joinPath(seriesDir(series), "canonical", courseId, "sources", `${slug}.json`);
      return fs.exists(file) ? read(ExamSources, file) : undefined;
    },
    rawFile: (series, path) => inside(series, "raw", path),
    async practice(series, key, edition) {
      const { courseId, name } = parseLessonKey(key);
      const file = joinPath(
        seriesDir(series),
        "practice",
        named(EditionId, edition),
        courseId,
        `${name}.json`,
      );
      return fs.exists(file) ? read(PracticeLesson, file) : undefined;
    },
    practiceLessons(series, course, edition) {
      const dir = joinPath(
        seriesDir(series),
        "practice",
        named(EditionId, edition),
        named(Slug, course),
      );
      return fs
        .files(dir)
        .filter((f) => /^\d{2,}-\d{2,}\.json$/.test(f))
        .map((f) => f.slice(0, -".json".length))
        .sort();
    },
    practiceFile(series, path) {
      if (!SeriesKey.safeParse(series).success || !PracticeRecording.safeParse(path).success)
        return undefined;
      const file = joinPath(seriesDir(series), path);
      return fs.exists(file) ? file : undefined;
    },
    mediaFile: (series, path) => inside(series, "media", path),
    check(series, course) {
      const editions = view
        .courses()
        .find((c) => c.series === series && c.course === course)?.editions;
      return check(view, series, course, editions ?? []);
    },
  };
  return view;
}
