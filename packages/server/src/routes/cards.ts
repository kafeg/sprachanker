// /api/cards: cards and review as in Anki (04) — cards from a lesson's words, decks, what to study, the
// reviewer's actions — and My words with the word sheet.
import {
  CardFace,
  CardRating,
  CourseKey,
  EditionId,
  LessonKey,
  SeriesKey,
  Ulid,
} from "@sprachanker/schema";
import { Hono } from "hono";
import { z } from "zod";
import type { Cards } from "../services/cards.ts";
import type { Study } from "../services/study.ts";
import type { Words } from "../services/words.ts";
import { zod } from "../validate.ts";

const CardParam = z.object({ id: Ulid });
/** Every deck, a language, a course, or a lesson's own words (services/study.ts). */
const DeckScope = z.union([
  z.literal("all"),
  z.string().regex(/^lang:[a-z]{2,3}$/),
  z.templateLiteral(["course:", CourseKey]),
  z.templateLiteral(["lesson:", LessonKey]),
]);
const ok = { ok: true as const };

export function cardRoutes(deps: { cards: Cards; study: Study; words: Words }) {
  const { cards, study, words } = deps;
  return (
    new Hono()
      .post(
        "/lesson",
        zod("json", z.object({ series: SeriesKey, lessonKey: LessonKey, edition: EditionId })),
        async (c) => c.json(await cards.fromLesson(c.req.valid("json"))),
      )
      .get("/decks", async (c) => c.json({ decks: await study.decks() }))
      .get("/study", zod("query", z.object({ scope: DeckScope })), async (c) =>
        c.json(await study.study(c.req.valid("query").scope)),
      )
      .post(
        "/:id/review",
        zod("param", CardParam),
        zod(
          "json",
          z.object({ id: Ulid, face: CardFace, rating: CardRating, reps: z.number().int().min(0) }),
        ),
        (c) => {
          const { id, face, rating, reps } = c.req.valid("json");
          return c.json({ state: study.rate(c.req.valid("param").id, face, rating, { id, reps }) });
        },
      )
      .post("/undo", (c) => c.json(study.undo()))
      .post(
        "/:id/bury",
        zod("param", CardParam),
        zod("json", z.object({ face: CardFace.optional() })),
        (c) => {
          study.bury(c.req.valid("param").id, c.req.valid("json").face);
          return c.json(ok);
        },
      )
      .post("/unbury", zod("json", z.object({ scope: DeckScope })), async (c) => {
        await study.unbury(c.req.valid("json").scope);
        return c.json(ok);
      })
      .put(
        "/:id/suspend",
        zod("param", CardParam),
        zod("json", z.object({ suspended: z.boolean(), face: CardFace.optional() })),
        (c) => {
          const { suspended, face } = c.req.valid("json");
          study.suspend(c.req.valid("param").id, suspended, face);
          return c.json(ok);
        },
      )
      .put(
        "/:id/flag",
        zod("param", CardParam),
        zod("json", z.object({ face: CardFace, flag: z.number().int().min(0).max(7) })),
        (c) => {
          const { face, flag } = c.req.valid("json");
          study.flag(c.req.valid("param").id, face, flag);
          return c.json(ok);
        },
      )
      .put(
        "/:id/mark",
        zod("param", CardParam),
        zod("json", z.object({ marked: z.boolean() })),
        (c) => {
          study.mark(c.req.valid("param").id, c.req.valid("json").marked);
          return c.json(ok);
        },
      )
      // My words: the learner's words, and one word for its sheet.
      .get("/", (c) => c.json({ words: words.list() }))
      .get("/:id", zod("param", CardParam), (c) => c.json(words.word(c.req.valid("param").id)))
  );
}
