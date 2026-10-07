// /api: courses — the installed ones with progress, a course's map and integrity, a lesson's content,
// what can be downloaded and the downloads, the storage used.
import type { LibraryView } from "@sprachanker/course-kit";
import { CourseSlug, EditionId, LessonKey, SeriesKey } from "@sprachanker/schema";
import { Hono } from "hono";
import { z } from "zod";
import type { Content } from "../services/content.ts";
import type { Downloads } from "../services/downloads.ts";
import type { Runs } from "../services/runs.ts";
import { zod } from "../validate.ts";

export const CourseRef = z.object({ series: SeriesKey, course: CourseSlug });

export function courseRoutes(deps: {
  content: Content;
  runs: Runs;
  downloads: Downloads;
  library: LibraryView;
}) {
  const { content, runs, downloads } = deps;
  return (
    new Hono()
      .get("/courses", async (c) => c.json(await runs.courses()))
      .get("/course", zod("query", CourseRef.extend({ edition: EditionId })), async (c) => {
        const { series, course, edition } = c.req.valid("query");
        const map = await content.courseMap(series, course, edition);
        const lessons = map.index.units.flatMap((u) => u.lessons) as LessonKey[];
        return c.json({ ...map, lessons: await runs.lessonStates(lessons) });
      })
      // A course's integrity and counts.
      .get("/course/check", zod("query", CourseRef), async (c) => {
        const { series, course } = c.req.valid("query");
        return c.json(await deps.library.check(series, course));
      })
      .get(
        "/lesson",
        zod("query", z.object({ series: SeriesKey, key: LessonKey, edition: EditionId })),
        async (c) => {
          const { series, key, edition } = c.req.valid("query");
          const { lesson, locale } = await content.lessonWithLocale(series, key, edition);
          return c.json({ lesson, locale: locale ?? null });
        },
      )
      // What can be downloaded, and the downloads (first download, completing it, syncing: one job).
      .get("/catalog", async (c) => {
        const installed = new Set((await content.courses()).map((c) => c.key));
        return c.json(await downloads.catalog(installed));
      })
      .get("/downloads", (c) => c.json({ available: downloads.available, jobs: downloads.list() }))
      .post("/downloads", zod("json", CourseRef), (c) => {
        const { series, course } = c.req.valid("json");
        return c.json(downloads.start(series, course));
      })
      .get("/storage", async (c) => c.json(await downloads.storage()))
  );
}
