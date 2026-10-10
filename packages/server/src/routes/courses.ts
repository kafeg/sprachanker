import { EditionId, LessonKey, SeriesKey, Slug } from "@sprachanker/schema";
import { Hono } from "hono";
import { z } from "zod";
import { zod } from "../validate.ts";
import type { ProfileEnv } from "./env.ts";

export const CourseRef = z.object({ series: SeriesKey, course: Slug });

export function courseRoutes() {
  return (
    new Hono<ProfileEnv>()
      .get("/courses", async (c) => c.json(await c.var.s.runs.courses()))
      .get("/course", zod("query", CourseRef.extend({ edition: EditionId })), async (c) => {
        const { series, course, edition } = c.req.valid("query");
        const map = await c.var.s.content.courseMap(series, course, edition);
        const lessons = map.index.units.flatMap((u) => u.lessons) as LessonKey[];
        return c.json({ ...map, lessons: await c.var.s.runs.lessonStates(lessons) });
      })
      // A course's integrity and counts.
      .get("/course/check", zod("query", CourseRef), async (c) => {
        const { series, course } = c.req.valid("query");
        return c.json(await c.var.s.library.check(series, course));
      })
      .get(
        "/lesson",
        zod("query", z.object({ series: SeriesKey, key: LessonKey, edition: EditionId })),
        async (c) => {
          const { series, key, edition } = c.req.valid("query");
          const { lesson, locale } = await c.var.s.content.lessonWithLocale(series, key, edition);
          return c.json({ lesson, locale: locale ?? null });
        },
      )
      // What can be downloaded, and the downloads (first download, completing it, syncing: one job).
      .get("/catalog", async (c) => {
        const installed = new Set((await c.var.s.content.courses()).map((c) => c.key));
        return c.json(await c.var.s.downloads.catalog(installed));
      })
      .get("/downloads", (c) =>
        c.json({ available: c.var.s.downloads.available, jobs: c.var.s.downloads.list() }),
      )
      .post("/downloads", zod("json", CourseRef), (c) => {
        const { series, course } = c.req.valid("json");
        return c.json(c.var.s.downloads.start(series, course));
      })
      .get("/storage", async (c) => c.json(await c.var.s.downloads.storage()))
  );
}
