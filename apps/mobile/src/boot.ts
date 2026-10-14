// The phone app's start, before the web app runs: the server's code (createApp) run in the page over
// the app's own files and databases, and the web app pointed at it — its requests to /api answered
// in the page instead of the network (with the session's cookie kept here: a page may not set one),
// its media and recordings played from the native side's scheme. What the phone does not have yet
// (decks, profile and course files) says so.
import { libraryOver } from "@sprachanker/course-kit/library-over";
import {
  createApp,
  type MediaBlob,
  type ServerDb,
  serverMigrations,
  serverSchema,
} from "@sprachanker/server/portable";
import { drizzle } from "drizzle-orm/sql-js";
import pkg from "../package.json" with { type: "json" };
import { flushAll, openDb } from "./db.ts";
import { openFiles } from "./files.ts";
import { FILES, native, setNetFetch } from "./native.ts";
import { profileFiles } from "./profiles.ts";
import { phoneSpeech } from "./speech.ts";

const netFetch = globalThis.fetch.bind(globalThis);
setNetFetch(netFetch);
// The web app knows it runs in the phone app (what it does not have here, it does not offer).
(globalThis as { sprachankerPhone?: boolean }).sprachankerPhone = true;

/** A file's Blob whose bytes are read only when asked for as a whole (`arrayBuffer`, `bytes`): what
 *  the server reads of a practice recording. A Blob, as what takes one checks; its own data is none,
 *  so what serialises it (a form sent on) sends nothing. */
class FileBlob extends Blob {
  constructor(private readonly read: () => Promise<Uint8Array<ArrayBuffer> | undefined>) {
    super([]);
  }
  override async arrayBuffer() {
    return ((await this.read()) ?? new Uint8Array()).buffer as ArrayBuffer;
  }
  override async bytes() {
    return (await this.read()) ?? new Uint8Array();
  }
}

/** What the phone's server answers when asked for what it does not have; at the start, nothing. */
const EMPTY: Record<string, unknown> = {
  sweep: () => {},
  recover: async () => {},
  unfinished: () => {},
  discard: () => {},
  ids: () => [],
  folders: () => [],
  groups: async () => [],
  read: () => undefined,
  extras: () => undefined,
  media: () => undefined,
  made: () => undefined,
  staged: () => undefined,
  migrations: [],
};
function notOnPhone<T>(what: string): T {
  return new Proxy(
    {},
    {
      get: (_, key) =>
        typeof key !== "string" || key === "then"
          ? undefined
          : key in EMPTY
            ? EMPTY[key]
            : () => {
                throw new Error(`${what}: not in the phone app yet`);
              },
    },
  ) as T;
}

async function start() {
  const files = await openFiles();
  const sqlite = await openDb(files, "server.sqlite", serverMigrations);
  const server = drizzle(sqlite.db, { schema: serverSchema }) as ServerDb;
  const profiles = await profileFiles(files);
  const speech = phoneSpeech(files, await native.asrBuilt());
  let secretKey = await files.read("secret.key");
  if (secretKey?.length !== 32) {
    secretKey = crypto.getRandomValues(new Uint8Array(32));
    await files.write("secret.key", secretKey);
  }
  const app = createApp({
    webAssets: async () => undefined,
    library: libraryOver(files.abs("library"), files.fs, () =>
      Promise.reject(new Error("checking a course: not in the phone app yet")),
    ),
    server,
    profiles,
    // Media are played from the native side's scheme; the server reads one only whole (a practice
    // recording it hands on), read from the files when it does.
    mediaBlob: (file) => new FileBlob(() => files.read(file)) as MediaBlob,
    decks: notOnPhone("decks"),
    apkg: notOnPhone("decks"),
    transfers: notOnPhone("profile files"),
    courseTransfers: notOnPhone("course files"),
    appVersion: pkg.version,
    secretKey,
    fetch: speech.fetchVia(netFetch),
    speech: speech.host,
    listensOn: { hostname: "127.0.0.1", port: 0 },
    sessionInHeader: true,
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushAll();
  });
  return app;
}

/** The header the server takes and gives the device's session in, where the page can neither send
 *  nor take its cookie (routes/profiles.ts, AppConfig.sessionInHeader). */
const SESSION_HEADER = "x-sprachanker-session";
/** The device's session, kept on the device across starts (as a browser keeps the cookie). */
const SESSION = "sprachanker-session";
const session = {
  get: () => localStorage.getItem(SESSION),
  set: (token: string) => localStorage.setItem(SESSION, token),
  clear: () => localStorage.removeItem(SESSION),
};

const ready = start();
ready.catch((error: unknown) => {
  console.error(error);
  document.body.textContent = `SprachAnker could not start: ${error}`;
});

/** The app's own requests answered by its server here; any other goes to the network. */
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  // Scheme and host compared (a custom scheme's origin is "null": iOS's tauri://localhost).
  const own = url.protocol === location.protocol && url.host === location.host;
  if (!own || !/^\/(api|library|decks)\//.test(url.pathname)) return netFetch(request);
  const app = await ready;
  const token = session.get();
  let asked = request;
  if (token) {
    const headers = new Headers(request.headers);
    headers.set(SESSION_HEADER, token);
    asked = new Request(request, { headers });
  }
  const response = await app.fetch(asked);
  const given = response.headers.get(SESSION_HEADER);
  if (given) session.set(given);
  // Signed out (or the profile deleted): the device's session goes.
  else if (
    response.ok &&
    request.method === "DELETE" &&
    /^\/api\/(session|profile)$/.test(url.pathname)
  )
    session.clear();
  return response;
}) as typeof fetch;

/** Where the web app plays a file from: the library's and decks' media and a learner's recordings
 *  from the native side (read by `fileUrl` in apps/web's api/client.ts). */
(globalThis as { sprachankerFileUrl?: (path: string) => string }).sprachankerFileUrl = (path) => {
  const recording = path.match(/^\/api\/recordings\/([0-9A-Za-z]+)$/);
  if (recording) return `${FILES}/recording/${recording[1]}`;
  return /^\/(library|decks)\//.test(path) ? `${FILES}${path}` : path;
};

/** Films kept whole as blob URLs, the latest few (a lesson's), for the WebView to play and seek in
 *  (read by `usePlayable` in apps/web's ui/playable.ts). */
const FILMS_KEPT = 4;
const films = new Map<string, Promise<string>>();
(globalThis as { sprachankerPlayable?: (url: string) => Promise<string> }).sprachankerPlayable = (
  url,
) => {
  if (!url.startsWith(FILES)) return Promise.resolve(url);
  let made = films.get(url);
  if (!made) {
    made = netFetch(url)
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`${url}: ${res.status}`))))
      .then((blob) => URL.createObjectURL(blob))
      .catch(() => url);
    films.set(url, made);
    for (const [old, src] of films) {
      if (films.size <= FILMS_KEPT) break;
      films.delete(old);
      void src.then((s) => s.startsWith("blob:") && URL.revokeObjectURL(s));
    }
  }
  return made;
};
