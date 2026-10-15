// /api/decks: imported decks, the server's as the library is — the list, a package
// uploaded and previewed (the .apkg as the request body, kept until imported or let go), its import,
// a deck deleted —; any deck as a file (`.sprachanker-deck`): exported, uploaded and previewed, then
// imported; and any deck's words, taken or not, read aloud or given examples by the AI (what was made
// removed, or made again). Taking and leaving one is a profile's: /api/cards/decks.
import { DeckId, EditionId, Lang } from "@sprachanker/schema";
import { Hono } from "hono";
import { z } from "zod";
import { announcedLength, attachment } from "../media.ts";
import { sniffDeckFile } from "../services/deck-transfer.ts";
import { zod } from "../validate.ts";
import type { ProfileEnv } from "./env.ts";
import { TakenDeck } from "./params.ts";

const DeckScope = z.object({ scope: z.string().pipe(TakenDeck) });
/** A deck's words in an edition: a course's in each of its editions (its first when none is named). */
const DeckEdition = DeckScope.extend({ edition: EditionId.optional() });
/** `again`: what was made goes first, made anew. */
const Again = { again: z.boolean().optional() };

export function deckRoutes() {
  return (
    new Hono<ProfileEnv>()
      .get("/", (c) => c.json({ decks: c.var.s.decks.list() }))
      // A deck file uploaded and previewed — an .apkg, or one of the app's own (.sprachanker-deck),
      // told by its content —, kept until imported by its upload's id or let go.
      .post("/preview", async (c) => {
        const length = announcedLength(c.req.raw.headers);
        const { deckFile, body } = await sniffDeckFile(c.req.raw.body, length);
        return c.json(
          deckFile
            ? await c.var.s.deckTransfer.preview(body, length)
            : await c.var.s.decks.preview(body, length),
        );
      })
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
      // A deck the profile sees as a file: made ready (its name and size), then downloaded once,
      // streamed (a HEAD — Hono answers it with the GET — asks whether it is still there).
      .post("/export", zod("json", DeckScope), async (c) =>
        c.json(await c.var.s.deckTransfer.prepare(c.req.valid("json").scope)),
      )
      .get("/export/:id", zod("param", z.object({ id: z.uuid() })), (c) => {
        const { id } = c.req.valid("param");
        if (c.req.method === "HEAD")
          return c.body(null, 200, attachment(c.var.s.deckTransfer.ready(id)));
        const file = c.var.s.deckTransfer.download(id);
        return c.body(file.stream, 200, attachment(file));
      })
      // A deck file of the app's own previewed (/preview) imported by its upload's id.
      .post("/file/import", zod("json", z.object({ upload: z.uuid() })), async (c) =>
        c.json(await c.var.s.deckTransfer.import(c.req.valid("json").upload)),
      )
      // A deck's words read aloud (a course's or an imported one's): its counts and job, the job started
      // (with this profile's engine and voice; `again`: what was read removed first) or stopped, what was
      // read removed.
      .get("/audio", zod("query", DeckScope), async (c) =>
        c.json(await c.var.s.deckAudio.state(c.req.valid("query").scope)),
      )
      .post("/audio", zod("json", DeckScope.extend(Again)), async (c) => {
        const { scope, again } = c.req.valid("json");
        await c.var.s.deckAudio.start(scope, again);
        return c.json(await c.var.s.deckAudio.state(scope));
      })
      .post("/audio/remove", zod("json", DeckScope), async (c) => {
        const { scope } = c.req.valid("json");
        await c.var.s.deckAudio.remove(scope);
        return c.json(await c.var.s.deckAudio.state(scope));
      })
      .delete("/audio", zod("query", DeckScope), async (c) => {
        const { scope } = c.req.valid("query");
        await c.var.s.deckAudio.stop(scope);
        return c.json(await c.var.s.deckAudio.state(scope));
      })
      // A deck's words in an edition given examples by the AI: its counts and job, the job started
      // (with this profile's model; `again`: those made removed first) or stopped, those made removed,
      // the request its next call would send.
      .get("/examples", zod("query", DeckEdition), async (c) => {
        const { scope, edition } = c.req.valid("query");
        return c.json(await c.var.s.examples.state(scope, edition));
      })
      .post("/examples", zod("json", DeckEdition.extend(Again)), async (c) => {
        const { scope, edition, again } = c.req.valid("json");
        return c.json(await c.var.s.examples.start(scope, edition, again));
      })
      .delete("/examples", zod("query", DeckEdition), async (c) => {
        const { scope, edition } = c.req.valid("query");
        return c.json(await c.var.s.examples.stop(scope, edition));
      })
      .post("/examples/remove", zod("json", DeckEdition), async (c) => {
        const { scope, edition } = c.req.valid("json");
        return c.json(await c.var.s.examples.remove(scope, edition));
      })
      .post("/examples/prompt", zod("json", DeckEdition), async (c) => {
        const { scope, edition } = c.req.valid("json");
        return c.json(await c.var.s.examples.prompt(scope, edition));
      })
      .delete("/uploads/:upload", zod("param", z.object({ upload: z.uuid() })), (c) => {
        const { upload } = c.req.valid("param");
        c.var.s.decks.discard(upload);
        c.var.s.deckTransfer.discard(upload);
        return c.json({ ok: true as const });
      })
      .delete("/:id", zod("param", z.object({ id: DeckId })), (c) => {
        c.var.s.decks.remove(c.req.valid("param").id);
        return c.json({ ok: true as const });
      })
  );
}
