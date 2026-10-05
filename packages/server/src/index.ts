import { totalmem } from "node:os";
import { join } from "node:path";
import { openLibrary } from "@sprachanker/course-kit";
import { createApp, type WebAssets } from "./app.ts";
import { appDataDir } from "./config.ts";
import { type Listening, listen, mediaBlob, openProfileDb, secretKey } from "./runtime/bun.ts";
import { createLocalLlm } from "./sidecars/local-llm.ts";

export type { AppType, WebAssets } from "./app.ts";
export { directoryAssets, fileAssets, type Listening } from "./runtime/bun.ts";

export interface ServerConfig {
  hostname: string;
  port: number;
  webAssets: WebAssets;
  /** Data root (05): library/ and profiles/. */
  dataRoot: string;
  appVersion: string;
}

/** Starts the HTTP server: JSON API under /api, library media and the built web app. */
export function startServer(config: ServerConfig): Listening {
  const localLlm = createLocalLlm({
    modelsDir: join(config.dataRoot, "models", "llm"),
    enginesDir: join(config.dataRoot, "engines"),
    fetch,
    memoryGb: Math.round(totalmem() / 2 ** 30),
  });
  const app = createApp({
    webAssets: config.webAssets,
    library: openLibrary(join(config.dataRoot, "library")),
    // One local profile until profiles come (06).
    profile: openProfileDb(join(config.dataRoot, "profiles", "local", "profile.sqlite")),
    mediaBlob,
    appVersion: config.appVersion,
    // Outside the data root, so a copied data folder does not carry usable API keys.
    secretKey: secretKey(join(appDataDir(), "secret.key")),
    localLlm,
  });
  const listening = listen(app.fetch, config);
  return {
    url: listening.url,
    async stop() {
      await localLlm.stop();
      await listening.stop();
    },
  };
}
export { appDataDir, resolveDataRoot } from "./config.ts";
export { type ImportRequest, importCourse, providerIds } from "./providers.ts";
