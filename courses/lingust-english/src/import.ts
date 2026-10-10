// `sprachanker import lingust-english`: fetch the index, the lesson pages and their recordings
// (idempotent), then normalise (03).
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
  mediaRef,
  openKeyMap,
  rawPages,
  wanted,
  writeLibraryFiles,
} from "@sprachanker/course-kit";

import { BONUS, COURSE, EDITION, HOST, MEDIA_REFERER, SERIES, SITE } from "./catalog.ts";
import { type LessonSource, normaliseLingust, type UnitSource } from "./normalise.ts";
import { parseIndex } from "./parse/course-index.ts";
import { parseLesson } from "./parse/lesson.ts";
import { parseVerbTable } from "./parse/verbs.ts";

/** The site's recordings answer only requests coming from its pages (hotlink protection). */
const withReferer: typeof fetch = Object.assign(
  (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.host !== HOST || !url.pathname.startsWith("/media/")) return fetch(input, init);
    const headers = new Headers(init?.headers);
    headers.set("Referer", MEDIA_REFERER);
    return fetch(input, { ...init, headers });
  },
  { preconnect: fetch.preconnect },
);

export async function importLingust(options: ImportOptions): Promise<ImportReport> {
  const { log } = options;
  if (!wanted(options, EDITION, COURSE)) return emptyReport();
  const seriesDir = join(options.libraryRoot, SERIES);
  const fetcher = createPoliteFetcher({
    userAgent: IMPORTER_USER_AGENT,
    robotsHosts: [HOST],
    fetch: withReferer,
  });
  const pages = rawPages(seriesDir, options);
  const page = (slug: string, file: string) =>
    pages.text(`raw/${EDITION}/${COURSE}/${file}`, () =>
      fetcher.text(slug ? `${SITE}/${slug}` : SITE),
    );

  // Fetch: the index, then every lesson of the stages and the bonus pages we import.
  const stages = parseIndex(await page("", "index.html"));
  const units: UnitSource[] = [];
  const refs = new Map<string, MediaRef>();
  const audio = (url: string | undefined) => {
    if (url) refs.set(url, mediaRef(url, "audio"));
  };
  for (const stage of stages) {
    const lessons: LessonSource[] = [];
    for (const info of stage.lessons) {
      if (/^lesson\d+$/.test(info.slug)) {
        const p = parseLesson(await page(info.slug, `${info.slug}.html`), `${SITE}/${info.slug}`);
        audio(p.audio);
        for (const s of p.sections) for (const x of s.snippets) audio(x.audio);
        for (const e of p.exercises) for (const x of [...e.players, ...e.epilogue]) audio(x.audio);
        lessons.push({ kind: "lesson", info, page: p });
      } else if (BONUS.includes(info.slug)) {
        const v = parseVerbTable(await page(info.slug, `${info.slug}.html`));
        lessons.push({ kind: "verbs", info, ...v });
      } else {
        log(`lingust: skipped ${info.slug} (${info.title}): not lesson content`);
      }
    }
    if (lessons.length) units.push({ title: stage.title, lessons });
  }
  const index = await fetchMedia({
    fetcher,
    seriesDir,
    refs: [...refs.values()],
    log,
    progress: options.progress,
  });

  options.progress?.({ phase: "normalise" });
  // Keys stay by source id across normalisations (02): the series' key map, saved once written.
  const keys = await openKeyMap(seriesDir);
  const { files, lessons, unknown } = normaliseLingust(units, index, keys);
  const problems = await writeLibraryFiles(seriesDir, files, log);
  await keys.save();
  log(
    `lingust ${EDITION}: ${lessons} lessons, ${unknown} unknown exercises` +
      (problems ? `, ${problems} files failed validation` : ""),
  );
  return importReport(index, { [`${COURSE} ${EDITION}`]: { lessons, unknown, problems } });
}
