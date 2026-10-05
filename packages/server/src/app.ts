// Runtime-agnostic Hono app. apps/web imports `AppType` from here (type-only), so this module graph
// must stay free of Bun/Node APIs; those live in src/runtime/.
import type { LibraryView } from "@sprachanker/course-kit";
import { LessonKey } from "@sprachanker/schema";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { ProfileDb } from "./db/profile/db.ts";
import { blobResponse, type MediaBlob } from "./media.ts";
import { llmRoutes } from "./routes/llm.ts";
import { secretBox } from "./security/secrets.ts";
import { createContent } from "./services/content.ts";
import { createLessonContext } from "./services/lesson-context.ts";
import { createLlm, type LmStudioHost } from "./services/llm.ts";
import { createMistakes } from "./services/mistakes.ts";
import { createPractice } from "./services/practice.ts";
import { createRuns, RunError } from "./services/runs.ts";
import { createScenes } from "./services/scene.ts";
import { createSettings } from "./services/settings.ts";
import { createTutor } from "./services/tutor.ts";
import { Edition, Series, zod } from "./validate.ts";
import { serveWeb, type WebAssets } from "./web.ts";

export type { WebAssets } from "./web.ts";

export interface AppConfig {
  webAssets: WebAssets;
  library: LibraryView;
  profile: ProfileDb;
  /** Reads a library media file (runtime adapter). */
  mediaBlob(file: string): MediaBlob;
  appVersion: string;
  /** 32-byte key that seals the profile's API keys (06, "Secrets"). */
  secretKey: Uint8Array;
  /** Outgoing requests to LLM providers (replaced in tests). */
  fetch?: typeof fetch;
  /** LM Studio on this machine: detect it, start its server. */
  lmStudio?: LmStudioHost;
  now?: () => number;
}

/** Mutating requests must carry this header (CSRF protection, 06). */
export const CLIENT_HEADER = "x-sprachanker";

export function createApp(config: AppConfig) {
  const now = config.now ?? Date.now;
  const content = createContent(config.library);
  const settings = createSettings(config.profile);
  const llm = createLlm({
    db: config.profile,
    settings,
    box: secretBox(config.secretKey),
    content,
    fetch: config.fetch ?? fetch,
    lmStudio: config.lmStudio,
  });
  const mistakes = createMistakes(config.profile);
  const lessons = createLessonContext(content);
  const tutor = createTutor({
    db: config.profile,
    content,
    llm,
    mistakes,
    lessons,
    now,
    appVersion: config.appVersion,
  });
  const practice = createPractice({
    db: config.profile,
    llm,
    lessons,
    mistakes,
    now,
    appVersion: config.appVersion,
  });
  const scenes = createScenes({
    db: config.profile,
    llm,
    lessons,
    now,
    appVersion: config.appVersion,
  });
  const runs = createRuns({
    db: config.profile,
    content,
    now,
    appVersion: config.appVersion,
    targetLang: () => "de",
  });

  const api = new Hono()
    .use("*", async (c, next) => {
      if (
        c.req.method !== "GET" &&
        c.req.method !== "HEAD" &&
        c.req.header(CLIENT_HEADER) !== "1"
      ) {
        return c.json({ error: "missing_client_header" }, 403);
      }
      await next();
    })
    .get("/health", (c) => c.json({ status: "ok" as const }))
    .get("/courses", async (c) => {
      const progress = runs.progress();
      return c.json(
        (await content.courses()).map(({ lessons, ...course }) => {
          const done = lessons.filter((k) => progress[k]?.status === "done").length;
          // Continue the most recent active lesson, else the first lesson not done yet.
          const active = lessons.find((k) => progress[k]?.status === "in_progress");
          const next = active ?? lessons.find((k) => progress[k]?.status !== "done") ?? lessons[0];
          return {
            ...course,
            lessons: lessons.length,
            done,
            next: next ?? null,
            nextStarted: !!active,
          };
        }),
      );
    })
    .get(
      "/course",
      zod("query", z.object({ series: Series, course: z.string(), edition: Edition })),
      async (c) => {
        const { series, course, edition } = c.req.valid("query");
        return c.json({
          ...(await content.courseMap(series, course, edition)),
          progress: runs.progress(),
        });
      },
    )
    .get(
      "/lesson",
      zod("query", z.object({ series: Series, key: LessonKey, edition: Edition })),
      async (c) => {
        const { series, key, edition } = c.req.valid("query");
        const [lesson, locale] = await Promise.all([
          content.lesson(series, key),
          content.localeLesson(series, key, edition),
        ]);
        return c.json({ lesson, locale: locale ?? null });
      },
    )
    .get("/settings", (c) => c.json(settings.all()))
    .put(
      "/settings",
      zod("json", z.object({ key: z.string().min(1).max(100), value: z.unknown() })),
      (c) => {
        const { key, value } = c.req.valid("json");
        settings.set(key, value);
        return c.json(settings.all());
      },
    )
    .post(
      "/runs",
      zod("json", z.object({ series: Series, lessonKey: LessonKey, edition: Edition })),
      (c) => {
        const { series, lessonKey, edition } = c.req.valid("json");
        return c.json(runs.start(series, lessonKey, edition));
      },
    )
    .post(
      "/runs/:id/events",
      zod("json", z.object({ events: z.array(z.unknown()).max(200) })),
      async (c) =>
        c.json({ outcomes: await runs.append(c.req.param("id"), c.req.valid("json").events) }),
    )
    .post("/runs/:id/finish", (c) => c.json(runs.finish(c.req.param("id"))))
    .route("/llm", llmRoutes(llm, tutor, practice, scenes))
    .onError((error, c) => {
      if (error instanceof RunError) return c.json({ error: error.message }, error.status);
      if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
      if (error instanceof z.ZodError)
        return c.json({ error: "bad_request", issues: error.issues }, 400);
      throw error;
    });

  return new Hono()
    .route("/api", api)
    .all("/api/*", (c) => c.json({ error: "not_found" }, 404))
    .get("/library/:series/*", (c) => {
      const series = c.req.param("series");
      const path = decodeURIComponent(c.req.path.slice(`/library/${series}/`.length));
      const file = config.library.mediaFile(series, path);
      return file ? blobResponse(config.mediaBlob(file), c.req.header("range")) : c.notFound();
    })
    .get("*", serveWeb(config.webAssets));
}

export type AppType = ReturnType<typeof createApp>;
