// `sprachanker import goethe`: each level's module pages, the solution page of each Teil and the
// pages holding a picture's or a writing task's text fetched once and kept as they are (raw/), every recording and
// picture fetched into media, then normalised offline (03).
import { join } from "node:path";
import {
  createPoliteFetcher,
  emptyReport,
  fetchMedia,
  IMPORTER_USER_AGENT,
  type ImportOptions,
  type ImportReport,
  importReport,
  type MediaRef,
  mediaPath,
  mediaRef,
  rawPages,
  reportKey,
  urlFileName,
  wanted,
  writeLibraryFiles,
} from "@sprachanker/course-kit";
import { EDITION, LEVELS, type Level, levelUrl, SERIES } from "./catalog.ts";
import { normaliseLevel, pageUrl, rawPath, referencesOf } from "./normalise.ts";
import { readLongdesc } from "./page.ts";

/** Between two requests: one server answers every page of the site. */
const INTERVAL_MS = 300;

/** A medium's name in the library: the level's, then the site's (`a1-audio1_1.mp4`). */
const mediaName = (level: Level, url: string) =>
  `${level.course}-${urlFileName(url, { decode: true })}`;

export async function importGoethe(options: ImportOptions): Promise<ImportReport> {
  const { log } = options;
  const levels = LEVELS.filter((l) => wanted(options, EDITION, l.course));
  if (!levels.length) return emptyReport();
  const seriesDir = join(options.libraryRoot, SERIES);
  const fetcher = createPoliteFetcher({ userAgent: IMPORTER_USER_AGENT, intervalMs: INTERVAL_MS });
  const pages = rawPages(seriesDir, options);
  const page = (path: string, url: string) => pages.text(path, () => fetcher.text(url));

  const mediaRefs = new Map<string, MediaRef>();
  const read: Array<{
    level: Level;
    modules: Array<{ id: Level["modules"][number]; html: string }>;
    solutions: Map<string, string>;
    texts: Map<string, string>;
  }> = [];
  for (const level of levels) {
    const modules = [];
    const solutions = new Map<string, string>();
    const texts = new Map<string, string>();
    for (const id of level.modules) {
      const html = await page(rawPath(level, "module", id), pageUrl(level, id));
      modules.push({ id, html });
      const refs = referencesOf(id, html, pageUrl(level, id));
      // Each Teil's solution page, named by its form.
      for (const file of refs.solutions) {
        if (solutions.has(file)) continue;
        const name = file.replace(/\.php$/, "");
        solutions.set(
          file,
          await page(rawPath(level, "solution", name), `${levelUrl(level)}${file}`),
        );
      }
      for (const url of refs.texts) {
        const name = urlFileName(url, { decode: true });
        texts.set(url, readLongdesc(await page(rawPath(level, "text", name), url)));
      }
      for (const url of refs.media)
        mediaRefs.set(
          url,
          mediaRef(url, /\.(mp4|mp3|m4a)$/i.test(url) ? "audio" : "image", mediaName(level, url)),
        );
    }
    read.push({ level, modules, solutions, texts });
    log(`goethe ${level.course}: ${modules.length} modules, ${solutions.size} solution pages`);
  }

  const index = await fetchMedia({
    fetcher,
    seriesDir,
    refs: [...mediaRefs.values()],
    log,
    progress: options.progress,
  });

  options.progress?.({ phase: "normalise" });
  const report = importReport(index);
  const readAt = pages.readAt();
  for (const { level, modules, solutions, texts } of read) {
    const out = normaliseLevel(level, {
      modules,
      solution: (file) => solutions.get(file),
      longdesc: (url) => texts.get(url),
      media: (url) => mediaPath(index, url),
      readAt,
    });
    for (const line of out.problems) log(`goethe ${line}`);
    const problems = await writeLibraryFiles(seriesDir, out.files, log);
    log(
      `goethe ${level.course} ${EDITION}: exam of ${out.questions} questions` +
        `${out.leftOut ? `, ${out.leftOut} left out` : ""}${problems ? `, ${problems} files failed validation` : ""}`,
    );
    // What normalising found (a recording or an answer it could not place) counts with the files
    // that failed: such an import is not reported clean.
    report.normalised[reportKey(level.course, EDITION)] = {
      lessons: 0,
      unknown: 0,
      leftOut: out.leftOut,
      problems: problems + out.problems.length,
    };
  }
  return report;
}
