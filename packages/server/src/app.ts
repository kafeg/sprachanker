// Runtime-agnostic Hono app. apps/web imports `AppType` from here (type-only), so this module graph
// must stay free of Bun/Node APIs; those live in src/runtime/.

import type { ApkgRuntime } from "@sprachanker/anki-export";
import { type LibraryView, NotInstalledError } from "@sprachanker/course-kit/view";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import { Hono } from "hono";
import type { ServerDb } from "./db/server/db.ts";
import { errorResponse } from "./errors.ts";
import { blobResponse, JSON_BODY_MAX, limitedBody, type MediaBlob } from "./media.ts";
import { cardRoutes } from "./routes/cards.ts";
import { courseRoutes } from "./routes/courses.ts";
import { deckRoutes } from "./routes/decks.ts";
import type { ProfileEnv } from "./routes/env.ts";
import { examRoutes } from "./routes/exams.ts";
import { lessonRoutes } from "./routes/lessons.ts";
import { llmRoutes } from "./routes/llm.ts";
import { networkRoutes } from "./routes/network.ts";
import { notebookRoutes } from "./routes/notebook.ts";
import { profileRoutes, requireSession, sessionRoutes } from "./routes/profiles.ts";
import { progressRoutes } from "./routes/progress.ts";
import { recordingsRoutes } from "./routes/recordings.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { speechRoutes } from "./routes/speech.ts";
import { hostGuard } from "./security/host.ts";
import type { CourseTransferFiles } from "./services/course-transfer.ts";
import type { DeckTransferFiles } from "./services/deck-transfer.ts";
import type { DeckFiles } from "./services/decks.ts";
import type { CourseInstaller } from "./services/downloads.ts";
import { createServices } from "./services/index.ts";
import type { CliHost, LmStudioHost } from "./services/llm.ts";
import type { ReadingCache, SpeechHost } from "./services/local-engines.ts";
import type { ListensOn, NetworkHost } from "./services/network.ts";
import type { PracticeFiles } from "./services/practice.ts";
import type { TransferFiles } from "./services/profile-transfer.ts";
import type { ProfileFiles } from "./services/profiles.ts";
import type { PiperHost } from "./services/read-aloud.ts";
import { serveWeb, type WebAssets } from "./web.ts";

export type { WebAssets } from "./web.ts";

export interface AppConfig {
  webAssets: WebAssets;
  library: LibraryView;
  /** The server database (profiles, devices) and the profiles' own database files. */
  server: ServerDb;
  profiles: ProfileFiles;
  /** Reads a library media file (runtime adapter). */
  mediaBlob(file: string): MediaBlob;
  /** The imported decks' folders (runtime adapter), and what reading a package needs of the
   *  runtime: SQLite from bytes, zstd. */
  decks: DeckFiles;
  apkg: ApkgRuntime;
  /** Profile files exported and imported (runtime adapter: `profiles/.transfers`). */
  transfers: TransferFiles;
  /** Course bundles exported and imported (runtime adapter: `library/.transfers`). */
  courseTransfers: CourseTransferFiles;
  /** Deck files exported and imported (runtime adapter: `decks/.transfers`). */
  deckTransfers: DeckTransferFiles;
  /** A course's practice written (runtime adapter: `library/<series>/practice/`). */
  practice?: PracticeFiles;
  appVersion: string;
  /** 32-byte key that seals the profiles' API keys. */
  secretKey: Uint8Array;
  /** Outgoing requests to LLM providers (replaced in tests). */
  fetch?: typeof fetch;
  /** LM Studio on this machine: detect it, start its server. */
  lmStudio?: LmStudioHost;
  cli?: CliHost;
  /** The speech engines the sidecar supervisor runs here — whisper-server, Qwen3-TTS — and their
   *  models; without it, no recognition. */
  speech?: SpeechHost;
  /** Reading aloud with Piper voices on this machine; without it, the device's voices only. */
  piper?: PiperHost;
  /** Readings kept on disk (Piper's and Qwen3-TTS's); without it each is made again. */
  readings?: ReadingCache;
  /** Downloads courses (the runtime passes the providers in); without it, nothing can be downloaded. */
  installer?: CourseInstaller;
  now?: () => number;
  /** Chance in [0, 1): what the AI practice draws (a text's genre, ideas, voices); tests fix it. */
  random?: () => number;
  /** Names this machine is reached by besides localhost, IPs and `.local` (its host name, the address
   *  it listens on); its tailnet name is read through `network`. */
  hosts?: string[];
  /** Names given by `--allow-host`: a proxy's of ours, whose `X-Forwarded-Proto` is believed. */
  allowHosts?: string[];
  /** Where the server listens: the addresses the app is reached at are worked out from it. */
  listensOn: ListensOn;
  /** The device's session also in a header, both ways: the phone app, whose page can neither take
   *  nor send a cookie of its server in the page (routes/profiles.ts, SESSION_HEADER). */
  sessionInHeader?: boolean;
  /** This machine's networks and Tailscale; without it, no tailnet and no local network addresses. */
  network?: NetworkHost;
}

