// /api/decks: imported decks (04, "Decks"), the server's as the library is — the list, a package's
// preview, an import (the .apkg as the request body), a deck deleted. Taking and leaving one is a
// profile's: /api/cards/decks.
import { DeckId, Lang } from "@sprachanker/schema";
import { Hono } from "hono";
import { z } from "zod";
import { limitedBody } from "../media.ts";
import { DECK_MAX_BYTES } from "../services/decks.ts";
import { zod } from "../validate.ts";
import type { ProfileEnv } from "./env.ts";

const packageBody = limitedBody(DECK_MAX_BYTES, "deck_too_large");

export function deckRoutes() {
  return new Hono<ProfileEnv>()
    .get("/", (c) => c.json({ decks: c.var.s.decks.list() }))
    .post("/preview", packageBody, async (c) =>
      c.json(c.var.s.decks.preview(new Uint8Array(await c.req.arrayBuffer()))),
    )
    .post(
      "/import",
      packageBody,
      zod(
        "query",
        z.object({
          title: z.string().trim().min(1).max(200),
          lang: Lang,
          translationLang: Lang,
          file: z.string().max(400),
        }),
      ),
      async (c) =>
        c.json(
          await c.var.s.decks.import(
            new Uint8Array(await c.req.arrayBuffer()),
            c.req.valid("query"),
          ),
        ),
    )
    .delete("/:id", zod("param", z.object({ id: DeckId })), (c) => {
      c.var.s.decks.remove(c.req.valid("param").id);
      return c.json({ ok: true as const });
    });
}
