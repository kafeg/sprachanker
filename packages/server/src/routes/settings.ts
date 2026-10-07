// /api/settings: the learner's settings (the keys the learner owns; service settings have their own
// routes, e.g. /api/llm).
import { Hono } from "hono";
import { z } from "zod";
import type { Settings } from "../services/settings.ts";
import { zod } from "../validate.ts";

export function settingsRoutes(settings: Settings) {
  return new Hono()
    .get("/", (c) => c.json(settings.all()))
    .put(
      "/",
      zod("json", z.object({ key: z.string().min(1).max(300), value: z.unknown() })),
      (c) => {
        const { key, value } = c.req.valid("json");
        settings.setByLearner(key, value);
        return c.json(settings.all());
      },
    );
}
