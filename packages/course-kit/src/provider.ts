// The provider contract (03): what an importer gets, what it reports, and how normalised files are
// written. Shared by every course provider so the server treats them alike.
import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  CourseIndex,
  type CourseSource,
  courseIdOf,
  Exam,
  ExamSources,
  issuesText,
  Lesson,
  LocaleCourse,
  LocaleExam,
  LocaleLesson,
  parseExamKey,
  parseLessonKey,
} from "@sprachanker/schema";
import type { z } from "zod";
import { prettyJson } from "./canonical-json.ts";
import { isTempFile, writeFileAtomic } from "./files.ts";

export interface ImportOptions {
  /** Library folder of the data root. */
  libraryRoot: string;
  /** Only these courses / editions, where the provider has several. */
  courses?: string[];
  editions?: string[];
  /** Fetch pages again to pick up changes at the source; media already stored are kept. */
  refresh?: boolean;
  log: (line: string) => void;
  /** Where the import is, for a progress display (the download job, 06). */
  progress?: ProgressSink;
}

/**
 * How far an import is: pages read or fetched (their total is often unknown until the end), media
 * fetched of those still missing (with their bytes), normalising.
 */
export type ImportProgress =
  | { phase: "pages"; done: number }
  | { phase: "media"; done: number; total: number; bytes: number }
  | { phase: "normalise" };
export type ProgressSink = (progress: ImportProgress) => void;

/** Whether an import asked for this course and edition (`--courses`, `--editions`; none: all). A
 *  course is named by its id or by its source name. */
export const wanted = (options: ImportOptions, edition: string, ...names: string[]) =>
  (!options.courses || names.some((n) => options.courses?.includes(n))) &&
  (!options.editions || options.editions.includes(edition));

/** Counts pages as an importer reads or fetches them; call the result once per page. */
export function pageCounter(sink: ProgressSink | undefined): () => void {
  let done = 0;
  return () => sink?.({ phase: "pages", done: ++done });
}

/**
 * A content provider as the server sees it (03): its id (the CLI's and the downloads'), the series
 * folder it writes, the courses it offers, and its import. Every provider package exports its own
 * (DW one per series); the server lists them and tests them all against this contract.
 */
export interface CourseProvider {
  id: string;
  series: string;
  offers: CourseOffer[];
  import(options: ImportOptions): Promise<ImportReport>;
}

/**
 * A course a provider offers (03): what the catalogue shows before anything is downloaded. Known
 * without the network; the size is an estimate measured on a full download.
 */
export interface CourseOffer {
  course: string;
  edition: string;
  /** An exam is offered in the Exams section, not among the courses (01: a course of kind exam has
   *  exams only). */
  kind?: "exam";
  title: string;
  source: CourseSource;
  /** Bytes on disk after a full download (pages and media), roughly. */
  approxBytes: number;
  /** Ready for learning (03): shown as it is. An offer without it is experimental — shown only when
   *  the learner turns it on (Settings → Experimental). */
  stable?: true;
}

export interface NormaliseResult {
  lessons: number;
  /** Exercises of an unknown structure (`unknown` + report entry). */
  unknown: number;
  /** Files that failed validation. */
  problems: number;
}

export interface ImportReport {
  /** Media not fetched that may be on a later run: the course is incomplete. */
  failedMedia: string[];
  /** Media the source no longer has (404, 410): reported, the course complete without them. */
  goneMedia: string[];
  /** By "<course> <edition>". */
  normalised: Record<string, NormaliseResult>;
}

/** A file the normaliser produces: its path in the series folder, its schema and its value. Made by
 *  `libraryFile`, which ties the value to its kind's schema and the path to its keys. */
export interface LibraryFile {
  path: string;
  schema: z.ZodType;
  value: unknown;
}

