// /api/recordings: the learner's recordings (08) — one saved from the request body as the browser
// recorded it (its type in Content-Type), one played (with ranges, as audio elements ask), how many
// are kept and their size, one nothing was heard in removed, and all of them removed.
import { Ulid } from "@sprachanker/schema";
import { Hono } from "hono";
import { z } from "zod";
import { audioBody, blobResponse } from "../media.ts";
import { RECORDING_MAX_BYTES } from "../services/recordings.ts";
import { zod } from "../validate.ts";
import type { ProfileEnv } from "./env.ts";

export function recordingsRoutes() {
  return (
    new Hono<ProfileEnv>()
      .get("/", (c) => c.json(c.var.s.recordings.stats()))
      .post("/", audioBody(RECORDING_MAX_BYTES), async (c) => {
        const bytes = new Uint8Array(await c.req.arrayBuffer());
        return c.json(await c.var.s.recordings.save(bytes, c.req.header("content-type") ?? ""));
      })
      .get("/:id", zod("param", z.object({ id: Ulid })), (c) => {
        const { blob, name } = c.var.s.recordings.file(c.req.valid("param").id);
        return blobResponse(blob, c.req.header("range"), name);
      })
      // A take nothing was heard in (kept while it was heard, 08): gone unless an answer holds it.
      .delete("/:id", zod("param", z.object({ id: Ulid })), (c) =>
        c.json({ removed: c.var.s.recordings.forget(c.req.valid("param").id) }),
      )
      .delete("/", (c) => c.json({ removed: c.var.s.recordings.remove() }))
  );
}
