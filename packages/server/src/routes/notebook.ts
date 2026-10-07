// /api/notebook: the Notebook (09) — study days and lessons worked on, a lesson's passes, a pass in full,
// one item across passes. Read only.
import { ItemKey, LessonKey, Ulid } from "@sprachanker/schema";
import { Hono } from "hono";
import { z } from "zod";
import type { Notebook } from "../services/notebook.ts";
import { zod } from "../validate.ts";

export function notebookRoutes(notebook: Notebook) {
  return new Hono()
    .get("/", async (c) => c.json(await notebook.overview()))
    .get("/lesson", zod("query", z.object({ lessonKey: LessonKey })), async (c) =>
      c.json(await notebook.lesson(c.req.valid("query").lessonKey)),
    )
    .get("/passes/:id", zod("param", z.object({ id: Ulid })), async (c) =>
      c.json(await notebook.pass(c.req.valid("param").id)),
    )
    .get("/item", zod("query", z.object({ itemKey: ItemKey })), (c) =>
      c.json({ passes: notebook.item(c.req.valid("query").itemKey) }),
    );
}
