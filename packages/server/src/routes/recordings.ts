// /api/recordings: the learner's recordings (08) — one saved from the request body as the browser
// recorded it (its type in Content-Type), one played (with ranges, as audio elements ask), how many
// are kept and their size, and all of them removed.
import { Ulid } from "@sprachanker/schema";
import { Hono } from "hono";
import { z } from "zod";
import { ServiceError } from "../errors.ts";
import { blobResponse } from "../media.ts";
import { RECORDING_MAX_BYTES } from "../services/recordings.ts";
import { zod } from "../validate.ts";
import type { ProfileEnv } from "./env.ts";

export function recordingsRoutes() {
  return new Hono<ProfileEnv>()
    .get("/", (c) => c.json(c.var.s.recordings.stats()))
    .post("/", async (c) => {
      // A body announced as larger than allowed is refused before it is read.
      if (Number(c.req.header("content-length") ?? 0) > RECORDING_MAX_BYTES)
        throw new ServiceError("recording_too_large", 413);
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      return c.json(await c.var.s.recordings.save(bytes, c.req.header("content-type") ?? ""));
    })
    .get("/:id", zod("param", z.object({ id: Ulid })), (c) =>
      blobResponse(c.var.s.recordings.file(c.req.valid("param").id), c.req.header("range")),
    )
    .delete("/", (c) => c.json({ removed: c.var.s.recordings.remove() }));
}
