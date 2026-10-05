// `sprachanker import dw-<series>`: fetch pages and media (idempotent), then normalise (03).
import { join } from "node:path";
import { createMediaStore, createPoliteFetcher } from "@sprachanker/course-kit";
import { COURSES, type DwSeries, seriesId, USER_AGENT } from "./catalog.ts";
import { collectMedia, fetchMedia } from "./media.ts";
import { type NormaliseResult, normaliseCourse } from "./normalise/run.ts";
import { fetchPages } from "./pages.ts";

export interface ImportOptions {
  /** Library folder of the data root. */
  libraryRoot: string;
  courses?: string[];
  editions?: string[];
  /** Fetch pages again to pick up changes at the source; media already stored are kept. */
  refresh?: boolean;
  log: (line: string) => void;
}

export interface ImportReport {
  failedMedia: string[];
  normalised: Record<string, NormaliseResult>;
}

export async function importDw(series: DwSeries, options: ImportOptions): Promise<ImportReport> {
  const seriesDir = join(options.libraryRoot, seriesId(series));
  const ofSeries = COURSES.filter((c) => c.series === series);
  const selected = ofSeries.filter(
    (c) =>
      (!options.courses || options.courses.includes(c.course)) &&
      (!options.editions || options.editions.includes(c.edition)),
  );
  const fetcher = createPoliteFetcher({
    userAgent: USER_AGENT,
    robotsHosts: ["learngerman.dw.com"],
  });
  for (const course of selected)
    await fetchPages(fetcher, seriesDir, course, options.log, options.refresh);
  const refs = await collectMedia(join(seriesDir, "raw"));
  const index = await fetchMedia(
    fetcher,
    createMediaStore(seriesDir),
    join(seriesDir, "media.json"),
    refs,
    options.log,
  );
  const failedMedia = Object.entries(index).flatMap(([url, e]) =>
    "error" in e ? [`${url}: ${e.error}`] : [],
  );
  const normalised: Record<string, NormaliseResult> = {};
  // The primary edition writes the canonical files; it runs first for each course.
  for (const course of ofSeries.filter((c) => selected.some((s) => s.course === c.course))) {
    if (!selected.includes(course)) continue;
    normalised[`${course.course} ${course.edition}`] = await normaliseCourse(seriesDir, course, {
      log: options.log,
    });
  }
  return { failedMedia, normalised };
}
