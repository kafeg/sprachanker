// Runtime-agnostic Hono app. apps/web imports `AppType` from here (type-only), so this module graph
// must stay free of Bun/Node APIs; those live in src/runtime/.

import { type LibraryView, NotInstalledError } from "@sprachanker/course-kit";
import { CLIENT_HEADERS } from "@sprachanker/schema";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ServerDb } from "./db/server/db.ts";
import { ServiceError } from "./errors.ts";
import { blobResponse, type MediaBlob } from "./media.ts";
import { cardRoutes } from "./routes/cards.ts";
import { courseRoutes } from "./routes/courses.ts";
import type { ProfileEnv } from "./routes/env.ts";
import { llmRoutes } from "./routes/llm.ts";
import { notebookRoutes } from "./routes/notebook.ts";
import { profileRoutes, requireSession, sessionRoutes } from "./routes/profiles.ts";
import { recordingsRoutes } from "./routes/recordings.ts";
import { runRoutes } from "./routes/runs.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { speechRoutes } from "./routes/speech.ts";
import { hostGuard } from "./security/host.ts";
import type { CourseInstaller } from "./services/downloads.ts";
import { createServices } from "./services/index.ts";
import type { CliHost, LmStudioHost } from "./services/llm.ts";
import type { ProfileFiles } from "./services/profiles.ts";
import type { SpeechHost } from "./services/speech.ts";
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
  appVersion: string;
  /** 32-byte key that seals the profiles' API keys (06, "Secrets"). */
  secretKey: Uint8Array;
  /** Outgoing requests to LLM providers (replaced in tests). */
  fetch?: typeof fetch;
  /** LM Studio on this machine: detect it, start its server. */
  lmStudio?: LmStudioHost;
  cli?: CliHost;
  /** The speech engine on this machine (08); without it, no recognition. */
  speech?: SpeechHost;
  /** Downloads courses (the runtime passes the providers in); without it, nothing can be downloaded. */
  installer?: CourseInstaller;
  now?: () => number;
  /** Names this machine is reached by besides localhost, IPs and `.local` (its host name). */
  hosts?: string[];
}

export function createApp(config: AppConfig) {
  const svc = createServices({
    ...config,
    fetch: config.fetch ?? fetch,
    now: config.now ?? Date.now,
  });

  const api = new Hono<ProfileEnv>()
    // Changes need the app's own header (a cross-site form cannot send it; 06, "Security").
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
    .get("/health", (c) => c.json({ status: "ok" as const, version: config.appVersion }))
    // Who is studying, signing in and out: before the session check.
    .route("/", sessionRoutes(svc))
    // Everything after it is a profile's: the device's session names it (401 without one).
    .use("*", requireSession(svc))
    .route("/", profileRoutes(svc))
    .route("/", courseRoutes())
    .route("/", runRoutes())
    .route("/settings", settingsRoutes())
    .route("/cards", cardRoutes())
    .route("/notebook", notebookRoutes())
    .route("/recordings", recordingsRoutes())
    .route("/speech", speechRoutes())
    .route("/llm", llmRoutes())
    // Input is checked by `zod()` and by the services (ServiceError); anything else, a ZodError on
    // stored data included, is a server fault.
    .onError((error, c) => {
      if (error instanceof ServiceError) return c.json({ error: error.message }, error.status);
      if (error instanceof NotInstalledError) return c.json({ error: "not_installed" }, 404);
      if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
      throw error;
    });

  return new Hono()
    .use("*", hostGuard(config.hosts))
    .route("/api", api)
    .all("/api/*", (c) => c.json({ error: "not_found" }, 404))
    .get("/library/:series/*", (c) => {
      const series = c.req.param("series");
      const path = safeDecode(c.req.path.slice(`/library/${series}/`.length));
      const file = path && config.library.mediaFile(series, path);
      return file ? blobResponse(config.mediaBlob(file), c.req.header("range")) : c.notFound();
    })
    .get("*", serveWeb(config.webAssets));
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
