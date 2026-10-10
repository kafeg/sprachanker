// `sprachanker import goethe`: each level's module pages, the solution page of each Teil and the
// pages holding a picture's or a writing task's text fetched once and kept as they are (raw/), every recording and
// picture fetched into media, then normalised offline (03).
import { statSync } from "node:fs";
import { join } from "node:path";
import {
  createMediaStore,
  createPoliteFetcher,
  failedMedia,
  fetchMedia,
  goneMedia,
  IMPORTER_USER_AGENT,
  type ImportOptions,
  type ImportReport,
  type MediaRef,
  pageCounter,
  storedPage,
  wanted,
  writeLibraryFiles,
} from "@sprachanker/course-kit";
import type { MediaPath } from "@sprachanker/schema";
import { EDITION, LEVELS, type Level, levelUrl, SERIES } from "./catalog.ts";
import { normaliseLevel, pageUrl, rawPath, referencesOf } from "./normalise.ts";
import { readLongdesc } from "./page.ts";

/** Between two requests: one server answers every page of the site. */
const INTERVAL_MS = 300;

/** A medium's name in the library: the level's, then the site's (`a1-audio1_1.mp4`). */
const mediaName = (level: Level, url: string) =>
  `${level.course}-${decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "")}`;

export async function importGoethe(options: ImportOptions): Promise<ImportReport> {
  const { log } = options;
  const levels = LEVELS.filter((l) => wanted(options, EDITION, l.course));
  if (!levels.length) return { failedMedia: [], goneMedia: [], normalised: {} };
  const seriesDir = join(options.libraryRoot, SERIES);
  const fetcher = createPoliteFetcher({ userAgent: IMPORTER_USER_AGENT, intervalMs: INTERVAL_MS });
  const counted = pageCounter(options.progress);
  /** A library path's file; a page kept there (read when it is not yet), the newest one's time. */
  const at = (path: string) => join(seriesDir, path);
  let readAt = 0;
  const page = (file: string, url: string) =>
    storedPage(file, () => fetcher.text(url), options.refresh)
      .then((text) => {
        readAt = Math.max(readAt, statSync(file).mtimeMs);
        return text;
      })
      .finally(counted);

  const mediaRefs = new Map<string, MediaRef & { level: Level }>();
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
      const html = await page(at(rawPath(level, "module", id)), pageUrl(level, id));
      modules.push({ id, html });
      const refs = referencesOf(id, html, pageUrl(level, id));
      // Each Teil's solution page, named by its form.
      for (const file of refs.solutions) {
        if (solutions.has(file)) continue;
        const name = file.replace(/\.php$/, "");
        solutions.set(
          file,
          await page(at(rawPath(level, "solution", name)), `${levelUrl(level)}${file}`),
        );
      }
      for (const url of refs.texts) {
        const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
        texts.set(url, readLongdesc(await page(at(rawPath(level, "text", name)), url)));
      }
      for (const url of refs.media)
        mediaRefs.set(url, {
          url,
          kind: /\.(mp4|mp3|m4a)$/i.test(url) ? "audio" : "image",
          name: mediaName(level, url),
          level,
        });
    }
    read.push({ level, modules, solutions, texts });
    log(`goethe ${level.course}: ${modules.length} modules, ${solutions.size} solution pages`);
  }

  const index = await fetchMedia({
    fetcher,
    store: createMediaStore(seriesDir),
    indexFile: join(seriesDir, "media.json"),
    refs: [...mediaRefs.values()],
    log,
    progress: options.progress,
  });

  options.progress?.({ phase: "normalise" });
  const report: ImportReport = {
    failedMedia: failedMedia(index),
    goneMedia: goneMedia(index),
    normalised: {},
  };
  for (const { level, modules, solutions, texts } of read) {
    const out = normaliseLevel(level, {
      modules,
      solution: (file) => solutions.get(file),
      longdesc: (url) => texts.get(url),
      media: (url) => {
        const entry = index[url];
        return entry && "path" in entry ? (entry.path as MediaPath) : undefined;
      },
      readAt: Math.round(readAt),
    });
    for (const line of out.problems) log(`goethe ${line}`);
    const problems = await writeLibraryFiles(seriesDir, out.files, log);
    log(
      `goethe ${level.course} ${EDITION}: exam of ${out.questions} questions` +
        `${out.leftOut ? `, ${out.leftOut} left out` : ""}${problems ? `, ${problems} files failed validation` : ""}`,
    );
    // What normalising found (a recording or an answer it could not place) counts with the files
    // that failed: such an import is not reported clean.
    report.normalised[`${level.course} ${EDITION}`] = {
      lessons: 0,
      unknown: out.leftOut,
      problems: problems + out.problems.length,
    };
  }
  return report;
}
