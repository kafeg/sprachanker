import { hostname } from "node:os";
import { join } from "node:path";
import { openLibrary, verifyLibrary } from "@sprachanker/course-kit";
import { createApp, type WebAssets } from "./app.ts";
import { appDataDir } from "./config.ts";
import { courseInstaller } from "./providers.ts";
import { startDailyBackups } from "./runtime/backup.ts";
import {
  type Listening,
  listen,
  mediaBlob,
  openServerDb,
  profileFiles,
  secretKey,
} from "./runtime/bun.ts";
import { cliHost } from "./runtime/cli.ts";
import { holdDataRoot, serverOn } from "./runtime/data-root.ts";
import { apkgRuntime, deckFiles } from "./runtime/decks.ts";
import { lmStudioHost } from "./runtime/lmstudio.ts";
import { networkHost } from "./runtime/network.ts";
import { piperHost } from "./runtime/piper.ts";
import { readingCache } from "./runtime/readings.ts";
import { speechHost } from "./runtime/speech.ts";
import { createProfiles } from "./services/profiles.ts";

export type { AppType, WebAssets } from "./app.ts";
export { directoryAssets, fileAssets, type Listening } from "./runtime/bun.ts";

export interface ServerConfig {
  hostname: string;
  port: number;
  webAssets: WebAssets;
  /** Data root (05): library/, decks/ and profiles/. */
  dataRoot: string;
  appVersion: string;
  /** More names the Host check accepts (`--allow-host`): a name this machine is reached by that it
   *  cannot know itself, as a reverse proxy's. */
  allowHosts?: string[];
}

/** Starts the HTTP server: JSON API under /api, library and deck media and the built web app. */
export function startServer(config: ServerConfig): Listening {
  holdDataRoot(config.dataRoot);
  const app = createApp({
    webAssets: config.webAssets,
    library: openLibrary(join(config.dataRoot, "library")),
    server: openServerDb(join(config.dataRoot, "server.sqlite")),
    profiles: profileFiles(config.dataRoot),
    mediaBlob,
    decks: deckFiles(config.dataRoot),
    apkg: apkgRuntime,
    appVersion: config.appVersion,
    // Outside the data root, so a copied data folder does not carry usable API keys.
    secretKey: secretKey(join(appDataDir(), "secret.key")),
    lmStudio: lmStudioHost(),
    cli: cliHost(),
    installer: courseInstaller(config.dataRoot),
    speech: speechHost(config.dataRoot),
    piper: piperHost(config.dataRoot),
    readings: readingCache(config.dataRoot),
    // The machine's own names: its host name, the one the server was told to listen on, those it was
    // given (`--allow-host`); its tailnet name is read from Tailscale (`network`).
    hosts: [hostname(), `${hostname()}.local`, config.hostname],
    allowHosts: config.allowHosts,
    listensOn: { hostname: config.hostname, port: config.port },
    network: networkHost(),
  });
  // After the app: its databases exist and are migrated.
  startDailyBackups(config.dataRoot);
  return listen(app.fetch, config);
}
export { resolveDataRoot } from "./config.ts";
export { type ImportRequest, importCourse, providerIds } from "./providers.ts";
export { ENGINES as speechEngines, triple as targetTriple } from "./runtime/engines.ts";

/** Checks every installed course of the data root (course-kit verify). */
export const verifyData = (dataRoot: string) =>
  verifyLibrary(openLibrary(join(dataRoot, "library")));

/**
 * The server's profile matters for the `sprachanker profiles` command (06, "Profiles and access"):
 * list them, open or close registration, delete one. Not in the app.
 */
export function profileAdmin(dataRoot: string) {
  const profiles = createProfiles({
    db: openServerDb(join(dataRoot, "server.sqlite")),
    files: profileFiles(dataRoot),
    now: Date.now,
  });
  profiles.adoptFirst();
  return {
    ...profiles,
    /** Deletes a profile with its data — not while a server holds its database open. */
    remove(id: string) {
      const pid = serverOn(dataRoot);
      if (pid) throw new Error(`a server (pid ${pid}) is running on ${dataRoot}: stop it first`);
      profiles.remove(id);
    },
  };
}
