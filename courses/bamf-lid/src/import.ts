// `sprachanker import bamf-lid`: the catalogue PDF and the test centre's question pages fetched once and
// kept as they are (raw/), the pictures taken out of the PDF into media, then normalised offline (03).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
  rawPages,
  wanted,
  writeFileAtomic,
  writeLibraryFiles,
} from "@sprachanker/course-kit";
import { type FederalState, type MediaPath, optionId } from "@sprachanker/schema";
import {
  CATALOGUE_PDF,
  COURSE,
  EDITION,
  GENERAL_QUESTIONS,
  SERIES,
  STATE_QUESTIONS,
  STATES,
} from "./catalog.ts";
import { type CatalogueQuestion, parseCatalogue } from "./catalogue.ts";
import { type CentreQuestion, readQuestionPage, walkCentre } from "./centre.ts";
import { addressOf, normaliseExam, PDF_RAW, type PictureFiles, pictureName } from "./normalise.ts";
import { type PdfImage, readPdf } from "./pdf.ts";
import { encodePng, shrink } from "./png.ts";

/** Between two requests to the test centre: it is an application server, read gently. */
const INTERVAL_MS = 500;

export async function importLid(options: ImportOptions): Promise<ImportReport> {
  const { log } = options;
  if (!wanted(options, EDITION, COURSE)) return emptyReport();
  const seriesDir = join(options.libraryRoot, SERIES);
  const fetcher = createPoliteFetcher({ userAgent: IMPORTER_USER_AGENT, intervalMs: INTERVAL_MS });
  const pages = rawPages(seriesDir, options);

  // The catalogue, as published.
  const pdf = await pages.bytes(PDF_RAW, async () => (await fetcher.bytes(CATALOGUE_PDF)).bytes);
  const pdfSha256 = createHash("sha256").update(pdf).digest("hex");
  const { lines, images } = await readPdf(pdf);
  const catalogue = parseCatalogue(lines, images);
  log(`lid: catalogue of ${catalogue.stand}, ${catalogue.questions.length} questions`);

  // The test centre's page of each question: the general part read with one state chosen, each
  // state's ten with that state chosen. Only pages not stored yet are fetched (all with `refresh`).
  const pagePath = (state: FederalState | null, number: number) =>
    `raw/${EDITION}/${COURSE}/centre/${state ?? "general"}/${String(number).padStart(3, "0")}.html`;
  const pageFile = (state: FederalState | null, number: number) =>
    join(seriesDir, pagePath(state, number));
  const session = fetcher.session();
  const walk = async (state: FederalState | null, numbers: number[]) => {
    const missing = numbers.filter((n) => options.refresh || !existsSync(pageFile(state, n)));
    for (const n of numbers) if (!missing.includes(n)) pages.kept(pagePath(state, n));
    // The general part is the same whichever state is chosen: Berlin's list is used.
    const centre = STATES.find((s) => s.code === (state ?? "be"))?.centre as string;
    await walkCentre(session, centre, missing, async (n, html) => {
      await writeFileAtomic(pageFile(state, n), html);
      pages.kept(pagePath(state, n));
    });
  };
  const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);
  await walk(null, range(1, GENERAL_QUESTIONS));
  for (const state of STATES) await walk(state.code, range(GENERAL_QUESTIONS + 1, STATE_QUESTIONS));
  const answers = new Map<string, CentreQuestion>();
  const answerOf = (state: FederalState | null, number: number) => {
    const file = pageFile(state, number);
    const key = `${state}:${number}`;
    if (!answers.has(key) && existsSync(file))
      answers.set(key, readQuestionPage(readFileSync(file, "utf8")));
    return answers.get(key);
  };

  // The pictures: each one of a question saved as a PNG, named by the question and its place.
  // Named by the PDF's content too: a new catalogue's pictures are taken anew.
  const pdfId = pdfSha256.slice(0, 16);
  const pictureRefs: Array<MediaRef & { id: string; place: string; image: PdfImage }> =
    catalogue.questions.flatMap((q) =>
      picturesOf(q).map(({ place, image }) => {
        const id = addressOf(q).id;
        return {
          url: `${CATALOGUE_PDF}#pdf=${pdfId}&q=${id}&at=${place}`,
          kind: "image" as const,
          name: pictureName(id, place),
          id,
          place,
          image,
        };
      }),
    );
  const index = await fetchMedia({
    fetcher,
    seriesDir,
    refs: pictureRefs,
    log,
    progress: options.progress,
    download: async (ref, target) => {
      await writeFileAtomic(target, encodePng(shrink(ref.image.pixels)));
      return { mime: "image/png" };
    },
  });

  options.progress?.({ phase: "normalise" });
  const pictures = new Map<string, PictureFiles>();
  for (const ref of pictureRefs) {
    const path = mediaPath(index, ref.url);
    if (!path) continue;
    const files = pictures.get(ref.id) ?? new Map<string, MediaPath>();
    files.set(ref.place, path);
    pictures.set(ref.id, files);
  }
  const {
    files,
    questions,
    leftOut,
    problems: found,
  } = normaliseExam(
    catalogue,
    (a) => answerOf(a.state, a.number),
    (id) => pictures.get(id) ?? new Map(),
    // When the newest copy was kept: the catalogue or a test centre page.
    { sha256: pdfSha256, readAt: pages.readAt() },
  );
  for (const line of found) log(`lid: ${line}`);
  const problems = await writeLibraryFiles(seriesDir, files, log);
  log(
    `lid ${EDITION}: exam of ${questions} questions${leftOut ? `, ${leftOut} left out` : ""}` +
      `${problems ? `, ${problems} files failed validation` : ""}`,
  );
  return importReport(index, {
    [`${COURSE} ${EDITION}`]: { lessons: 0, unknown: 0, leftOut, problems },
  });
}

/** A question's pictures by place: a row as many as its options is theirs (`a`–`d`), a single one the
 *  question's (`item`). */
function picturesOf(q: CatalogueQuestion): Array<{ place: string; image: PdfImage }> {
  if (q.pictures.length > 1 && q.pictures.length === q.options.length)
    return q.pictures.map((image, i) => ({ place: optionId(i), image }));
  if (q.pictures.length === 1) return [{ place: "item", image: q.pictures[0] as PdfImage }];
  if (q.pictures.length)
    throw new Error(
      `question ${q.state ?? ""} ${q.number}: ${q.pictures.length} pictures for ${q.options.length} options`,
    );
  return [];
}
