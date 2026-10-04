import type { AppType } from "@sprachanker/server/app";
import { hc } from "hono/client";

/** Typed client for the server's JSON API (Hono RPC, same origin). */
export const api = hc<AppType>("/").api;
