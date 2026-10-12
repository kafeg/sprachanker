// `sprachanker import dw-<series>`: fetch pages and media (idempotent), then normalise.
import { join } from "node:path";
import {
  createPoliteFetcher,
  fetchMedia,
  IMPORTER_USER_AGENT,
  type ImportOptions,
  type ImportReport,
  importReport,
  type NormaliseResult,
  rawPages,
  reportKey,
  wanted,
} from "@sprachanker/course-kit";
import { COURSES, type DwSeries, seriesId } from "./catalog.ts";
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
    userAgent: IMPORTER_USER_AGENT,
    robotsHosts: ["learngerman.dw.com"],
  });
  const pages = rawPages(seriesDir, options);
  for (const course of selected) await fetchPages(fetcher, pages, course, options.log);
  const refs = (await collectMedia(join(seriesDir, "raw"))).map((r) => ({
    ...r,
    name: mediaName(r),
  }));
  const index = await fetchMedia({
    fetcher,
    seriesDir,
    refs,
    log: options.log,
    download: (ref, target) => download(fetcher, ref, target),
    progress: options.progress,
  });
  const normalised: Record<string, NormaliseResult> = {};
  for (const course of selected) {
    options.progress?.({ phase: "normalise" });
    normalised[reportKey(course.id, course.edition)] = await normaliseCourse(seriesDir, course, {
      log: options.log,
    });
  }
  return importReport(index, normalised);
}
