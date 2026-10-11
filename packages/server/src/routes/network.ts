// /api/addresses: where this server is reached (06, "Network and HTTPS") — this machine, the local
// network, the tailnet. Behind the session check, as every route but those of choosing a profile:
// the machine's addresses are told only to a device signed in here, and only a profile's screens
// show them.
import { Hono } from "hono";
import type { Services } from "../services/index.ts";
import type { ProfileEnv } from "./env.ts";

export const networkRoutes = (svc: Services) =>
  new Hono<ProfileEnv>().get("/addresses", async (c) => c.json(await svc.network.addresses()));
