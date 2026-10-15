// `sprachanker import dw-<series>`: fetch pages and media (idempotent), then normalise.
import {
  createPoliteFetcher,
  fetchMedia,
  IMPORTER_USER_AGENT,
  type ImportOptions,
  type ImportReport,
  importReport,
  joinPath,
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
  const seriesDir = joinPath(options.libraryRoot, seriesId(series));
  const ofSeries = COURSES.filter((c) => c.series === series);
  const selected = ofSeries.filter((c) =>
    // `--courses a1` takes both editions of DW's A1, `a1-ru` one of them.
    wanted(options, c.edition, c.course, c.id),
  );
  const fetcher = createPoliteFetcher({
    fs: options.fs,
    fetch: options.fetch,
    userAgent: IMPORTER_USER_AGENT,
    robotsHosts: ["learngerman.dw.com"],
  });
  const pages = rawPages(seriesDir, options);
  for (const course of selected) await fetchPages(fetcher, pages, course, options.log);
  const refs = (await collectMedia(options.fs, joinPath(seriesDir, "raw"))).map((r) => ({
    ...r,
    name: mediaName(r),
  }));
  const index = await fetchMedia({
    fs: options.fs,
    fetcher,
    seriesDir,
    refs,
    log: options.log,
    download: (ref, target) => download(fetcher, options.fs, ref, target),
    progress: options.progress,
  });
  const normalised: Record<string, NormaliseResult> = {};
  for (const course of selected) {
    options.progress?.({ phase: "normalise" });
    normalised[reportKey(course.id, course.edition)] = await normaliseCourse(seriesDir, course, {
      fs: options.fs,
      log: options.log,
    });
  }
  return importReport(index, normalised);
}
