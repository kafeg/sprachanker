import { EditionId, LessonKey, lessonOrder, SeriesKey, Slug } from "@sprachanker/schema";
import { Hono } from "hono";
import { z } from "zod";
import { announcedLength, attachment } from "../media.ts";
import { zod } from "../validate.ts";
import type { ProfileEnv } from "./env.ts";

export const CourseRef = z.object({ series: SeriesKey, course: Slug });

export function courseRoutes() {
  return (
    new Hono<ProfileEnv>()
      .get("/courses", async (c) => c.json(await c.var.s.lessons.courses()))
      .get("/course", zod("query", CourseRef.extend({ edition: EditionId })), async (c) => {
        const { series, course, edition } = c.req.valid("query");
        const map = await c.var.s.content.courseMap(series, course, edition);
        const lessons = lessonOrder(map.index);
        return c.json({ ...map, lessons: await c.var.s.lessons.lessonStates(lessons) });
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
      // A downloaded course or exam removed from this computer (its files no other course uses).
      .delete("/course", zod("query", CourseRef), async (c) => {
        const { series, course } = c.req.valid("query");
        return c.json(await c.var.s.downloads.remove(series, course));
      })
      // A course as a file to move to another machine (02, "Course bundle"): made ready (its name and
      // size; `edition`: that edition's only), then downloaded once, streamed.
      .post(
        "/courses/export",
        zod("json", CourseRef.extend({ edition: EditionId.optional() })),
        async (c) => {
          const { series, course, edition } = c.req.valid("json");
          return c.json(
            await c.var.s.courseTransfer.prepare(series, course, edition ? [edition] : undefined),
          );
        },
      )
      // A HEAD (Hono answers it with this GET) asks whether the file is still there: nothing taken.
      .get("/courses/export/:id", zod("param", z.object({ id: z.uuid() })), (c) => {
        const { id } = c.req.valid("param");
        if (c.req.method === "HEAD")
          return c.body(null, 200, attachment(c.var.s.courseTransfer.ready(id)));
        const file = c.var.s.courseTransfer.download(id);
        return c.body(file.stream, 200, attachment(file));
      })
      // A course bundle imported: the course installed (or found the same, or replaced), verified.
      .post("/courses/import", async (c) =>
        c.json(
          await c.var.s.courseTransfer.importUpload(
            c.req.raw.body,
            announcedLength(c.req.raw.headers),
          ),
        ),
      )
  );
}
