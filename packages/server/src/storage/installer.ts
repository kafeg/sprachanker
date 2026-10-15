// Content providers the server can import: the catalogue of what they offer, the import and the
// download job. Downloads are marked on disk (`<series>/.downloads/<course>.json`) while they run,
// and kept marked when media failed, so the state survives a restart: an interrupted download resumes.
import { LID_PROVIDER } from "@sprachanker/bamf-lid";
import { DIB_PROVIDER } from "@sprachanker/coerll-dib";
import {
  type CourseProvider,
  type DataFs,
  type ImportReport,
  joinPath,
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
import type { CourseInstaller } from "../services/downloads.ts";
import { type DataRoot, under } from "./root.ts";

export interface ImportRequest {
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
  joinPath(libraryRoot, series, ".downloads", `${course}.json`);

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
  root: DataRoot,
  series: string,
  work: () => Promise<T>,
  options: { wait?: boolean } = {},
): Promise<T> {
  const folder = under(root, "library", series);
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
    const lock = joinPath(folder, SERIES_LOCK);
    root.fs.mkdir(folder);
    takeLock(root, lock, series);
    try {
      return await work();
    } finally {
      root.fs.remove(lock);
    }
  } finally {
    release();
    if (heldHere.get(folder) === queue) heldHere.delete(folder);
  }
}

/** Runs a provider into the data root's library, one import per series at a time (withSeriesLock). */
export async function importCourse(
  root: DataRoot,
  provider: string,
  request: ImportRequest,
): Promise<ImportReport> {
  const entry = byId.get(provider);
  if (!entry) throw new Error(`unknown provider ${provider}; known: ${providerIds().join(", ")}`);
  const libraryRoot = under(root, "library");
  return withSeriesLock(root, entry.series, () =>
    entry.import({ ...request, fs: root.fs, fetch: root.fetch, libraryRoot }),
  );
}

/** A course removed from the library under its series' lock: its files no other course of the series
 *  uses, and its download's marker (course-kit's removeCourse). What was made for its words (its deck
 *  folder in `decks/`) stays, as its practice does. */
export const removeInstalledCourse = (
  root: DataRoot,
  series: string,
  course: string,
): Promise<RemovedCourse> =>
  withSeriesLock(root, series, () => removeCourse(root.fs, under(root, "library"), series, course));

/**
 * Takes the lock folder with this process's pid already in it: the folder is made elsewhere and
 * renamed into place, so another process never sees the lock without its owner. A lock whose process
 * is gone (or is no SprachAnker) is taken over.
 */
function takeLock(root: DataRoot, lock: string, series: string) {
  const { fs } = root;
  const mine = `${lock}.${root.pid}-${Date.now()}`;
  fs.mkdir(mine);
  fs.writeFile(joinPath(mine, "pid"), String(root.pid));
  for (let attempt = 0; ; attempt++) {
    try {
      // A lock there is never empty (its pid is in it): rename(2) does not replace it.
      fs.rename(mine, lock);
      return;
    } catch {
      const owner = Number(fs.readText(joinPath(lock, "pid")) ?? "0");
      if (owner && owner !== root.pid && root.runs(owner)) {
        fs.remove(mine);
        throw seriesBusy(series, owner);
      }
      if (attempt > 2) {
        fs.remove(mine);
        throw new Error(`could not take the import lock of ${series}`);
      }
      // A stale lock (its process gone, or no SprachAnker): removed, then taken.
      fs.remove(lock);
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

/** Downloads through the providers into the data root's library (the server's CourseInstaller). */
export function courseInstaller(root: DataRoot, now: () => number = Date.now): CourseInstaller {
  const { fs } = root;
  const library = under(root, "library");
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
      const startedAt = now();
      const mark = (m: DownloadMarker) =>
        fs.writeFile(marker, JSON.stringify(m satisfies DownloadMarker));
      mark({ startedAt });
      let report: ImportReport;
      try {
        report = await importCourse(root, provider, { courses: [course], log, progress });
      } catch (error) {
        mark({ startedAt, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
      const missing = (await openLibrary(fs, library).check(series, course)).media.missing;
      const end = downloadEnd(report, missing);
      if ("error" in end) {
        mark({ startedAt, error: end.error });
        throw new Error(end.error);
      }
      if (end.failed) mark({ startedAt, failed: end.failed });
      else fs.remove(marker);
      return report;
    },

    remove: (series, course) => removeInstalledCourse(root, series, course),

    async unfinished() {
      const out: Awaited<ReturnType<CourseInstaller["unfinished"]>> = [];
      for (const series of fs.list(library)) {
        const dir = joinPath(library, series, ".downloads");
        for (const file of fs.list(dir).filter((f) => f.endsWith(".json"))) {
          // A marker cut short (the process stopped while writing it), or not of its shape, reads as an
          // interrupted download.
          let marker: DownloadMarker = { startedAt: 0 };
          try {
            marker = DownloadMarker.parse(JSON.parse(fs.readText(joinPath(dir, file)) ?? ""));
          } catch {}
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
      // Series folders: not the transfers of course bundles (`.transfers`).
      for (const name of fs.list(library).filter((n) => !n.startsWith(".")))
        if (fs.stat(joinPath(library, name))?.dir)
          series.push({ series: name, bytes: folderBytes(fs, joinPath(library, name)) });
      return { dataRoot: root.path, series, free: fs.disk(root.path)?.free ?? null };
    },
  };
}

function folderBytes(fs: DataFs, dir: string): number {
  let total = 0;
  for (const name of fs.list(dir)) {
    const path = joinPath(dir, name);
    const info = fs.stat(path);
    total += info?.dir ? folderBytes(fs, path) : (info?.size ?? 0);
  }
  return total;
}
