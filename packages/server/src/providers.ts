// Content providers the server can import (03): the catalogue of what they offer, the CLI import and the
// download job (06). Downloads are marked on disk (`<series>/.downloads/<course>.json`) while they run,
// and kept marked when media failed, so the state survives a restart: an interrupted download resumes.
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DIB_PROVIDER } from "@sprachanker/coerll-dib";
import {
  type CourseProvider,
  type ImportReport,
  openLibrary,
  type ProgressSink,
} from "@sprachanker/course-kit";
import { DW_PROVIDERS } from "@sprachanker/dw";
import { LINGUST_PROVIDER } from "@sprachanker/lingust-english";
import { ENGLISH_USA_PROVIDER } from "@sprachanker/voa-english-usa";
import { LETS_LEARN_ENGLISH_PROVIDER } from "@sprachanker/voa-lets-learn-english";
import type { CourseInstaller } from "./services/downloads.ts";

export interface ImportRequest {
  dataRoot: string;
  courses?: string[];
  editions?: string[];
  refresh?: boolean;
  log: (line: string) => void;
  progress?: ProgressSink;
}

/** Every content provider, by id: its series folder, its courses (all offered in Courses → Available)
 *  and its importer (course-kit's `CourseProvider`). */
export const PROVIDERS: CourseProvider[] = [
  ...DW_PROVIDERS,
  DIB_PROVIDER,
  LINGUST_PROVIDER,
  ENGLISH_USA_PROVIDER,
  LETS_LEARN_ENGLISH_PROVIDER,
];
const byId = new Map(PROVIDERS.map((p) => [p.id, p]));

export const providerIds = () => PROVIDERS.map((p) => p.id);

/**
 * Runs a provider into `<dataRoot>/library`. One import per series at a time, across processes (the
 * CLI and a server's download job share media.json): a lock folder with the owner's pid; a lock whose
 * process is gone is taken over.
 */
export async function importCourse(
  provider: string,
  request: ImportRequest,
): Promise<ImportReport> {
  const entry = byId.get(provider);
  if (!entry) throw new Error(`unknown provider ${provider}; known: ${providerIds().join(", ")}`);
  const libraryRoot = join(request.dataRoot, "library");
  const lock = join(libraryRoot, entry.series, ".import-lock");
  await mkdir(join(libraryRoot, entry.series), { recursive: true });
  await takeLock(lock, entry.series);
  try {
    return await entry.import({ ...request, libraryRoot });
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

/**
 * Takes the lock folder with this process's pid already in it: the folder is made elsewhere and
 * renamed into place, so another process never sees the lock without its owner. A lock whose process
 * is gone is taken over.
 */
async function takeLock(lock: string, series: string) {
  const mine = `${lock}.${process.pid}-${Date.now()}`;
  await mkdir(mine, { recursive: true });
  await writeFile(join(mine, "pid"), String(process.pid));
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(mine, lock);
      return;
    } catch {
      const owner = Number(await readFile(join(lock, "pid"), "utf8").catch(() => "0"));
      if (owner && owner !== process.pid && alive(owner)) {
        await rm(mine, { recursive: true, force: true });
        throw new Error(`${series} is being imported by another process (pid ${owner})`);
      }
      if (attempt > 2) {
        await rm(mine, { recursive: true, force: true });
        throw new Error(`could not take the import lock of ${series}`);
      }
      // A stale lock (its process is gone): removed, then taken.
      await rm(lock, { recursive: true, force: true });
    }
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * A download marker: written when it starts; `failed` once it ended with media of the course missing;
 * `error` when it stopped with an error (then it waits for the learner instead of resuming).
 */
interface Marker {
  startedAt: number;
  failed?: number;
  error?: string;
}

/**
 * How a download that ran ended: files that did not fit their schema (written all the same, so where
 * they are read they say so — 02) make it an error, as they make the CLI's import fail; media still
 * missing — referenced but not on disk (`missingOnDisk`), or not fetched at all (failed, refused: a
 * normaliser leaves out what it does not have, so the check alone would not see those) — leave it
 * incomplete; else it is done.
 */
export function downloadEnd(
  report: ImportReport,
  missingOnDisk: number,
): { error: string } | { failed: number } {
  const invalid = Object.values(report.normalised).reduce((n, r) => n + r.problems, 0);
  if (invalid) return { error: `${invalid} files failed validation (listed in the log)` };
  return { failed: missingOnDisk + report.failedMedia.length };
}

/** Downloads through the providers into `<dataRoot>/library` (the server's CourseInstaller). */
export function courseInstaller(dataRoot: string, now: () => number = Date.now): CourseInstaller {
  const library = join(dataRoot, "library");
  const markerFile = (series: string, course: string) =>
    join(library, series, ".downloads", `${course}.json`);
  return {
    offers: () => PROVIDERS.flatMap((p) => p.offers.map((o) => ({ ...o, series: p.series }))),

    async run(series, course, { log, progress }) {
      const provider = PROVIDERS.find((p) => p.series === series)?.id;
      if (!provider) throw new Error(`no provider writes ${series}`);
      const marker = markerFile(series, course);
      await mkdir(join(library, series, ".downloads"), { recursive: true });
      const startedAt = now();
      const mark = (m: Marker) => writeFile(marker, JSON.stringify(m satisfies Marker));
      await mark({ startedAt });
      let report: ImportReport;
      try {
        report = await importCourse(provider, { dataRoot, courses: [course], log, progress });
      } catch (error) {
        await mark({ startedAt, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
      const missing = (await openLibrary(library).check(series, course)).media.missing;
      const end = downloadEnd(report, missing);
      if ("error" in end) {
        await mark({ startedAt, error: end.error });
        throw new Error(end.error);
      }
      if (end.failed) await mark({ startedAt, failed: end.failed });
      else await rm(marker, { force: true });
      return report;
    },

    async unfinished() {
      const out: Awaited<ReturnType<CourseInstaller["unfinished"]>> = [];
      for (const series of existsSync(library) ? await readdir(library) : []) {
        const dir = join(library, series, ".downloads");
        if (!existsSync(dir)) continue;
        for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json"))) {
          // A marker cut short (the process stopped while writing it) reads as an interrupted download.
          const marker = await readFile(join(dir, file), "utf8")
            .then((text) => JSON.parse(text) as Marker)
            .catch((): Marker => ({ startedAt: 0 }));
          out.push({
            series,
            course: file.slice(0, -5),
            failed: marker.failed,
            ...(marker.error ? { error: marker.error } : {}),
          });
        }
      }
      return out;
    },

    async storage() {
      const series: Array<{ series: string; bytes: number }> = [];
      const entries = existsSync(library) ? await readdir(library, { withFileTypes: true }) : [];
      for (const entry of entries.filter((e) => e.isDirectory()))
        series.push({ series: entry.name, bytes: await folderBytes(join(library, entry.name)) });
      const disk = await statfs(dataRoot).catch(() => undefined);
      return { dataRoot, series, free: disk ? disk.bavail * disk.bsize : null };
    },
  };
}

async function folderBytes(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? await folderBytes(path) : (await stat(path)).size;
  }
  return total;
}
