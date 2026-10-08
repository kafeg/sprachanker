// `sprachanker import dw-<series>`: fetch pages and media (idempotent), then normalise (03).
import { join } from "node:path";
import {
  createMediaStore,
  createPoliteFetcher,
  failedMedia,
  fetchMedia,
  goneMedia,
  type ImportOptions,
  type ImportReport,
  type NormaliseResult,
  pageCounter,
  wanted,
} from "@sprachanker/course-kit";
import { COURSES, type DwSeries, seriesId, USER_AGENT } from "./catalog.ts";
import { collectMedia, download, mediaName } from "./media.ts";
import { normaliseCourse } from "./normalise/run.ts";
import { fetchPages } from "./pages.ts";

export async function importDw(series: DwSeries, options: ImportOptions): Promise<ImportReport> {
  const seriesDir = join(options.libraryRoot, seriesId(series));
  const ofSeries = COURSES.filter((c) => c.series === series);
  const selected = ofSeries.filter((c) =>
    // `--courses a1` takes both editions of DW's A1, `a1-ru` one of them.
    wanted(options, c.edition, c.course, c.id),
  );
  const fetcher = createPoliteFetcher({
    userAgent: USER_AGENT,
    robotsHosts: ["learngerman.dw.com"],
  });
  const counted = pageCounter(options.progress);
  for (const course of selected)
    await fetchPages(fetcher, seriesDir, course, options.log, options.refresh, counted);
  const normalise = (course: (typeof selected)[number]) => {
    options.progress?.({ phase: "normalise" });
    return normaliseCourse(seriesDir, course, { log: options.log });
  };
  const refs = (await collectMedia(join(seriesDir, "raw"))).map((r) => ({
    ...r,
    name: mediaName(r),
  }));
  const index = await fetchMedia({
    fetcher,
    store: createMediaStore(seriesDir),
    indexFile: join(seriesDir, "media.json"),
    refs,
    log: options.log,
    download: (ref, target) => download(fetcher, ref, target),
    progress: options.progress,
  });
  const normalised: Record<string, NormaliseResult> = {};
  for (const course of selected) {
    normalised[course.id] = await normalise(course);
  }
  return { failedMedia: failedMedia(index), goneMedia: goneMedia(index), normalised };
}
