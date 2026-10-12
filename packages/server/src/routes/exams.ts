// /api/exams: the installed exams with the learner's standing, an exam's page, and its runs — started
// (a mock exam or practice), opened, answered, handed in.
import {
  EditionId,
  ExamItemKey,
  ExamKey,
  ExamMode,
  ExamModuleId,
  ExamRatedPayload,
  Ulid,
} from "@sprachanker/schema";
import { Hono } from "hono";
import { z } from "zod";
import { zod } from "../validate.ts";
import type { ProfileEnv } from "./env.ts";
import { EventsBody, RunParam } from "./params.ts";

export function examRoutes() {
  return new Hono<ProfileEnv>()
    .get("/", async (c) => c.json(await c.var.s.exams.list()))
    .get("/page", zod("query", z.object({ exam: ExamKey, edition: EditionId })), async (c) => {
      const { exam, edition } = c.req.valid("query");
      return c.json(await c.var.s.exams.page(exam, edition));
    })
    .post(
      "/runs",
      zod(
        "json",
        z.object({
          exam: ExamKey,
          edition: EditionId,
          mode: ExamMode,
          module: ExamModuleId.optional(),
        }),
      ),
      async (c) => {
        const { exam, edition, mode, module } = c.req.valid("json");
        return c.json(await c.var.s.exams.start(exam, edition, mode, module));
      },
    )
    .get("/runs/:id", zod("param", RunParam), async (c) =>
      c.json(await c.var.s.exams.open(c.req.valid("param").id)),
    )
    .post("/runs/:id/events", zod("param", RunParam), zod("json", EventsBody), async (c) =>
      c.json(
        await c.var.s.exams.append(
          c.req.valid("param").id,
          c.req.valid("json").events,
          c.var.deviceId,
        ),
      ),
    )
    .post(
      "/runs/:id/ratings",
      zod("param", RunParam),
      zod(
        "json",
        ExamRatedPayload.extend({
          id: Ulid,
          itemKey: ExamItemKey,
          model: z.string().max(200).optional(),
        }),
      ),
      async (c) =>
        c.json(
          await c.var.s.exams.rate(c.req.valid("param").id, c.req.valid("json"), c.var.deviceId),
        ),
    )
    .post("/runs/:id/finish", zod("param", RunParam), async (c) =>
      c.json(await c.var.s.exams.finish(c.req.valid("param").id)),
    );
}
