// Content providers the server can import (03): the catalogue of what they offer, the CLI import and the
// download job (06). Downloads are marked on disk (`<series>/.downloads/<course>.json`) while they run,
// and kept marked when media failed, so the state survives a restart: an interrupted download resumes.
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SERIES as DIB, OFFERS as DIB_OFFERS, importDib } from "@sprachanker/coerll-dib";
import {
  type CourseOffer,
  type ImportReport,
  openLibrary,
  type ProgressSink,
} from "@sprachanker/course-kit";
import { offers as dwOffers, importDw, seriesId } from "@sprachanker/dw";
import {
  importLingust,
  SERIES as LINGUST,
  OFFERS as LINGUST_OFFERS,
} from "@sprachanker/lingust-english";
import {
  SERIES as ENGLISH_USA,
  OFFERS as ENGLISH_USA_OFFERS,
  importEnglishUsa,
} from "@sprachanker/voa-english-usa";
import {
  importLetsLearnEnglish,
  SERIES as LETS_LEARN_ENGLISH,
  OFFERS as LETS_LEARN_ENGLISH_OFFERS,
} from "@sprachanker/voa-lets-learn-english";
import type { CourseInstaller } from "./services/downloads.ts";

export interface ImportRequest {
  dataRoot: string;
  courses?: string[];
  editions?: string[];
  refresh?: boolean;
  log: (line: string) => void;
  progress?: ProgressSink;
}

type Run = (options: ImportRequest & { libraryRoot: string }) => Promise<ImportReport>;

/**
 * Provider id → the series folder it writes, its courses and its importer. `listed: false`: not
 * offered in All courses for now (the app focuses on German: docs/plan.md); the CLI still imports it.
 */
const PROVIDERS: Record<
  string,
  { series: string; offers: CourseOffer[]; run: Run; listed?: false }
> = {
  "dw-nicos-weg": {
    series: seriesId("nicos-weg"),
    offers: dwOffers("nicos-weg"),
    run: (o) => importDw("nicos-weg", o),
  },
  "dw-deutschtrainer": {
    series: seriesId("deutschtrainer"),
    offers: dwOffers("deutschtrainer"),
    run: (o) => importDw("deutschtrainer", o),
  },
  "coerll-dib": { series: DIB, offers: DIB_OFFERS, run: importDib, listed: false },
  "lingust-english": {
    series: LINGUST,
    offers: LINGUST_OFFERS,
    run: importLingust,
    listed: false,
  },
  "voa-english-usa": {
    series: ENGLISH_USA,
    offers: ENGLISH_USA_OFFERS,
    run: importEnglishUsa,
    listed: false,
  },
  "voa-lets-learn-english": {
    series: LETS_LEARN_ENGLISH,
    offers: LETS_LEARN_ENGLISH_OFFERS,
    run: importLetsLearnEnglish,
    listed: false,
  },
};

export const providerIds = () => Object.keys(PROVIDERS);

/**
 * Runs a provider into `<dataRoot>/library`. One import per series at a time, across processes (the
 * CLI and a server's download job share media.json): a lock folder with the owner's pid; a lock whose
 * process is gone is taken over.
 */
export async function importCourse(
  provider: string,
  request: ImportRequest,
): Promise<ImportReport> {
  const entry = PROVIDERS[provider];
  if (!entry) throw new Error(`unknown provider ${provider}; known: ${providerIds().join(", ")}`);
  const libraryRoot = join(request.dataRoot, "library");
  const lock = join(libraryRoot, entry.series, ".import-lock");
  await mkdir(join(libraryRoot, entry.series), { recursive: true });
  await takeLock(lock, entry.series);
  try {
    return await entry.run({ ...request, libraryRoot });
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

/** Downloads through the providers into `<dataRoot>/library` (the server's CourseInstaller). */
export function courseInstaller(dataRoot: string, now: () => number = Date.now): CourseInstaller {
  const library = join(dataRoot, "library");
  const markerFile = (series: string, course: string) =>
    join(library, series, ".downloads", `${course}.json`);
  return {
    offers: () =>
      Object.values(PROVIDERS)
        .filter((p) => p.listed !== false)
        .flatMap((p) => p.offers.map((o) => ({ ...o, series: p.series }))),

    async run(series, course, { log, progress }) {
      const provider = Object.entries(PROVIDERS).find(([, p]) => p.series === series)?.[0];
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
      // Media still missing: referenced but not on disk, or not fetched at all (failed, refused) —
      // a normaliser leaves out what it does not have, so the check alone would not see those.
      const missing =
        (await openLibrary(library).check(series, course)).media.missing +
        report.failedMedia.length;
      if (missing) await mark({ startedAt, failed: missing });
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
