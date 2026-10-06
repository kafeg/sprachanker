// Content providers the server can import (03): the catalogue of what they offer, the CLI import and the
// download job (06). Downloads are marked on disk (`<series>/.downloads/<course>.json`) while they run,
// and kept marked when media failed, so the state survives a restart: an interrupted download resumes.
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SERIES as DIB, OFFERS as DIB_OFFERS, importDib } from "@sprachanker/coerll-dib";
import type { CourseOffer, ImportReport, ProgressSink } from "@sprachanker/course-kit";
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

/** Provider id → the series folder it writes, its courses and its importer. */
const PROVIDERS: Record<string, { series: string; offers: CourseOffer[]; run: Run }> = {
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
  "coerll-dib": { series: DIB, offers: DIB_OFFERS, run: importDib },
  "lingust-english": { series: LINGUST, offers: LINGUST_OFFERS, run: importLingust },
  "voa-english-usa": { series: ENGLISH_USA, offers: ENGLISH_USA_OFFERS, run: importEnglishUsa },
  "voa-lets-learn-english": {
    series: LETS_LEARN_ENGLISH,
    offers: LETS_LEARN_ENGLISH_OFFERS,
    run: importLetsLearnEnglish,
  },
};

export const providerIds = () => Object.keys(PROVIDERS);

export function importCourse(provider: string, request: ImportRequest): Promise<ImportReport> {
  const entry = PROVIDERS[provider];
  if (!entry) throw new Error(`unknown provider ${provider}; known: ${providerIds().join(", ")}`);
  return entry.run({ ...request, libraryRoot: join(request.dataRoot, "library") });
}

/** A download marker: written when it starts; `failed` once it ended with media missing. */
interface Marker {
  startedAt: number;
  failed?: number;
}

/** Downloads through the providers into `<dataRoot>/library` (the server's CourseInstaller). */
export function courseInstaller(dataRoot: string, now: () => number = Date.now): CourseInstaller {
  const library = join(dataRoot, "library");
  const markerFile = (series: string, course: string) =>
    join(library, series, ".downloads", `${course}.json`);
  return {
    offers: () =>
      Object.values(PROVIDERS).flatMap((p) => p.offers.map((o) => ({ ...o, series: p.series }))),

    async run(series, course, { log, progress }) {
      const provider = Object.entries(PROVIDERS).find(([, p]) => p.series === series)?.[0];
      if (!provider) throw new Error(`no provider writes ${series}`);
      const marker = markerFile(series, course);
      await mkdir(join(library, series, ".downloads"), { recursive: true });
      await writeFile(marker, JSON.stringify({ startedAt: now() } satisfies Marker));
      const report = await importCourse(provider, { dataRoot, courses: [course], log, progress });
      if (report.failedMedia.length)
        await writeFile(
          marker,
          JSON.stringify({ startedAt: now(), failed: report.failedMedia.length } satisfies Marker),
        );
      else await rm(marker, { force: true });
      return report;
    },

    async unfinished() {
      const out: Awaited<ReturnType<CourseInstaller["unfinished"]>> = [];
      for (const series of existsSync(library) ? await readdir(library) : []) {
        const dir = join(library, series, ".downloads");
        if (!existsSync(dir)) continue;
        for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json"))) {
          const marker = JSON.parse(await readFile(join(dir, file), "utf8")) as Marker;
          out.push({ series, course: file.slice(0, -5), failed: marker.failed });
        }
      }
      return out;
    },

    async storage() {
      const series: Array<{ series: string; bytes: number }> = [];
      for (const name of existsSync(library) ? await readdir(library) : [])
        series.push({ series: name, bytes: await folderBytes(join(library, name)) });
      return { dataRoot, series };
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
