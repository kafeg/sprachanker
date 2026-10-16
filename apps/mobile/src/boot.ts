// The phone app's start, before the web app runs: the server's code (createApp) run in the page over
// the app's own files and databases, and the web app pointed at it — its requests to /api answered
// in the page instead of the network (with the session's cookie kept here: a page may not set one),
// its media and recordings played from the native side's scheme. On Android the server's storage —
// decks, files in and out, course downloads, models — runs over the phone's files (the native bridge);
// a phone without the bridge (iOS so far) says what it lacks. On Android the app is open to other
// devices as the computer's server is (host.ts): the native side's listener, answered here.
import { type DataFs, openLibrary, readAll } from "@sprachanker/course-kit";
import { libraryOver } from "@sprachanker/course-kit/library-over";
import {
  courseInstaller,
  courseTransferFiles,
  createApp,
  type DataRoot,
  deckFiles,
  deckTransferFiles,
  type MediaBlob,
  modelStore,
  practiceFiles,
  profileTransferFiles,
  readingCache,
  SESSION_HEADER,
  type ServerDb,
  serverMigrations,
  serverSchema,
  voiceStore,
} from "@sprachanker/server/portable";
import { drizzle } from "drizzle-orm/sql-js";
import { bridge, check, latin1, needBridge } from "./bridge.ts";
import { flushAll, openDb } from "./db.ts";
import { filesOver, openFiles } from "./files.ts";
import { answerOthers, type HostMessage, NativeFile } from "./host.ts";
import { FILES, native, setNetFetch, startHost } from "./native.ts";
import { nativeFetch } from "./net.ts";
import { phoneNetwork } from "./network.ts";
import { phoneFs } from "./phone-fs.ts";
import { phonePiper } from "./piper.ts";
import { profileFiles } from "./profiles.ts";
import { phoneSpeech } from "./speech.ts";
import { phoneApkg, phoneProfileSql } from "./sql.ts";
import { installVoices } from "./voices.ts";

/** The app's version, set when the page is built (scripts/build.ts). */
declare const SPRACHANKER_VERSION: string;
/** The web app's own files (its build's paths), what other devices load. */
declare const SPRACHANKER_WEB_FILES: string[];
/** The notification's words while the app is open to other devices, by language (the catalogs'
 *  `desktop` section). */
declare const SPRACHANKER_HOST_WORDS: Record<string, { hosting: string; quit: string }>;

const netFetch = globalThis.fetch.bind(globalThis);
setNetFetch(netFetch);
// The web app knows it runs in the phone app (what it does not have here, it does not offer), and
// whether the app is open to other devices here (Android).
(globalThis as { sprachankerPhone?: boolean }).sprachankerPhone = true;
(globalThis as { sprachankerOpenToOthers?: boolean }).sprachankerOpenToOthers = !!bridge;
// The device's voices as the page's speechSynthesis (Android's WebView has none).
installVoices();

/** What the phone's server answers when asked for what it does not have; at the start, nothing. */
const EMPTY: Record<string, unknown> = {
  sweep: () => {},
  recover: async () => {},
  unfinished: () => {},
  discard: () => {},
  ids: () => [],
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
                throw new Error(`${what}: not on this phone yet`);
              },
    },
  ) as T;
}

/** `work` kept going while the app is put away (Android: a foreground service, Native.kt `work`). */
async function working<T>(text: string, work: () => Promise<T>): Promise<T> {
  bridge?.work(true, text);
  try {
    return await work();
  } finally {
    bridge?.work(false, text);
  }
}

/** The app's own folders over the shared code's files (Android): the same storage the desktop has —
 *  decks, deck, course and profile files, course downloads from their publishers, Whisper's models
 *  downloaded in the app. Requests to other hosts go through the native side (no CORS there). */
