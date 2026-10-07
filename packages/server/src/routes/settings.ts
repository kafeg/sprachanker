// /api/settings: the learner's settings (the keys the learner owns; service settings have their own
// routes, e.g. /api/llm).
import { Hono } from "hono";
import { z } from "zod";
import { zod } from "../validate.ts";
import type { ProfileEnv } from "./env.ts";

export function settingsRoutes() {
  return new Hono<ProfileEnv>()
    .get("/", (c) => c.json(c.var.s.settings.all()))
    .put(
      "/",
      zod("json", z.object({ key: z.string().min(1).max(300), value: z.unknown() })),
      (c) => {
        const { key, value } = c.req.valid("json");
        c.var.s.settings.setByLearner(key, value);
        return c.json(c.var.s.settings.all());
      },
    );
}
