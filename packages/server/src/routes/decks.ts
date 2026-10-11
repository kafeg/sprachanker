// /api/decks: imported decks (04, "Decks"), the server's as the library is — the list, a package
// uploaded and previewed (the .apkg as the request body, kept until imported), its import, a deck
// deleted. Taking and leaving one is a profile's: /api/cards/decks.
import { DeckId, Lang } from "@sprachanker/schema";
import { Hono } from "hono";
import { z } from "zod";
import { limitedBody } from "../media.ts";
import { DECK_MAX_BYTES } from "../services/decks.ts";
import { zod } from "../validate.ts";
import type { ProfileEnv } from "./env.ts";

export function deckRoutes() {
  return new Hono<ProfileEnv>()
    .get("/", (c) => c.json({ decks: c.var.s.decks.list() }))
    .post("/preview", limitedBody(DECK_MAX_BYTES, "deck_too_large"), async (c) =>
      c.json(await c.var.s.decks.preview(c.req.raw.body)),
    )
    .post(
      "/import",
      zod(
        "json",
        z.object({
          upload: z.uuid(),
          title: z.string().trim().min(1).max(200),
          lang: Lang,
          translationLang: Lang,
          file: z.string().max(400),
        }),
      ),
      async (c) => c.json(await c.var.s.decks.import(c.req.valid("json"))),
    )
    .delete("/:id", zod("param", z.object({ id: DeckId })), (c) => {
      c.var.s.decks.remove(c.req.valid("param").id);
      return c.json({ ok: true as const });
    });
}
