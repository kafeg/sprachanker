// `sprachanker import coerll-dib`: fetch the chapter pages and media (idempotent), then normalise (03).
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
  type MediaIndex,
  type MediaRef,
  pageCounter,
  storedPage,
  urlFileName,
  wanted,
  writeLibraryFiles,
} from "@sprachanker/course-kit";
import { CHAPTERS, COURSE, EDITION, SERIES, SITE } from "./catalog.ts";
import { type Chapter, chapterPdfUrl, normaliseDib } from "./normalise.ts";
import { parseChapter, parseVocabulary } from "./parse.ts";

export async function importDib(options: ImportOptions): Promise<ImportReport> {
  const { log } = options;
  if (!wanted(options, EDITION, COURSE)) return { failedMedia: [], goneMedia: [], normalised: {} };
  const seriesDir = join(options.libraryRoot, SERIES);
  const rawDir = join(seriesDir, "raw", EDITION, COURSE);
  const fetcher = createPoliteFetcher({
    userAgent: IMPORTER_USER_AGENT,
    robotsHosts: ["coerll.utexas.edu"],
  });

  // Fetch: two pages per chapter, stored as they are.
  const counted = pageCounter(options.progress);
  const page = async (path: string, file: string) => {
    const text = await storedPage(
      join(rawDir, file),
      () => fetcher.text(new URL(path, SITE).href),
      options.refresh,
    );
    counted();
    return text;
  };
  const chapters: Chapter[] = [];
  for (let k = 1; k <= CHAPTERS; k++) {
    const toc = await page(`toc.php?k=${k}`, `toc-${k}.html`);
    const voc = await page(`voc.php?k=${k}`, `voc-${k}.html`);
    chapters.push({ k, ...parseChapter(toc), sections: parseVocabulary(voc) });
  }
  const refs: MediaRef[] = chapters.flatMap((c) => [
    ...c.sections.flatMap((s) =>
      s.audio ? [{ url: s.audio, kind: "audio" as const, name: urlFileName(s.audio) }] : [],
    ),
    ...(c.pdf
      ? [
          {
            url: chapterPdfUrl(c.pdf),
            kind: "pdf" as const,
            name: urlFileName(chapterPdfUrl(c.pdf)),
          },
        ]
      : []),
  ]);
  const normalise = async (index: MediaIndex) => {
    options.progress?.({ phase: "normalise" });
    const files = normaliseDib(chapters, index);
    const problems = await writeLibraryFiles(seriesDir, files, log);
    const lessons = files.filter((f) => f.path.startsWith(`canonical/${COURSE}/lessons/`)).length;
    return { problems, lessons };
  };
  const indexFile = join(seriesDir, "media.json");
  const index = await fetchMedia({
    fetcher,
    store: createMediaStore(seriesDir),
    indexFile,
    refs,
    log,
    progress: options.progress,
  });

  const { problems, lessons } = await normalise(index);
  log(
    `dib ${EDITION}: ${lessons} lessons${problems ? `, ${problems} files failed validation` : ""}`,
  );
  return {
    failedMedia: failedMedia(index),
    goneMedia: goneMedia(index),
    normalised: { [`${COURSE} ${EDITION}`]: { lessons, unknown: 0, problems } },
  };
}
