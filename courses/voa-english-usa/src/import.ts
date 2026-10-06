// `sprachanker import voa-english-usa`: fetch the lesson articles and recordings (idempotent), then
// normalise (03).
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
  runPool,
  storedPage,
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
  const seriesDir = join(options.libraryRoot, SERIES);
  const rawPath = (id: string) => `raw/${EDITION}/${COURSE}/${id}.html`;
  const fetcher = createPoliteFetcher({
    userAgent: IMPORTER_USER_AGENT,
    robotsHosts: ["www.golosameriki.com"],
  });

  // Fetch: one article per lesson, stored as it is.
  const pages = new Map<string, string>();
  await runPool([...LESSONS], CONCURRENCY, async ([, article]) => {
    const id = articleId(article);
    pages.set(
      id,
      await storedPage(
        join(seriesDir, rawPath(id)),
        () => fetcher.text(articleUrl(article)),
        options.refresh,
      ),
    );
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

  const refs: MediaRef[] = lessons.flatMap((l) =>
    l.audioUrl
      ? [{ url: l.audioUrl, kind: "audio" as const, name: l.audioUrl.split("/").pop() ?? "" }]
      : [],
  );
  const index = await fetchMedia({
    fetcher,
    store: createMediaStore(seriesDir),
    indexFile: join(seriesDir, "media.json"),
    refs,
    log,
  });

  const { files, lessons: count, unmapped } = normaliseEnglishUsa(lessons, index);
  const problems = await writeLibraryFiles(seriesDir, files, log);
  log(
    `${COURSE} ${EDITION}: ${count} lessons${unmapped ? `, ${unmapped} unmapped parts` : ""}${problems ? `, ${problems} files failed validation` : ""}`,
  );
  return {
    failedMedia: failedMedia(index),
    normalised: { [`${COURSE} ${EDITION}`]: { lessons: count, unknown: unmapped, problems } },
  };
}
