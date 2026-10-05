// Fetch phase, pages: course page, lesson pages, download pages and exercise pages → raw JSON (03).
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PoliteFetcher } from "@sprachanker/course-kit";
import { type ApolloState, exerciseIds, extractState, lessonIds } from "./apollo.ts";
import { type DwCourse, SITE } from "./catalog.ts";

/** `raw/<edition>/<course>/` of a series folder. */
export const rawDir = (seriesDir: string, c: DwCourse) =>
  join(seriesDir, "raw", c.edition, c.course);

/** Fetches a page once; later runs read the stored state. */
async function page(fetcher: PoliteFetcher, path: string, file: string): Promise<ApolloState> {
  if (existsSync(file)) return JSON.parse(await readFile(file, "utf8"));
  const state = extractState(await (await fetcher.get(`${SITE}${path}`)).text());
  await writeFile(file, JSON.stringify(state));
  return state;
}

export async function fetchPages(
  fetcher: PoliteFetcher,
  seriesDir: string,
  c: DwCourse,
  log: (line: string) => void,
): Promise<void> {
  const dir = rawDir(seriesDir, c);
  await mkdir(dir, { recursive: true });
  // Slugs in DW URLs are ignored by the server, so `x` stands in for them.
  const course = await page(fetcher, `/${c.lang}/x/c-${c.sourceId}`, join(dir, "course.json"));
  const lessons = lessonIds(course);
  for (const [n, id] of lessons.entries()) {
    const lesson = await page(fetcher, `/${c.lang}/x/l-${id}`, join(dir, `l-${id}.json`));
    await page(fetcher, `/${c.lang}/x/l-${id}/le`, join(dir, `le-${id}.json`));
    for (const exercise of exerciseIds(lesson, id)) {
      await page(fetcher, `/${c.lang}/x/l-${id}/e-${exercise}`, join(dir, `e-${exercise}.json`));
    }
    log(`${c.course} ${c.edition}: lesson ${n + 1}/${lessons.length} pages done`);
  }
}
