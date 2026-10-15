import { hostname } from "node:os";
import { join } from "node:path";
import { openLibrary, verifyLibrary } from "@sprachanker/course-kit";
import { Deck } from "@sprachanker/schema";
import { createApp, type WebAssets } from "./app.ts";
import { appDataDir } from "./config.ts";
import { courseInstaller, removeInstalledCourse } from "./providers.ts";
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
import { holdDataRoot, portAnswers, serverOn } from "./runtime/data-root.ts";
import { apkgRuntime, deckFiles } from "./runtime/decks.ts";
import { lmStudioHost } from "./runtime/lmstudio.ts";
import { networkHost } from "./runtime/network.ts";
import { piperHost } from "./runtime/piper.ts";
import { practiceFiles } from "./runtime/practice.ts";
import { profileTransferFiles } from "./runtime/profile-transfer.ts";
import { readingCache } from "./runtime/readings.ts";
import { speechHost } from "./runtime/speech.ts";
import { createCardStore } from "./services/card-store.ts";
import { createContent } from "./services/content.ts";
import { createCourseTransfer } from "./services/course-transfer.ts";
import { createServices } from "./services/index.ts";
import type { PracticeStepName } from "./services/practice.ts";
import type { PracticeJob } from "./services/practice-jobs.ts";
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
  /** Data root: library/, decks/ and profiles/. */
  dataRoot: string;
  appVersion: string;
  /** More names the Host check accepts (`--allow-host`): a name this machine is reached by that it
   *  cannot know itself, as a reverse proxy's. */
  allowHosts?: string[];
  /** The Worker that makes an imported profile's database ready, as the compiled binary embeds it;
   *  from sources the server finds its own (PROFILE_DB_WORKER). */
  profileDbWorker?: string;
}

/** The runtime adapters over a data root: what the app and the command line's services run on. */
function runtimeOf(dataRoot: string, appVersion: string, profileDbWorker?: string) {
  return {
    library: openLibrary(join(dataRoot, "library")),
    server: openServerDb(join(dataRoot, "server.sqlite")),
    profiles: profileFiles(dataRoot),
    mediaBlob,
    decks: deckFiles(dataRoot),
    apkg: apkgRuntime,
    transfers: profileTransferFiles(dataRoot, { worker: profileDbWorker }),
    courseTransfers: courseTransferFiles(dataRoot),
    practice: practiceFiles(dataRoot),
    appVersion,
    // Outside the data root, so a copied data folder does not carry usable API keys.
    secretKey: secretKey(join(appDataDir(), "secret.key")),
    lmStudio: lmStudioHost(),
    cli: cliHost(),
    installer: courseInstaller(dataRoot),
    speech: speechHost(dataRoot),
    piper: piperHost(dataRoot),
    readings: readingCache(dataRoot),
  };
}

/** Starts the HTTP server: JSON API under /api, library and deck media and the built web app. A port
 *  something answers on already is refused, whatever address that listens on. */
export async function startServer(config: ServerConfig): Promise<Listening> {
  if (await portAnswers(config.port))
    throw new Error(`port ${config.port} is taken by another program: choose another (--port)`);
  holdDataRoot(config.dataRoot);
  const app = createApp({
    webAssets: config.webAssets,
    ...runtimeOf(config.dataRoot, config.appVersion, config.profileDbWorker),
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

/**
 * A course's practice made from the command line (`sprachanker practice`), by a profile's model and
 * voices, as the course page's button makes it: the services over the data root without the HTTP
 * server — also while one runs (the series' lock keeps their writes apart).
 */
export function practiceAdmin(dataRoot: string, appVersion = "") {
  const runtime = runtimeOf(dataRoot, appVersion);
  const svc = createServices({
    ...runtime,
    fetch,
    now: Date.now,
    random: Math.random,
    listensOn: { hostname: "127.0.0.1", port: 0 },
  });
  return {
    profiles: () => svc.profiles.list(),
    courses: () => runtime.library.courses(),
    state: (profileId: string, series: string, course: string, edition: string) =>
      svc.of(profileId).practiceCourse.state(series, course, edition),
    /** Makes a course's practice, `progress` told every few seconds: the job at its end. */
    async make(
      profileId: string,
      what: { series: string; course: string; edition: string },
      options: { steps: PracticeStepName[]; count: number },
      progress: (job: PracticeJob) => void,
    ) {
      const s = svc.of(profileId).practiceCourse;
      const { job, ended } = await s.start(what.series, what.course, what.edition, options);
      const timer = setInterval(() => progress(job), PROGRESS_MS);
      try {
        await ended;
      } finally {
        clearInterval(timer);
      }
      return job;
    },
    stop: (profileId: string, series: string, course: string, edition: string) =>
      svc.of(profileId).practiceCourse.stop(series, course, edition),
  };
}
const PROGRESS_MS = 5000;

/** Checks every installed course of the data root (course-kit verify). */
export const verifyData = (dataRoot: string) =>
  verifyLibrary(openLibrary(join(dataRoot, "library")));

/**
 * The server's profile matters for the `sprachanker profiles` command:
 * list them, open or close registration, delete one, export one to a file or import one from a file
 *. Not in the app.
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
 * The data root's courses for the `sprachanker courses` command: those
 * installed, one exported to a file — or every one, a file a group sharing media —, a file
 * imported, one removed — also while a server runs on the
 * data root (the series' import lock keeps them apart; the server reads the files anew).
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
    exportAll: transfer.exportAll,
    importFile: transfer.importFile,
    /** A course removed; `server`: the pid of a server running on the data root (it keeps what it
     *  read of the course until restarted). */
    remove: async (series: string, course: string) => ({
      ...(await removeInstalledCourse(dataRoot, series, course)),
      server: serverOn(dataRoot),
    }),
  };
}

/** A backup of the data root's irreplaceable data in a new folder in `to`. */
export const backupData = (dataRoot: string, to: string) =>
  backUpTo(dataRoot, to, join(appDataDir(), "secret.key"));