/** The routes that take a file, each with its own body limit: a recording, audio to hear, a deck file,
 *  a profile file, a course bundle, a voice for words. */
const FILE_ROUTES =
  /^\/api\/(recordings|speech\/transcribe|speech\/words\/[a-z]+|decks\/preview|profiles\/import|courses\/import)$/;
const jsonBody = limitedBody(JSON_BODY_MAX, "request_too_large");

export function createApp(config: AppConfig) {
  const svc = createServices({
    ...config,
    fetch: config.fetch ?? fetch,
    now: config.now ?? Date.now,
    random: config.random ?? Math.random,
  });

  const api = new Hono<ProfileEnv>()
    // Changes need the app's own header (a cross-site form cannot send it).
    .use("*", async (c, next) => {
      if (
        c.req.method !== "GET" &&
        c.req.method !== "HEAD" &&
        Object.entries(CLIENT_HEADERS).some(([name, value]) => c.req.header(name) !== value)
      ) {
        return c.json({ error: "missing_client_header" }, 403);
      }
      await next();
    })
    .use("*", (c, next) => (FILE_ROUTES.test(c.req.path) ? next() : jsonBody(c, next)))
    .get("/health", (c) => c.json({ status: "ok" as const, version: config.appVersion }))
    // Who is studying, signing in and out: before the session check.
    .route("/", sessionRoutes(svc, { inHeader: config.sessionInHeader }))
    // Everything after it is a profile's: the device's session names it (401 without one).
    .use("*", requireSession(svc, { inHeader: config.sessionInHeader }))
    .route("/", profileRoutes(svc, { inHeader: config.sessionInHeader }))
    .route("/", networkRoutes(svc))
    .route("/", courseRoutes())
    .route("/", lessonRoutes())
    .route("/progress", progressRoutes())
    .route("/exams", examRoutes())
    .route("/settings", settingsRoutes())
    .route("/cards", cardRoutes())
    .route("/decks", deckRoutes())
    .route("/notebook", notebookRoutes())
    .route("/recordings", recordingsRoutes())
    .route("/speech", speechRoutes())
    .route("/llm", llmRoutes())
    // Input is checked by `zod` and by the services (ServiceError); anything else, a ZodError on
    // stored data included, is a server fault.
    .onError((error, c) => {
      if (error instanceof NotInstalledError) return c.json({ error: "not_installed" }, 404);
      const response = errorResponse(error);
      if (response) return c.json(response.body, response.status);
      throw error;
    });

  return (
    new Hono()
      .use(
        "*",
        hostGuard({
          hosts: config.hosts,
          proxies: config.allowHosts,
          known: svc.network.knows,
          tailnetProxied: config.network?.serves !== false,
        }),
      )
      .route("/api", api)
      .all("/api/*", (c) => c.json({ error: "not_found" }, 404))
      .get("/library/:series/*", (c) => {
        const series = c.req.param("series");
        const path = safeDecode(c.req.path.slice(`/library/${series}/`.length));
        // A media file of the series, or a recording of a course's practice.
        const file =
          path &&
          (config.library.mediaFile(series, path) ?? config.library.practiceFile(series, path));
        return file && path
          ? blobResponse(config.mediaBlob(file), c.req.header("range"), path)
          : c.notFound();
      })
      // A deck folder's media: an imported deck's own, and what was read aloud for a deck's words.
      .get("/decks/:id/*", (c) => {
        const id = c.req.param("id");
        const path = safeDecode(c.req.path.slice(`/decks/${id}/`.length));
        const file = path && svc.decks.media(id, path);
        return file && path ? blobResponse(file, c.req.header("range"), path) : c.notFound();
      })
      .get("*", serveWeb(config.webAssets))
  );
}

export type AppType = ReturnType<typeof createApp>;

/** A URL path decoded, or undefined when its escapes are malformed. */
function safeDecode(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return undefined;
  }
}
