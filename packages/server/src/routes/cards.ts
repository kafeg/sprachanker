// /api/cards: cards and review as in Anki (04) — cards from a lesson's words, decks, what to study, the
// reviewer's actions — and My words with the word sheet.
import {
  CardFace,
  CardRating,
  CourseKey,
  CourseSlug,
  EditionId,
  Lang,
  LessonKey,
  SeriesKey,
  Ulid,
} from "@sprachanker/schema";
import { Hono } from "hono";
import { z } from "zod";
import { zod } from "../validate.ts";
import type { ProfileEnv } from "./env.ts";

const CardParam = z.object({ id: Ulid });
/** Every deck, a language, a course, or a lesson's own words (services/study.ts). */
const DeckScope = z.union([
  z.literal("all"),
  z.string().regex(/^lang:[a-z]{2,3}$/),
  z.templateLiteral(["course:", CourseKey]),
  z.templateLiteral(["lesson:", EditionId, ":", LessonKey]),
]);
const ok = { ok: true as const };

export function cardRoutes() {
  return (
    new Hono<ProfileEnv>()
      .post(
        "/lesson",
        zod("json", z.object({ series: SeriesKey, lessonKey: LessonKey, edition: EditionId })),
        async (c) => c.json(await c.var.s.cards.fromLesson(c.req.valid("json"))),
      )
      .get("/decks", async (c) => c.json({ decks: await c.var.s.study.decks() }))
      // Decks to take: each installed course's words (Anki: a deck), taken or left whole.
      .get("/decks/offers", async (c) => c.json({ offers: await c.var.s.cards.deckOffers() }))
      .post(
        "/decks/take",
        zod("json", z.object({ series: SeriesKey, course: CourseSlug, edition: EditionId })),
        async (c) => c.json(await c.var.s.cards.takeDeck(c.req.valid("json"))),
      )
      .post("/decks/leave", zod("json", z.object({ course: CourseKey, lang: Lang })), (c) =>
        c.json(c.var.s.cards.leaveDeck(c.req.valid("json"))),
      )
      // More new cards today in a deck (Anki's custom study).
      .post(
        "/decks/more",
        zod("json", z.object({ scope: DeckScope, count: z.number().int().min(1).max(999) })),
        (c) => {
          const { scope, count } = c.req.valid("json");
          c.var.s.study.learnMore(scope, count);
          return c.json(ok);
        },
      )
      .get("/study", zod("query", z.object({ scope: DeckScope })), async (c) =>
        c.json(await c.var.s.study.study(c.req.valid("query").scope)),
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
          return c.json({
            state: c.var.s.study.rate(
              c.req.valid("param").id,
              face,
              rating,
              { id, reps },
              c.var.deviceId,
            ),
          });
        },
      )
      .post("/undo", (c) => c.json(c.var.s.study.undo()))
      .post(
        "/:id/bury",
        zod("param", CardParam),
        zod("json", z.object({ face: CardFace.optional() })),
        (c) => {
          c.var.s.study.bury(c.req.valid("param").id, c.req.valid("json").face);
          return c.json(ok);
        },
      )
      .post("/unbury", zod("json", z.object({ scope: DeckScope })), async (c) => {
        await c.var.s.study.unbury(c.req.valid("json").scope);
        return c.json(ok);
      })
      .put(
        "/:id/suspend",
        zod("param", CardParam),
        zod("json", z.object({ suspended: z.boolean(), face: CardFace.optional() })),
        (c) => {
          const { suspended, face } = c.req.valid("json");
          c.var.s.study.suspend(c.req.valid("param").id, suspended, face);
          return c.json(ok);
        },
      )
      .put(
        "/:id/flag",
        zod("param", CardParam),
        zod("json", z.object({ face: CardFace, flag: z.number().int().min(0).max(7) })),
        (c) => {
          const { face, flag } = c.req.valid("json");
          c.var.s.study.flag(c.req.valid("param").id, face, flag);
          return c.json(ok);
        },
      )
      .put(
        "/:id/mark",
        zod("param", CardParam),
        zod("json", z.object({ marked: z.boolean() })),
        (c) => {
          c.var.s.study.mark(c.req.valid("param").id, c.req.valid("json").marked);
          return c.json(ok);
        },
      )
      // My words: the learner's words, and one word for its sheet.
      .get("/", (c) => c.json({ words: c.var.s.words.list() }))
      .get("/:id", zod("param", CardParam), (c) =>
        c.json(c.var.s.words.word(c.req.valid("param").id)),
      )
  );
}