/** The library's files by kind (02, "Library layout"): each from its value, its path from its keys. */
export const libraryFile = {
  lesson: (value: Lesson): LibraryFile => {
    const { courseId, name } = parseLessonKey(value.key);
    return { path: `canonical/${courseId}/lessons/${name}.json`, schema: Lesson, value };
  },
  localeLesson: (value: LocaleLesson): LibraryFile => {
    const { courseId, name } = parseLessonKey(value.lesson);
    return {
      path: `locale/${value.edition}/${courseId}/lessons/${name}.json`,
      schema: LocaleLesson,
      value,
    };
  },
  course: (value: CourseIndex): LibraryFile => ({
    path: `canonical/${courseIdOf(value.key)}/course.json`,
    schema: CourseIndex,
    value,
  }),
  localeCourse: (value: LocaleCourse): LibraryFile => ({
    path: `locale/${value.edition}/${courseIdOf(value.course)}/course.json`,
    schema: LocaleCourse,
    value,
  }),
  exam: (value: Exam): LibraryFile => ({
    path: `canonical/${examFile(value.key)}`,
    schema: Exam,
    value,
  }),
  localeExam: (value: LocaleExam): LibraryFile => ({
    path: `locale/${value.edition}/${examFile(value.exam)}`,
    schema: LocaleExam,
    value,
  }),
  examSources: (value: ExamSources): LibraryFile => ({
    path: `canonical/${examSourcesFile(value.exam)}`,
    schema: ExamSources,
    value,
  }),
};

/** Where an exam's sources are: `<course id>/sources/<slug>.json` (beside its exams, not among them). */
export function examSourcesFile(key: string) {
  const { courseId, slug } = parseExamKey(key);
  return `${courseId}/sources/${slug}.json`;
}

/** An exam's file under its course's folder: `<course>/exam-<slug>` → `<course id>/exams/<slug>.json`. */
export function examFile(key: string) {
  const { courseId, slug } = parseExamKey(key);
  return `${courseId}/exams/${slug}.json`;
}

/** The course folder a library file belongs to: `canonical/<course>` or `locale/<edition>/<course>`. */
function courseFolder(path: string): string | undefined {
  const parts = path.split("/");
  if (parts[0] === "canonical" && parts.length > 2) return parts.slice(0, 2).join("/");
  if (parts[0] === "locale" && parts.length > 3) return parts.slice(0, 3).join("/");
  return undefined;
}

/**
 * Writes the normalised files of one normalisation (one call or many — a provider may write lesson by
 * lesson), each validated and replaced whole. `finish` then removes the files of those courses this
 * normalisation no longer produced (a lesson the source dropped or renumbered), so the library holds
 * exactly what the source has now.
 */
export function libraryWriter(seriesDir: string, log: (line: string) => void) {
  const written = new Set<string>();
  const courses = new Set<string>();
  let problems = 0;
  return {
    /** Validates and writes files; a failing file is still written, so the library shows the error
     *  where the file is read instead of a stale earlier version. */
    async write(files: LibraryFile[]) {
      for (const file of files) {
        const result = file.schema.safeParse(file.value);
        if (!result.success) {
          problems++;
          log(`${file.path}: ${issuesText(result.error)}`);
        }
        await writeFileAtomic(join(seriesDir, file.path), prettyJson(file.value));
        written.add(file.path);
        const folder = courseFolder(file.path);
        if (folder) courses.add(folder);
      }
    },
    /** Files that failed validation so far. */
    get problems() {
      return problems;
    },
    /** Removes what the written courses no longer have, and the temporary files a normalisation cut
     *  short left there (an import holds its series: none is being written now); returns the removed
     *  paths. */
    async finish(): Promise<string[]> {
      const removed: string[] = [];
      for (const folder of courses) {
        const dir = join(seriesDir, folder);
        for (const name of await readdir(dir, { recursive: true })) {
          const path = `${folder}/${name}`;
          const stale = path.endsWith(".json") ? !written.has(path) : isTempFile(path);
          if (!stale) continue;
          await rm(join(seriesDir, path), { force: true });
          removed.push(path);
        }
      }
      if (removed.length) log(`removed ${removed.length} files the source no longer has`);
      return removed;
    },
  };
}

/** Writes the files of a whole normalisation at once (`libraryWriter`); returns how many failed
 *  validation. */
export async function writeLibraryFiles(
  seriesDir: string,
  files: LibraryFile[],
  log: (line: string) => void,
): Promise<number> {
  const writer = libraryWriter(seriesDir, log);
  await writer.write(files);
  await writer.finish();
  return writer.problems;
}

/** A raw page fetched once and stored as `file`; later runs read the stored copy unless `refresh`. */
export async function storedPage(
  file: string,
  fetchText: () => Promise<string>,
  refresh = false,
): Promise<string> {
  if (!refresh && existsSync(file)) return readFile(file, "utf8");
  const text = await fetchText();
  // Whole or not at all: a page cut off by a crash would be taken as stored.
  await writeFileAtomic(file, text);
  return text;
}