function storageOver(
  fs: DataFs,
  root: string,
  profiles: { live(id: string): Uint8Array | undefined },
  engines: string[],
) {
  const data: DataRoot = { fs, path: root, pid: 0, runs: () => false, fetch: nativeFetch };
  const installer = courseInstaller(data);
  const models = modelStore(fs, `${root}/models`, nativeFetch);
  const piper = phonePiper(fs, root, nativeFetch, { built: engines.includes("piper") });
  return {
    library: openLibrary(fs, `${root}/library`),
    decks: deckFiles(
      data,
      (file) => new NativeFile({ file }, () => readAll(fs, file)) as MediaBlob,
    ),
    apkg: phoneApkg,
    transfers: profileTransferFiles(data, phoneProfileSql(fs, profiles.live)),
    courseTransfers: courseTransferFiles(data),
    deckTransfers: deckTransferFiles(data),
    practice: practiceFiles(data),
    installer: {
      ...installer,
      run: (series, course, hooks) =>
        working(`SprachAnker ↓ ${course}`, () => installer.run(series, course, hooks)),
    } satisfies typeof installer,
    models: {
      ...models,
      download: (url, model, onProgress, signal) =>
        working(`SprachAnker ↓ ${model.file}`, () =>
          models.download(url, model, onProgress, signal),
        ),
    } satisfies typeof models,
    wordVoices: voiceStore(fs, `${root}/models/word-voices`),
    readings: readingCache(fs, root),
    piper: {
      ...piper,
      download: (url, voice, onProgress, signal) =>
        working(`SprachAnker ↓ ${voice.id}`, () => piper.download(url, voice, onProgress, signal)),
    } satisfies typeof piper,
  };
}

/** The web app's own files as the server serves them to another device: sent by the native side
 *  (its page is the web app's own index, without this start). */
const webFiles = new Set(SPRACHANKER_WEB_FILES);
const webAssets = async (path: string) =>
  webFiles.has(path)
    ? (new NativeFile({ asset: path === "/index.html" ? "/web.html" : path }) as Blob)
    : undefined;

/** Requests of other devices that come before the server is made wait for it. */
const early: HostMessage[] = [];
let answer: (message: HostMessage) => void = (message) => {
  early.push(message);
};
/** The listener (Android), its port; none where it did not start. */
const hosting = bridge
  ? startHost((message) => answer(message)).then(
      ({ port, host }) => {
        answer = answerOthers(host, () => ready);
        for (const message of early.splice(0)) answer(message);
        const words = SPRACHANKER_HOST_WORDS[navigator.language.split("-")[0] ?? ""];
        const en = SPRACHANKER_HOST_WORDS.en ?? { hosting: "", quit: "" };
        bridge?.host(true, words?.hosting ?? en.hosting, words?.quit ?? en.quit);
        return port;
      },
      (error: unknown) => {
        console.error("not open to other devices:", error);
        return undefined;
      },
    )
  : Promise.resolve(undefined);

async function start() {
  const root = bridge?.root();
  const fs = root ? phoneFs(root, netFetch) : undefined;
  const files = fs && root ? filesOver(fs, root) : await openFiles();
  const sqlite = await openDb(files, "server.sqlite", serverMigrations);
  const server = drizzle(sqlite.db, { schema: serverSchema }) as ServerDb;
  const profiles = await profileFiles(files);
  const engines = await native.enginesBuilt();
  // Engines a page before this one started (a reload) have no owner now.
  if (engines.length) await native.enginesStopAll();
  const storage = fs && root ? storageOver(fs, root, profiles, engines) : undefined;
  const speech = phoneSpeech(storage?.models ?? notOnPhone("speech models"), {
    whisper: await native.asrBuilt(),
    engines: storage ? engines : [],
    android: !!storage,
    wordVoices: storage?.wordVoices,
  });
  let secretKey = await files.read("secret.key");
  if (secretKey?.length !== 32) {
    secretKey = crypto.getRandomValues(new Uint8Array(32));
    await files.write("secret.key", secretKey);
  }
  const port = await hosting;
  const app = createApp({
    webAssets,
    library:
      storage?.library ??
      libraryOver(files.abs("library"), files.fs, () =>
        Promise.reject(new Error("checking a course: not on this phone yet")),
      ),
    server,
    profiles,
    // Media are played from the native side's scheme; the server reads one only whole (a practice
    // recording it hands on), read from the files when it does; another device's sent natively.
    mediaBlob: (file) => new NativeFile({ file }, () => files.read(file)) as MediaBlob,
    decks: storage?.decks ?? notOnPhone("decks"),
    apkg: storage?.apkg ?? notOnPhone("decks"),
    transfers: storage?.transfers ?? notOnPhone("profile files"),
    courseTransfers: storage?.courseTransfers ?? notOnPhone("course files"),
    deckTransfers: storage?.deckTransfers ?? notOnPhone("deck files"),
    practice: storage?.practice,
    installer: storage?.installer,
    appVersion: SPRACHANKER_VERSION,
    secretKey,
    // An LLM provider's requests through the native side too (any address the learner sets).
    fetch: speech.fetchVia(storage ? nativeFetch : netFetch),
    speech: speech.host,
    // On every address where the listener started, as the desktop app's server.
    listensOn: port ? { hostname: "0.0.0.0", port } : { hostname: "127.0.0.1", port: 0 },
    network: port && bridge ? phoneNetwork(bridge) : undefined,
    piper: storage?.piper,
    readings: storage?.readings,
    sessionInHeader: true,
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushAll();
    stopEnginesAway(speech.idle);
  });
  return app;
}

