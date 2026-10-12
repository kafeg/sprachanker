// /api/addresses: where this server is reached — this machine, the local
// network, the tailnet. Behind the session check, as every route but those of choosing a profile;
// any device that reaches the server can sign in, so the Host check is what keeps other sites out.
import { Hono } from "hono";
import type { Services } from "../services/index.ts";
import type { ProfileEnv } from "./env.ts";

export const networkRoutes = (svc: Services) =>
  new Hono<ProfileEnv>().get("/addresses", async (c) => c.json(await svc.network.addresses()));
