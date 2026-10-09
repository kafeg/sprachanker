// /api: lesson runs — the run a lesson shows, starting or resuming one, recording its events, finishing
// it; resetting a course's or a lesson's progress.
import { courseKey, EditionId, LessonKey, SeriesKey, Ulid } from "@sprachanker/schema";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { zod } from "../validate.ts";
import { CourseRef } from "./courses.ts";
import type { ProfileEnv } from "./env.ts";

const RunParam = z.object({ id: Ulid });

export function runRoutes() {
  return (
    new Hono<ProfileEnv>()
      .get(
        "/runs/lesson",
        zod("query", z.object({ series: SeriesKey, lessonKey: LessonKey })),
        async (c) => {
          const { series, lessonKey } = c.req.valid("query");
          return c.json({ state: await c.var.s.runs.lessonState(series, lessonKey) });
        },
      )
      .post(
        "/runs",
        zod(
          "json",
          z.object({
            series: SeriesKey,
            lessonKey: LessonKey,
            edition: EditionId,
            restart: z.boolean().optional(),
          }),
        ),
        async (c) => {
          const { series, lessonKey, edition, restart } = c.req.valid("json");
          return c.json(await c.var.s.runs.start(series, lessonKey, edition, restart));
        },
      )
      .post(
        "/runs/:id/events",
        zod("param", RunParam),
        zod("json", z.object({ events: z.array(z.unknown()).max(200) })),
        async (c) =>
          c.json(
            await c.var.s.runs.append(
              c.req.valid("param").id,
              c.req.valid("json").events,
              c.var.deviceId,
            ),
          ),
      )
      .post("/runs/:id/finish", zod("param", RunParam), async (c) =>
        c.json(await c.var.s.runs.finish(c.req.valid("param").id)),
      )
      // Resetting progress: a whole course (it leaves "My courses") or one of its lessons.
      .post(
        "/progress/reset",
        zod("json", CourseRef.extend({ lesson: LessonKey.optional() })),
        (c) => {
          const { series, course, lesson } = c.req.valid("json");
          const key = courseKey(series, course);
          if (lesson && !lesson.startsWith(`${key}/`))
            throw new HTTPException(400, { message: "lesson is not in this course" });
          return c.json(c.var.s.runs.reset(key, lesson));
        },
      )
  );
}
