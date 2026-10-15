// `sprachanker import coerll-dib`: fetch the chapter pages and media (idempotent), then normalise.
import {
  createPoliteFetcher,
  emptyReport,
  fetchMedia,
  IMPORTER_USER_AGENT,
  type ImportOptions,
  type ImportReport,
  importReport,
  joinPath,
  mediaRef,
  rawPages,
  reportKey,
  wanted,
  writeLibraryFiles,
} from "@sprachanker/course-kit";
import { CHAPTERS, COURSE, EDITION, SERIES, SITE } from "./catalog.ts";
import { type Chapter, chapterPdfUrl, normaliseDib } from "./normalise.ts";
import { parseChapter, parseVocabulary } from "./parse.ts";

export async function importDib(options: ImportOptions): Promise<ImportReport> {
  const { log } = options;
  if (!wanted(options, EDITION, COURSE)) return emptyReport();
  const seriesDir = joinPath(options.libraryRoot, SERIES);
  const fetcher = createPoliteFetcher({
    fs: options.fs,
    fetch: options.fetch,
    userAgent: IMPORTER_USER_AGENT,
    robotsHosts: ["coerll.utexas.edu"],
  });

  // Fetch: two pages per chapter, stored as they are.
  const pages = rawPages(seriesDir, options);
  const page = (path: string, file: string) =>
    pages.text(`raw/${EDITION}/${COURSE}/${file}`, () => fetcher.text(new URL(path, SITE).href));
  const chapters: Chapter[] = [];
  for (let k = 1; k <= CHAPTERS; k++) {
    const toc = await page(`toc.php?k=${k}`, `toc-${k}.html`);
    const voc = await page(`voc.php?k=${k}`, `voc-${k}.html`);
    chapters.push({ k, ...parseChapter(toc), sections: parseVocabulary(voc) });
  }
  const refs = chapters.flatMap((c) => [
    ...c.sections.flatMap((s) => (s.audio ? [mediaRef(s.audio, "audio")] : [])),
    ...(c.pdf ? [mediaRef(chapterPdfUrl(c.pdf), "pdf")] : []),
  ]);
  const index = await fetchMedia({
    fs: options.fs,
    fetcher,
    seriesDir,
    refs,
    log,
    progress: options.progress,
  });

  options.progress?.({ phase: "normalise" });
  const { files, lessons } = normaliseDib(chapters, index);
  const problems = await writeLibraryFiles(options.fs, seriesDir, files, log);
  log(
    `dib ${EDITION}: ${lessons} lessons${problems ? `, ${problems} files failed validation` : ""}`,
  );
  return importReport(index, { [reportKey(COURSE, EDITION)]: { lessons, unknown: 0, problems } });
}
