// Content providers the server can import: the catalogue of what they offer, the CLI import and the
// download job. Downloads are marked on disk (`<series>/.downloads/<course>.json`) while they run,
// and kept marked when media failed, so the state survives a restart: an interrupted download resumes.
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LID_PROVIDER } from "@sprachanker/bamf-lid";
import { DIB_PROVIDER } from "@sprachanker/coerll-dib";
import {
  type CourseProvider,
  type ImportReport,
  openLibrary,
  type ProgressSink,
  type RemovedCourse,
  removeCourse,
  SERIES_LOCK,
} from "@sprachanker/course-kit";
import { DW_PROVIDERS } from "@sprachanker/dw";
import { GOETHE_PROVIDER } from "@sprachanker/goethe";
import { LINGUST_PROVIDER } from "@sprachanker/lingust-english";
import { DownloadMarker } from "@sprachanker/schema";
import { ENGLISH_USA_PROVIDER } from "@sprachanker/voa-english-usa";
import { LETS_LEARN_ENGLISH_PROVIDER } from "@sprachanker/voa-lets-learn-english";
import { sprachAnkerRuns } from "./runtime/data-root.ts";
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
  LID_PROVIDER,
  GOETHE_PROVIDER,
];
const byId = new Map(PROVIDERS.map((p) => [p.id, p]));

export const providerIds = () => PROVIDERS.map((p) => p.id);

/** The provider that writes a series (none for a series no provider writes: the fixture's). */
export const providerOf = (series: string) =>
  PROVIDERS.find((p) => p.series === series)?.id ?? null;

/** A download's marker of a course: `<series>/.downloads/<course>.json` in the library. */
export const downloadMarker = (libraryRoot: string, series: string, course: string) =>
  join(libraryRoot, series, ".downloads", `${course}.json`);

/** A series another import holds (SERIES_BUSY: the transfers' 409 `series_busy`). */
const seriesBusy = (series: string, pid?: number) =>
  Object.assign(
    new Error(`${series} is being imported${pid ? ` by another process (pid ${pid})` : ""}`),
    { code: "SERIES_BUSY" },
  );

/** The series folders this process holds or waits for, each the end of its queue. */
const heldHere = new Map<string, Promise<void>>();

/**
 * Work that writes a series' shared files (media.json, keys.json): one at a time per series — in
 * this process, in turn (a course bundle installed while a download of its series runs waits for
 * it); across processes (the CLI beside a server) a lock folder with the owner's pid, a lock whose
 * process is gone (or is no SprachAnker) taken over. A lock another process holds is an error of
 * code SERIES_BUSY, and so is one held here when `wait` is false (a course's export: not
 * kept waiting while a download runs).
 */
export async function withSeriesLock<T>(
  libraryRoot: string,
  series: string,
  work: () => Promise<T>,
  options: { wait?: boolean } = {},
): Promise<T> {
  const folder = join(libraryRoot, series);
  if (options.wait === false && heldHere.has(folder)) throw seriesBusy(series);
  const before = heldHere.get(folder) ?? Promise.resolve();
  let release = () => {};
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queue = before.then(() => mine);
  heldHere.set(folder, queue);
  await before;
  try {
    const lock = join(folder, SERIES_LOCK);
    await mkdir(folder, { recursive: true });
    await takeLock(lock, series);
    try {
      return await work();
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  } finally {
    release();
    if (heldHere.get(folder) === queue) heldHere.delete(folder);
  }
}

/** Runs a provider into `<dataRoot>/library`, one import per series at a time (withSeriesLock). */
export async function importCourse(
  provider: string,
  request: ImportRequest,
): Promise<ImportReport> {
  const entry = byId.get(provider);
  if (!entry) throw new Error(`unknown provider ${provider}; known: ${providerIds().join(", ")}`);
  const libraryRoot = join(request.dataRoot, "library");
  return withSeriesLock(libraryRoot, entry.series, () => entry.import({ ...request, libraryRoot }));
}

/** A course removed from `<dataRoot>/library` under its series' lock: its files no other course of
 *  the series uses, and its download's marker (course-kit's removeCourse). What was made for its
 *  words (its deck folder in `decks/`) stays, as its practice does. */
export const removeInstalledCourse = (
  dataRoot: string,
  series: string,
  course: string,
): Promise<RemovedCourse> => {
  const libraryRoot = join(dataRoot, "library");
  return withSeriesLock(libraryRoot, series, () => removeCourse(libraryRoot, series, course));
};

/**
 * Takes the lock folder with this process's pid already in it: the folder is made elsewhere and
 * renamed into place, so another process never sees the lock without its owner. A lock whose process
 * is gone (or is no SprachAnker) is taken over.
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
      if (owner && owner !== process.pid && sprachAnkerRuns(owner)) {
        await rm(mine, { recursive: true, force: true });
        throw seriesBusy(series, owner);
      }
      if (attempt > 2) {
        await rm(mine, { recursive: true, force: true });
        throw new Error(`could not take the import lock of ${series}`);
      }
      // A stale lock (its process gone, or no SprachAnker): removed, then taken.
      await rm(lock, { recursive: true, force: true });
    }
  }
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
  const markerFile = (series: string, course: string) => downloadMarker(library, series, course);
  return {
    offers: () =>
      PROVIDERS.flatMap((p) =>
        p.offers.map((o) => ({
          ...o,
          series: p.series,
          ...(!(p.stable === true || p.stable?.includes(o.course)) && {
            experimental: true as const,
          }),
        })),
      ),

    async run(series, course, { log, progress }) {
      const provider = PROVIDERS.find((p) => p.series === series)?.id;
      if (!provider) throw new Error(`no provider writes ${series}`);
      const marker = markerFile(series, course);
      await mkdir(join(library, series, ".downloads"), { recursive: true });
      const startedAt = now();
      const mark = (m: DownloadMarker) =>
        writeFile(marker, JSON.stringify(m satisfies DownloadMarker));
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

    remove: (series, course) => removeInstalledCourse(dataRoot, series, course),

    async unfinished() {
      const out: Awaited<ReturnType<CourseInstaller["unfinished"]>> = [];
      for (const series of existsSync(library) ? await readdir(library) : []) {
        const dir = join(library, series, ".downloads");
        if (!existsSync(dir)) continue;
        for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json"))) {
          // A marker cut short (the process stopped while writing it), or not of its shape, reads as an
          // interrupted download.
          const marker = await readFile(join(dir, file), "utf8")
            .then((text) => DownloadMarker.parse(JSON.parse(text)))
            .catch((): DownloadMarker => ({ startedAt: 0 }));
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
      // Series folders: not the transfers of course bundles (`.transfers`).
      for (const entry of entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")))
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
