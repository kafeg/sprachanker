import { join } from "node:path";
import { openLibrary, verifyLibrary } from "@sprachanker/course-kit";
import { createApp, type WebAssets } from "./app.ts";
import { appDataDir } from "./config.ts";
import { courseInstaller } from "./providers.ts";
import { type Listening, listen, mediaBlob, openProfileDb, secretKey } from "./runtime/bun.ts";
import { cliHost } from "./runtime/cli.ts";
import { lmStudioHost } from "./runtime/lmstudio.ts";

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
  const app = createApp({
    webAssets: config.webAssets,
    library: openLibrary(join(config.dataRoot, "library")),
    // One local profile until profiles come (06).
    profile: openProfileDb(join(config.dataRoot, "profiles", "local", "profile.sqlite")),
    mediaBlob,
    appVersion: config.appVersion,
    // Outside the data root, so a copied data folder does not carry usable API keys.
    secretKey: secretKey(join(appDataDir(), "secret.key")),
    lmStudio: lmStudioHost(),
    cli: cliHost(),
    installer: courseInstaller(config.dataRoot),
  });
  return listen(app.fetch, config);
}
export { appDataDir, resolveDataRoot } from "./config.ts";
export { type ImportRequest, importCourse, providerIds } from "./providers.ts";

/** Checks every installed course of the data root (course-kit verify). */
export const verifyData = (dataRoot: string) =>
  verifyLibrary(openLibrary(join(dataRoot, "library")));
