// /api: lesson runs — the run a lesson shows, starting or resuming one, recording its events, finishing
// it.
import { EditionId, LessonKey, SeriesKey } from "@sprachanker/schema";
import { Hono } from "hono";
import { z } from "zod";
import { zod } from "../validate.ts";
import type { ProfileEnv } from "./env.ts";
import { EventsBody, RunParam } from "./params.ts";

export function runRoutes() {
  return new Hono<ProfileEnv>()
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
    .post("/runs/:id/events", zod("param", RunParam), zod("json", EventsBody), async (c) =>
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
    );
}
