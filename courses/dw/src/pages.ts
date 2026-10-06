// Fetch phase, pages: course page, lesson pages, download pages and exercise pages → raw JSON (03).
import { join } from "node:path";
import { type PoliteFetcher, runPool, storedPage } from "@sprachanker/course-kit";
import { type ApolloState, exerciseIds, extractState, lessonIds } from "./apollo.ts";
import { type DwCourse, SITE } from "./catalog.ts";

/** Pages fetched at the same time. */
const CONCURRENCY = 8;

/** `raw/<edition>/<course>/` of a series folder. */
export const rawDir = (seriesDir: string, c: DwCourse) =>
  join(seriesDir, "raw", c.edition, c.course);

/** Fetches a page once; later runs read the stored state unless `refresh` asks for it again. */
async function page(
  fetcher: PoliteFetcher,
  path: string,
  file: string,
  refresh = false,
): Promise<ApolloState> {
  const stored = await storedPage(
    file,
    async () => JSON.stringify(extractState(await fetcher.text(`${SITE}${path}`))),
    refresh,
  );
  return JSON.parse(stored);
}

export async function fetchPages(
  fetcher: PoliteFetcher,
  seriesDir: string,
  c: DwCourse,
  log: (line: string) => void,
  refresh = false,
  /** Called once per page read or fetched (progress). */
  counted: () => void = () => {},
): Promise<void> {
  const dir = rawDir(seriesDir, c);
  const get = async (path: string, file: string) => {
    const state = await page(fetcher, path, file, refresh);
    counted();
    return state;
  };
  // Slugs in DW URLs are ignored by the server, so `x` stands in for them.
  const course = await get(`/${c.lang}/x/c-${c.sourceId}`, join(dir, "course.json"));
  const lessons = lessonIds(course);
  const exercises: Array<{ lesson: number; exercise: number }> = [];
  await runPool(lessons, CONCURRENCY, async (id) => {
    const lesson = await get(`/${c.lang}/x/l-${id}`, join(dir, `l-${id}.json`));
    await get(`/${c.lang}/x/l-${id}/le`, join(dir, `le-${id}.json`));
    for (const exercise of exerciseIds(lesson, id)) exercises.push({ lesson: id, exercise });
  });
  log(
    `${c.course} ${c.edition}: ${lessons.length} lessons; fetching ${exercises.length} exercise pages`,
  );
  let done = 0;
  await runPool(exercises, CONCURRENCY, async ({ lesson, exercise }) => {
    await get(`/${c.lang}/x/l-${lesson}/e-${exercise}`, join(dir, `e-${exercise}.json`));
    if (++done % 200 === 0)
      log(`${c.course} ${c.edition}: ${done}/${exercises.length} exercise pages`);
  });
  log(`${c.course} ${c.edition}: pages done`);
}
