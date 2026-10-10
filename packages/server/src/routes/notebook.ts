// /api/notebook: the Notebook (09) — the study days and every module's standing; a lesson's journal (its
// passes, a pass in full, one item across passes); an exam's page. Reads only, but for one thing: a
// mock exam left past its time is handed in as the exams' standing or an exam's page is read.
import { ExamKey, ItemKey, LessonKey } from "@sprachanker/schema";
import { Hono } from "hono";
import { z } from "zod";
import { zod } from "../validate.ts";
import type { ProfileEnv } from "./env.ts";
import { RunParam } from "./params.ts";

export function notebookRoutes() {
  return new Hono<ProfileEnv>()
    .get("/", async (c) => c.json(await c.var.s.notebook.overview()))
    .get("/lesson", zod("query", z.object({ lessonKey: LessonKey })), async (c) =>
      c.json(await c.var.s.lessonJournal.lesson(c.req.valid("query").lessonKey)),
    )
    .get("/passes/:id", zod("param", RunParam), async (c) =>
      c.json(await c.var.s.lessonJournal.pass(c.req.valid("param").id)),
    )
    .get("/item", zod("query", z.object({ itemKey: ItemKey })), (c) =>
      c.json({ passes: c.var.s.lessonJournal.item(c.req.valid("query").itemKey) }),
    )
    .get("/exam", zod("query", z.object({ exam: ExamKey })), async (c) =>
      c.json(await c.var.s.exams.journal(c.req.valid("query").exam)),
    );
}
