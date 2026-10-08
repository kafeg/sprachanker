import { hostname } from "node:os";
import { join } from "node:path";
import { openLibrary, verifyLibrary } from "@sprachanker/course-kit";
import { createApp, type WebAssets } from "./app.ts";
import { appDataDir } from "./config.ts";
import { courseInstaller } from "./providers.ts";
import {
  type Listening,
  listen,
  mediaBlob,
  openServerDb,
  profileFiles,
  secretKey,
} from "./runtime/bun.ts";
import { cliHost } from "./runtime/cli.ts";
import { lmStudioHost } from "./runtime/lmstudio.ts";
import { createProfiles } from "./services/profiles.ts";

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
    server: openServerDb(join(config.dataRoot, "server.sqlite")),
    profiles: profileFiles(config.dataRoot),
    mediaBlob,
    appVersion: config.appVersion,
    // Outside the data root, so a copied data folder does not carry usable API keys.
    secretKey: secretKey(join(appDataDir(), "secret.key")),
    lmStudio: lmStudioHost(),
    cli: cliHost(),
    installer: courseInstaller(config.dataRoot),
    // The machine's own names: its host name, and the one the server was told to listen on.
    hosts: [hostname(), `${hostname()}.local`, config.hostname],
  });
  return listen(app.fetch, config);
}
export { resolveDataRoot } from "./config.ts";
export { type ImportRequest, importCourse, providerIds } from "./providers.ts";

/** Checks every installed course of the data root (course-kit verify). */
export const verifyData = (dataRoot: string) =>
  verifyLibrary(openLibrary(join(dataRoot, "library")));

/**
 * The server's profile matters for the `sprachanker profiles` command (06, "Profiles and access"):
 * list them, open or close registration, reset a profile's PIN, delete one. Not in the app.
 */
export function profileAdmin(dataRoot: string) {
  const profiles = createProfiles({
    db: openServerDb(join(dataRoot, "server.sqlite")),
    files: profileFiles(dataRoot),
    now: Date.now,
  });
  profiles.adoptFirst();
  return profiles;
}
