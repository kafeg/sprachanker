// `sprachanker import voa-english-usa`: fetch the lesson articles and recordings (idempotent), then
// normalise.
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
  runPool,
  wanted,
  writeLibraryFiles,
} from "@sprachanker/course-kit";
import {
  articleId,
  articleUrl,
  audioUrl,
  COURSE,
  EDITION,
  LESSONS,
  SERIES,
  TEXT_DEFECTS,
} from "./catalog.ts";
import { normaliseEnglishUsa, type SourceLesson } from "./normalise.ts";
import { parseLesson } from "./parse.ts";

/** Article pages in flight. */
const CONCURRENCY = 4;

export async function importEnglishUsa(options: ImportOptions): Promise<ImportReport> {
  const { log } = options;
  if (!wanted(options, EDITION, COURSE)) return emptyReport();
  const seriesDir = joinPath(options.libraryRoot, SERIES);
  const rawPath = (id: string) => `raw/${EDITION}/${COURSE}/${id}.html`;
  const fetcher = createPoliteFetcher({
    fs: options.fs,
    fetch: options.fetch,
    userAgent: IMPORTER_USER_AGENT,
    robotsHosts: ["www.golosameriki.com"],
  });

  // Fetch: one article per lesson, stored as it is.
  const raw = rawPages(seriesDir, options);
  const pages = new Map<string, string>();
  await runPool([...LESSONS], CONCURRENCY, async ([, article]) => {
    const id = articleId(article);
    pages.set(id, await raw.text(rawPath(id), () => fetcher.text(articleUrl(article))));
  });
  const lessons: SourceLesson[] = LESSONS.map(([label, article]) => {
    const id = articleId(article);
    const audio = audioUrl(label);
    const defect = TEXT_DEFECTS[label];
    return {
      label,
      id,
      raw: rawPath(id),
      parsed: parseLesson(pages.get(id) ?? ""),
      ...(audio ? { audioUrl: audio } : {}),
      ...(defect ? { textDefect: defect } : {}),
    };
  });

  const refs = lessons.flatMap((l) => (l.audioUrl ? [mediaRef(l.audioUrl, "audio")] : []));
  const index = await fetchMedia({
    fs: options.fs,
    fetcher,
    seriesDir,
    refs,
    log,
    progress: options.progress,
  });

  options.progress?.({ phase: "normalise" });
  const { files, lessons: count, unmapped } = normaliseEnglishUsa(lessons, index);
  const problems = await writeLibraryFiles(options.fs, seriesDir, files, log);
  log(
    `${COURSE} ${EDITION}: ${count} lessons${unmapped ? `, ${unmapped} unmapped parts` : ""}${problems ? `, ${problems} files failed validation` : ""}`,
  );
  // Its lessons have no exercises: none is unknown (unmapped parts are in the lessons and the log).
  return importReport(index, {
    [reportKey(COURSE, EDITION)]: { lessons: count, unknown: 0, problems },
  });
}
