// /api/update: whether a newer version is out and how this build is updated; /api/update/install:
// the newer release installed by the runtime itself (the phone app), the system's installer then
// asking the learner. Behind the session check: only a device signed in starts a download.
import { Hono } from "hono";
import type { Services } from "../services/index.ts";
import type { ProfileEnv } from "./env.ts";

export const updateRoutes = (svc: Services) =>
  new Hono<ProfileEnv>()
    .get("/update", async (c) => c.json(await svc.updates.status()))
    .post("/update/install", async (c) => {
      await svc.updates.install();
      return c.json({ ok: true as const });
    });