/** How long the app is put away before its engines stop. */
const ENGINES_AWAY_MS = 60_000;
let away: ReturnType<typeof setTimeout> | undefined;
/** The engines stopped once the app has been put away a while and none is asked anything: their
 *  gigabytes would keep the app's own standing with the memory killer (an app may not lower it), so
 *  the system would end the app first. The next reading starts them again. */
function stopEnginesAway(idle: () => boolean) {
  clearTimeout(away);
  if (document.visibilityState !== "hidden") return;
  away = setTimeout(() => {
    if (document.visibilityState !== "hidden") return;
    if (idle()) void native.enginesStopAll();
    else stopEnginesAway(idle);
  }, ENGINES_AWAY_MS);
}

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

/** A request to the app's server answered here, the device's session in its header; `length`: the
 *  file's it sends (a page may not set Content-Length itself: the server reads it as announced). */
async function serve(request: Request, length?: number) {
  const url = new URL(request.url);
  const app = await ready;
  const token = session.get();
  let asked = request;
  if (token) {
    const headers = new Headers(request.headers);
    headers.set(SESSION_HEADER, token);
    asked = new Request(request, { headers, duplex: "half" } as RequestInit);
  }
  if (length !== undefined) {
    // A page's Request drops Content-Length; Headers made here keep it, put in place of its own (a
    // file's route reads them as they are, nothing makes the request anew).
    const headers = new Headers(asked.headers);
    headers.set("content-length", String(length));
    Object.defineProperty(asked, "headers", { value: headers });
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
}

/** The app's own requests answered by its server here; any other goes to the network. */
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  // Scheme and host compared (a custom scheme's origin is "null": iOS's tauri://localhost).
  const own = url.protocol === location.protocol && url.host === location.host;
  if (!own || !/^\/(api|library|decks)\//.test(url.pathname)) return netFetch(request);
  return serve(request);
}) as typeof fetch;

/** Files in and out as the web app moves them (read by apps/web's api/files.ts): a file chosen sent to
 *  the server here as it is read (never whole in memory), with its progress; a file the server makes
 *  (an export) saved into the phone's Downloads as it comes. */
(globalThis as { sprachankerTransfer?: unknown }).sprachankerTransfer = {
  async upload(
    url: string,
    file: File,
    headers: Record<string, string>,
    onProgress: (sent: number) => void,
  ) {
    return working(`SprachAnker ↑ ${file.name}`, () => send(url, file, headers, onProgress));
  },
  save: (url: string, fileName: string) =>
    working(`SprachAnker ↓ ${fileName}`, () => saveFile(url, fileName)),
};

async function send(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (sent: number) => void,
) {
  let sent = 0;
  const counted = file.stream().pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        sent += chunk.byteLength;
        onProgress(file.size ? sent / file.size : 1);
        controller.enqueue(chunk);
      },
    }),
  );
  const request = new Request(new URL(url, location.href), {
    method: "POST",
    headers,
    body: counted,
    duplex: "half",
  } as RequestInit);
  const response = await serve(request, file.size);
  return { status: response.status, text: await response.text() };
}

async function saveFile(url: string, fileName: string) {
  const response = await serve(new Request(new URL(url, location.href)));
  if (!response.ok || !response.body) throw new Error(`${url}: ${response.status}`);
  const b = needBridge();
  // Its own type would make Android name it anew (a zip gets .zip): a file of bytes keeps its name.
  const opened = b.openDownload(fileName, "application/octet-stream");
  if (opened.startsWith("!")) throw new Error(opened.slice(1));
  const handle = Number(opened);
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>)
      for (let at = 0; at < chunk.byteLength; at += 1 << 20)
        check(b.append(handle, latin1(chunk.subarray(at, at + (1 << 20)))));
  } catch (error) {
    b.abortWrite(handle);
    throw error;
  }
  const closed = b.closeWrite(handle, false);
  if (closed.startsWith("!")) throw new Error(closed.slice(1));
}

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
