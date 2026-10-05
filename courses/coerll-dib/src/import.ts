// `sprachanker import coerll-dib`: fetch the chapter pages and media (idempotent), then normalise (03).
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createMediaStore,
  createPoliteFetcher,
  failedMedia,
  fetchMedia,
  IMPORTER_USER_AGENT,
  type MediaRef,
  prettyJson,
} from "@sprachanker/course-kit";
import { CHAPTERS, COURSE, EDITION, SERIES, SITE } from "./catalog.ts";
import { type Chapter, chapterPdfUrl, normaliseDib } from "./normalise.ts";
import { parseChapter, parseVocabulary } from "./parse.ts";

export interface ImportOptions {
  /** Library folder of the data root. */
  libraryRoot: string;
  /** Fetch pages again to pick up changes at the source; media already stored are kept. */
  refresh?: boolean;
  log: (line: string) => void;
}

export interface ImportReport {
  failedMedia: string[];
  normalised: Record<string, { lessons: number; unknown: number; problems: number }>;
}

const fileName = (url: string) => new URL(url).pathname.split("/").pop() ?? "";

export async function importDib(options: ImportOptions): Promise<ImportReport> {
  const { log } = options;
  const seriesDir = join(options.libraryRoot, SERIES);
  const rawDir = join(seriesDir, "raw", EDITION, COURSE);
  await mkdir(rawDir, { recursive: true });
  const fetcher = createPoliteFetcher({
    userAgent: IMPORTER_USER_AGENT,
    robotsHosts: ["coerll.utexas.edu"],
  });

  // Fetch: two pages per chapter, stored as they are.
  const page = async (path: string, file: string) => {
    const target = join(rawDir, file);
    if (!options.refresh && existsSync(target)) return readFile(target, "utf8");
    const html = await fetcher.text(new URL(path, SITE).href);
    await writeFile(target, html);
    return html;
  };
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

  // Normalise: every file is validated; an invalid one is reported, not written.
  let problems = 0;
  let lessons = 0;
  for (const file of normaliseDib(chapters, index)) {
    const result = file.schema.safeParse(file.value);
    if (!result.success) {
      problems++;
      log(
        `${file.path}: ${result.error.issues[0]?.path.join(".")} ${result.error.issues[0]?.message}`,
      );
      continue;
    }
    if (file.path.startsWith(`canonical/${COURSE}/lessons/`)) lessons++;
    await mkdir(dirname(join(seriesDir, file.path)), { recursive: true });
    await writeFile(join(seriesDir, file.path), prettyJson(file.value));
  }
  log(`dib ${EDITION}: ${lessons} lessons${problems ? `, ${problems} invalid files` : ""}`);
  return {
    failedMedia: failedMedia(index),
    normalised: { [`${COURSE} ${EDITION}`]: { lessons, unknown: 0, problems } },
  };
}
