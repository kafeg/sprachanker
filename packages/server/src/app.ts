// Runtime-agnostic Hono app. apps/web imports `AppType` from here (type-only), so this module graph
// must stay free of Bun/Node APIs; those live in src/runtime/.
import { Hono } from "hono";
import { serveWeb, type WebAssets } from "./web.ts";

export type { WebAssets } from "./web.ts";

export interface AppConfig {
  webAssets: WebAssets;
}

export function createApp(config: AppConfig) {
  const api = new Hono().get("/health", (c) => c.json({ status: "ok" as const }));
  return new Hono()
    .route("/api", api)
    .all("/api/*", (c) => c.json({ error: "not_found" }, 404))
    .get("*", serveWeb(config.webAssets));
}

export type AppType = ReturnType<typeof createApp>;
