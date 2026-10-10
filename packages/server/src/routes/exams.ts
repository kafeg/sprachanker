// /api/exams: the installed exams with the learner's standing, an exam's page, and its runs — started
// (a mock exam or practice), opened, answered, handed in (09, Exams).
import { EditionId, ExamItemKey, ExamKey, ExamMode, ExamModuleId, Ulid } from "@sprachanker/schema";
import { Hono } from "hono";
import { z } from "zod";
import { zod } from "../validate.ts";
import type { ProfileEnv } from "./env.ts";

const RunParam = z.object({ id: Ulid });

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
    .post(
      "/runs/:id/events",
      zod("param", RunParam),
      zod("json", z.object({ events: z.array(z.unknown()).max(200) })),
      async (c) =>
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
        z.object({
          id: Ulid,
          itemKey: ExamItemKey,
          ratings: z.record(z.string(), z.number().nonnegative()),
          by: z.enum(["self", "assistant"]),
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
