// `sprachanker import voa-lets-learn-english`: fetch the landing pages, lesson articles, their document
// pages and quiz result pages (idempotent), then the media, then normalise (03). GET only: a quiz's
// result page (`page=2k`) shows question k with its answer, no answer is submitted.
import { join } from "node:path";
import {
  createMediaStore,
  createPoliteFetcher,
  FetchFailedError,
  failedMedia,
  fetchMedia,
  IMPORTER_USER_AGENT,
  type ImportOptions,
  type ImportReport,
  type MediaIndex,
  type PoliteFetcher,
  pageCounter,
  runPool,
  storedPage,
  wanted,
  writeLibraryFiles,
} from "@sprachanker/course-kit";
import { COURSES, type CourseDef, EDITION, HOST, SERIES, SITE } from "./catalog.ts";
import { normaliseCourse } from "./normalise/course.ts";
import { type FetchedCourse, type FetchedLesson, mediaRefs } from "./normalise/plan.ts";
import {
  type LandingLesson,
  parseDocPage,
  parseLanding,
  parseLesson,
  parseQuizPage,
  type QuizQuestion,
} from "./parse.ts";

/** Lesson pages fetched at once. */
const CONCURRENCY = 4;

export async function importLetsLearnEnglish(options: ImportOptions): Promise<ImportReport> {
  const { log } = options;
  const seriesDir = join(options.libraryRoot, SERIES);
  const report: ImportReport = { failedMedia: [], normalised: {} };
  if (!wanted({ ...options, courses: undefined }, EDITION)) return report;
  const fetcher = createPoliteFetcher({ userAgent: IMPORTER_USER_AGENT, robotsHosts: [HOST] });
  const defs = COURSES.filter((c) => wanted(options, EDITION, c.id));

  const counted = pageCounter(options.progress);
  const courses: FetchedCourse[] = [];
  for (const def of defs)
    courses.push(await fetchCourse(fetcher, seriesDir, def, { ...options, counted }));

  const normalise = async (course: FetchedCourse, index: MediaIndex) => {
    options.progress?.({ phase: "normalise" });
    const result = normaliseCourse(course, index);
    return { result, problems: await writeLibraryFiles(seriesDir, result.files, log) };
  };
  const indexFile = join(seriesDir, "media.json");

  const index = await fetchMedia({
    fetcher,
    store: createMediaStore(seriesDir),
    indexFile,
    refs: courses.flatMap(mediaRefs),
    log,
    progress: options.progress,
  });
  report.failedMedia = failedMedia(index);

  for (const course of courses) {
    const { result, problems } = await normalise(course, index);
    for (const line of result.unmapped) log(`unmapped: ${line}`);
    log(
      `${course.def.id} ${EDITION}: ${result.lessons} lessons, ${result.unknown} unknown exercises, ` +
        `${result.unmapped.length} unmapped parts${problems ? `, ${problems} files failed validation` : ""}`,
    );
    report.normalised[`${course.def.id} ${EDITION}`] = {
      lessons: result.lessons,
      unknown: result.unknown,
      problems,
    };
  }
  return report;
}

async function fetchCourse(
  fetcher: PoliteFetcher,
  seriesDir: string,
  def: CourseDef,
  options: ImportOptions & { counted: () => void },
): Promise<FetchedCourse> {
  const rel = `raw/${EDITION}/${def.id}`;
  const page = async (file: string, url: string) => {
    const text = await storedPage(
      join(seriesDir, rel, file),
      () => fetcher.text(url),
      options.refresh,
    );
    options.counted();
    return text;
  };
  /** A page that may be missing at the source (documents, quizzes): undefined instead of failing. */
  const optionalPage = (file: string, url: string) =>
    page(file, url).catch((error) => {
      if (!(error instanceof FetchFailedError)) throw error;
      options.log(`${url}: ${error.status}`);
      return undefined;
    });

  const landing = parseLanding(await page("landing.html", new URL(def.landing, SITE).href));
  options.log(`${def.id}: ${landing.lessons.length} lessons`);
  const lessons: FetchedLesson[] = new Array(landing.lessons.length);
  await runPool([...landing.lessons.entries()], CONCURRENCY, async ([i, source]) => {
    lessons[i] = await fetchLesson(source, rel, page, optionalPage);
  });
  return {
    def,
    sourceId: /(\d+)\.html$/.exec(def.landing)?.[1] ?? def.id,
    landing,
    lessons,
  };
}

async function fetchLesson(
  source: LandingLesson,
  rel: string,
  page: (file: string, url: string) => Promise<string>,
  optionalPage: (file: string, url: string) => Promise<string | undefined>,
): Promise<FetchedLesson> {
  const file = `a-${source.id}.html`;
  const parsed = parseLesson(await page(file, source.url));
  const docPdfs: FetchedLesson["docPdfs"] = {};
  const quizzes: FetchedLesson["quizzes"] = {};
  for (const section of parsed.sections) {
    for (const doc of section.docs) {
      const html = await optionalPage(`d-${doc.id}.html`, doc.url);
      docPdfs[doc.id] = html ? parseDocPage(html) : undefined;
    }
    for (const quiz of section.quizzes) {
      const questions: QuizQuestion[] = [];
      for (let k = 1; k <= (questions[0]?.total ?? 1); k++) {
        const url = `${SITE}/Quiz/Start?id=${quiz.id}&page=${2 * k}`;
        const html = await optionalPage(`q-${quiz.id}-${k}.html`, url);
        const question = html ? parseQuizPage(html) : undefined;
        if (!question) break;
        questions.push(question);
      }
      quizzes[quiz.id] = questions;
    }
  }
  return { source, raw: `${rel}/${file}`, page: parsed, docPdfs, quizzes };
}
