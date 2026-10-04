import { createApp, type WebAssets } from "./app.ts";
import { type Listening, listen } from "./runtime/bun.ts";

export type { AppType, WebAssets } from "./app.ts";
export { directoryAssets, fileAssets, type Listening } from "./runtime/bun.ts";

export interface ServerConfig {
  hostname: string;
  port: number;
  webAssets: WebAssets;
}

/** Starts the HTTP server: JSON API under /api and the built web app. */
export function startServer(config: ServerConfig): Listening {
  return listen(createApp(config).fetch, config);
}
