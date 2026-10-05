// `sprachanker import coerll-dib`: fetch the chapter pages and media (idempotent), then normalise (03).
import { join } from "node:path";
import {
  createMediaStore,
  createPoliteFetcher,
  failedMedia,
  fetchMedia,
  IMPORTER_USER_AGENT,
  type ImportOptions,
  type ImportReport,
  type MediaRef,
  storedPage,
  writeLibraryFiles,
} from "@sprachanker/course-kit";
import { CHAPTERS, COURSE, EDITION, SERIES, SITE } from "./catalog.ts";
import { type Chapter, chapterPdfUrl, normaliseDib } from "./normalise.ts";
import { parseChapter, parseVocabulary } from "./parse.ts";

const fileName = (url: string) => new URL(url).pathname.split("/").pop() ?? "";

export async function importDib(options: ImportOptions): Promise<ImportReport> {
  const { log } = options;
  const seriesDir = join(options.libraryRoot, SERIES);
  const rawDir = join(seriesDir, "raw", EDITION, COURSE);
  const fetcher = createPoliteFetcher({
    userAgent: IMPORTER_USER_AGENT,
    robotsHosts: ["coerll.utexas.edu"],
  });

  // Fetch: two pages per chapter, stored as they are.
  const page = (path: string, file: string) =>
    storedPage(join(rawDir, file), () => fetcher.text(new URL(path, SITE).href), options.refresh);
  const chapters: Chapter[] = [];
  for (let k = 1; k <= CHAPTERS; k++) {
    const toc = await page(`toc.php?k=${k}`, `toc-${k}.html`);
    const voc = await page(`voc.php?k=${k}`, `voc-${k}.html`);
    chapters.push({ k, ...parseChapter(toc), sections: parseVocabulary(voc) });
  }
  const refs: MediaRef[] = chapters.flatMap((c) => [
    ...c.sections.flatMap((s) =>
      s.audio ? [{ url: s.audio, kind: "audio" as const, name: fileName(s.audio) }] : [],
    ),
    ...(c.pdf
      ? [{ url: chapterPdfUrl(c.pdf), kind: "pdf" as const, name: fileName(chapterPdfUrl(c.pdf)) }]
      : []),
  ]);
  const index = await fetchMedia({
    fetcher,
    store: createMediaStore(seriesDir),
    indexFile: join(seriesDir, "media.json"),
    refs,
    log,
  });

  const files = normaliseDib(chapters, index);
  const problems = await writeLibraryFiles(seriesDir, files, log);
  const lessons = files.filter((f) => f.path.startsWith(`canonical/${COURSE}/lessons/`)).length;
  log(
    `dib ${EDITION}: ${lessons} lessons${problems ? `, ${problems} files failed validation` : ""}`,
  );
  return {
    failedMedia: failedMedia(index),
    normalised: { [`${COURSE} ${EDITION}`]: { lessons, unknown: 0, problems } },
  };
}
