// /api/notebook: the Notebook — the study days and every module's standing; a lesson's journal (its
// passes, a pass in full, one item across passes); a review day in full (a deck's with `?lang=`); an exam's page. Reads only, but for one thing: a
// mock exam left past its time is handed in as the exams' standing or an exam's page is read.
import { ExamKey, ItemKey, Lang, LessonKey } from "@sprachanker/schema";
import { Hono } from "hono";
import { z } from "zod";
import { zod } from "../validate.ts";
import type { ProfileEnv } from "./env.ts";
import { RunParam } from "./params.ts";

/** The day a week of the pictures starts on (0 Sunday … 6 Saturday; Monday unless told). */
const OverviewQuery = z.object({
  firstDay: z
    .string()
    .regex(/^[0-6]$/)
    .transform(Number)
    .optional(),
});

export function notebookRoutes() {
  return new Hono<ProfileEnv>()
    .get("/", zod("query", OverviewQuery), async (c) =>
      c.json(await c.var.s.notebook.overview(c.req.valid("query").firstDay)),
    )
    .get("/lesson", zod("query", z.object({ lessonKey: LessonKey })), async (c) =>
      c.json(await c.var.s.lessonJournal.lesson(c.req.valid("query").lessonKey)),
    )
    .get("/passes/:id", zod("param", RunParam), async (c) =>
      c.json(await c.var.s.lessonJournal.pass(c.req.valid("param").id)),
    )
    .get("/item", zod("query", z.object({ itemKey: ItemKey })), async (c) =>
      c.json({ passes: await c.var.s.lessonJournal.item(c.req.valid("query").itemKey) }),
    )
    .get(
      "/review/:id",
      zod("param", RunParam),
      zod("query", z.object({ lang: Lang.optional() })),
      async (c) =>
        c.json(await c.var.s.study.reviewDay(c.req.valid("param").id, c.req.valid("query").lang)),
    )
    .get("/exam", zod("query", z.object({ exam: ExamKey })), async (c) =>
      c.json(await c.var.s.exams.journal(c.req.valid("query").exam)),
    );
}
