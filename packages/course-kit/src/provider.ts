// The provider contract (03): what an importer gets, what it reports, and how normalised files are
// written. Shared by every course provider so the server treats them alike.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type CourseSource, issuesText } from "@sprachanker/schema";
import type { z } from "zod";
import { prettyJson } from "./canonical-json.ts";

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

/**
 * Validates and writes normalised files; returns how many failed validation. A failing file is still
 * written, so the library shows the error where the file is read instead of a stale earlier version.
 */
export async function writeLibraryFiles(
  seriesDir: string,
  files: LibraryFile[],
  log: (line: string) => void,
): Promise<number> {
  let problems = 0;
  for (const file of files) {
    const result = file.schema.safeParse(file.value);
    if (!result.success) {
      problems++;
      log(`${file.path}: ${issuesText(result.error)}`);
    }
    const target = join(seriesDir, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, prettyJson(file.value));
  }
  return problems;
}

/** A raw page fetched once and stored as `file`; later runs read the stored copy unless `refresh`. */
export async function storedPage(
  file: string,
  fetchText: () => Promise<string>,
  refresh = false,
): Promise<string> {
  if (!refresh && existsSync(file)) return readFile(file, "utf8");
  const text = await fetchText();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
  return text;
}
