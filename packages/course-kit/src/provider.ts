// The provider contract (03): what an importer gets, what it reports, and how normalised files are
// written. Shared by every course provider so the server treats them alike.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { issuesText } from "@sprachanker/schema";
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
