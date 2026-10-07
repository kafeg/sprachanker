// The provider contract (03): what an importer gets, what it reports, and how normalised files are
// written. Shared by every course provider so the server treats them alike.
import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { type CourseSource, issuesText } from "@sprachanker/schema";
import type { z } from "zod";
import { prettyJson } from "./canonical-json.ts";
import { writeFileAtomic } from "./files.ts";

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
 * A course a provider offers (03): what the catalogue shows before anything is downloaded. Known
 * without the network; the size is an estimate measured on a full download.
 */
export interface CourseOffer {
  course: string;
  edition: string;
  title: string;
  source: CourseSource;
  /** Bytes on disk after a full download (pages and media), roughly. */
  approxBytes: number;
}

export interface NormaliseResult {
  lessons: number;
  /** Exercises of an unknown structure (`unknown` + report entry). */
  unknown: number;
  /** Files that failed validation. */
  problems: number;
}

export interface ImportReport {
  failedMedia: string[];
  /** By "<course> <edition>". */
  normalised: Record<string, NormaliseResult>;
}

/** A file the normaliser produces: its path in the series folder, its schema and its value. */
export interface LibraryFile {
  path: string;
  schema: z.ZodType;
  value: unknown;
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
    /** Removes what the written courses no longer have; returns the removed paths. */
    async finish(): Promise<string[]> {
      const removed: string[] = [];
      for (const folder of courses) {
        const dir = join(seriesDir, folder);
        for (const name of await readdir(dir, { recursive: true })) {
          const path = `${folder}/${name}`;
          if (!path.endsWith(".json") || written.has(path)) continue;
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
