import { hostname } from "node:os";
import { join } from "node:path";
import { openLibrary, verifyLibrary } from "@sprachanker/course-kit";
import { Deck } from "@sprachanker/schema";
import { createApp, type WebAssets } from "./app.ts";
import { appDataDir } from "./config.ts";
import { courseInstaller } from "./providers.ts";
import { backUpTo, startDailyBackups } from "./runtime/backup.ts";
import {
  type Listening,
  listen,
  mediaBlob,
  openServerDb,
  profileFiles,
  secretKey,
} from "./runtime/bun.ts";
import { cliHost } from "./runtime/cli.ts";
import { courseTransferFiles } from "./runtime/course-transfer.ts";
import { holdDataRoot, serverOn } from "./runtime/data-root.ts";
import { apkgRuntime, deckFiles } from "./runtime/decks.ts";
import { lmStudioHost } from "./runtime/lmstudio.ts";
import { networkHost } from "./runtime/network.ts";
import { piperHost } from "./runtime/piper.ts";
import { profileTransferFiles } from "./runtime/profile-transfer.ts";
import { readingCache } from "./runtime/readings.ts";
import { speechHost } from "./runtime/speech.ts";
import { createCardStore } from "./services/card-store.ts";
import { createContent } from "./services/content.ts";
import { createCourseTransfer } from "./services/course-transfer.ts";
import { contentUsed, createProfileTransfer } from "./services/profile-transfer.ts";
import { createProfiles } from "./services/profiles.ts";
import { createRunStore } from "./services/run-store.ts";
import { parseJson } from "./services/stored.ts";

export type { AppType, WebAssets } from "./app.ts";
export { directoryAssets, fileAssets, type Listening } from "./runtime/bun.ts";
export { PROFILE_DB_WORKER } from "./runtime/profile-transfer.ts";

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
  /** The Worker that makes an imported profile's database ready, as the compiled binary embeds it;
   *  from sources the server finds its own (PROFILE_DB_WORKER). */
  profileDbWorker?: string;
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
    transfers: profileTransferFiles(config.dataRoot, { worker: config.profileDbWorker }),
    courseTransfers: courseTransferFiles(config.dataRoot),
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
 * list them, open or close registration, delete one, export one to a file or import one from a file
 * (05, "Profile file"). Not in the app.
 */
export function profileAdmin(
  dataRoot: string,
  appVersion = "",
  options: Pick<ServerConfig, "profileDbWorker"> = {},
) {
  const files = profileFiles(dataRoot);
  const profiles = createProfiles({
    db: openServerDb(join(dataRoot, "server.sqlite")),
    files,
    now: Date.now,
  });
  profiles.adoptFirst();
  const decks = deckFiles(dataRoot);
  const transfer = createProfileTransfer({
    files: profileTransferFiles(dataRoot, {
      worker: options.profileDbWorker,
      // A server running on the data root keeps its transfers: they are its to sweep.
      sweeps: () => !serverOn(dataRoot),
    }),
    profiles,
    used: (id) => {
      const db = files.open(id);
      return contentUsed(createRunStore({ db, now: Date.now, appVersion }), createCardStore(db));
    },
    content: createContent(openLibrary(join(dataRoot, "library"))),
    // The imported decks' titles, read as stored (none that does not read).
    decks: () =>
      decks.ids().flatMap((id) => {
        const deck = Deck.safeParse(parseJson(decks.read(id) ?? ""));
        return deck.success ? [{ id, title: deck.data.title }] : [];
      }),
    appVersion,
    now: Date.now,
  });
  /** A profile by its id, else by its name (any case); one only. */
  const find = (nameOrId: string) => {
    const all = profiles.list();
    const named = all.filter((p) => p.name.toLocaleLowerCase() === nameOrId.toLocaleLowerCase());
    const found = all.find((p) => p.id === nameOrId) ?? (named.length === 1 ? named[0] : undefined);
    if (found) return found;
    throw new Error(
      named.length
        ? `${named.length} profiles are named ${nameOrId}: give the id (sprachanker profiles lists them)`
        : `no profile ${nameOrId} (sprachanker profiles lists them)`,
    );
  };
  return {
    ...profiles,
    find,
    /** Deletes a profile with its data — not while a server holds its database open. */
    remove(id: string) {
      const pid = serverOn(dataRoot);
      if (pid) throw new Error(`a server (pid ${pid}) is running on ${dataRoot}: stop it first`);
      profiles.remove(id);
    },
    exportTo: transfer.exportTo,
    importFile: transfer.importFile,
  };
}

/**
 * The data root's courses for the `sprachanker courses` command (02, "Course bundle"): those
 * installed, one exported to a file, a file imported — also while a server runs on the data root (the
 * series' import lock keeps them apart; the server reads the files anew).
 */
export function courseAdmin(dataRoot: string, appVersion = "") {
  const library = openLibrary(join(dataRoot, "library"));
  const transfer = createCourseTransfer({
    files: courseTransferFiles(dataRoot, {
      // A server running on the data root keeps its transfers: they are its to sweep.
      sweeps: () => !serverOn(dataRoot),
    }),
    appVersion,
    now: Date.now,
  });
  return {
    list: () => library.courses(),
    exportTo: transfer.exportTo,
    importFile: transfer.importFile,
  };
}

/** A backup of the data root's irreplaceable data in a new folder in `to` (05, "Backups"). */
export const backupData = (dataRoot: string, to: string) =>
  backUpTo(dataRoot, to, join(appDataDir(), "secret.key"));
