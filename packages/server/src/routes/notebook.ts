// /api/notebook: the Notebook (09) — study days and lessons worked on, a lesson's passes, a pass in full,
// one item across passes. Read only.
import { ItemKey, LessonKey, Ulid } from "@sprachanker/schema";
import { Hono } from "hono";
import { z } from "zod";
import { zod } from "../validate.ts";
import type { ProfileEnv } from "./env.ts";

export function notebookRoutes() {
  return new Hono<ProfileEnv>()
    .get("/", async (c) => c.json(await c.var.s.notebook.overview()))
    .get("/lesson", zod("query", z.object({ lessonKey: LessonKey })), async (c) =>
      c.json(await c.var.s.notebook.lesson(c.req.valid("query").lessonKey)),
    )
    .get("/passes/:id", zod("param", z.object({ id: Ulid })), async (c) =>
      c.json(await c.var.s.notebook.pass(c.req.valid("param").id)),
    )
    .get("/item", zod("query", z.object({ itemKey: ItemKey })), (c) =>
      c.json({ passes: c.var.s.notebook.item(c.req.valid("query").itemKey) }),
    );
}
