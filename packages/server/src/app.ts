// Runtime-agnostic Hono app. apps/web imports `AppType` from here (type-only), so this module graph
// must stay free of Bun/Node APIs; those live in src/runtime/.

import type { LibraryView } from "@sprachanker/course-kit";
import { courseProgress } from "@sprachanker/engine";
import { courseKey, LessonKey, type SeriesKey } from "@sprachanker/schema";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { ProfileDb } from "./db/profile/db.ts";
import { blobResponse, type MediaBlob } from "./media.ts";
import { llmRoutes } from "./routes/llm.ts";
import { secretBox } from "./security/secrets.ts";
import { createContent } from "./services/content.ts";
import { type CourseInstaller, createDownloads } from "./services/downloads.ts";
import { createExplain } from "./services/explain.ts";
import { createLessonContext } from "./services/lesson-context.ts";
import { type CliHost, createLlm, type LmStudioHost } from "./services/llm.ts";
import { createLlmRuns } from "./services/llm-runs.ts";
import { createMistakes } from "./services/mistakes.ts";
import { createPractice } from "./services/practice.ts";
import { createRuns, RunError } from "./services/runs.ts";
import { createScenes } from "./services/scene.ts";
import { createSettings } from "./services/settings.ts";
import { createTutor } from "./services/tutor.ts";
import { createTutorTools } from "./services/tutor-tools.ts";
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
  cli?: CliHost;
  /** Downloads courses (the runtime passes the providers in); without it, nothing can be downloaded. */
  installer?: CourseInstaller;
  now?: () => number;
}

/** Mutating requests must carry this header (CSRF protection, 06). */
export const CLIENT_HEADER = "x-sprachanker";

const CourseRef = z.object({
  series: Series,
  course: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

export function createApp(config: AppConfig) {
  const now = config.now ?? Date.now;
  const content = createContent(config.library);
  const settings = createSettings(config.profile);
  const downloads = createDownloads({
    installer: config.installer,
    now,
    onEnd: (series, course) => content.forget(series, course),
  });
  // Downloads a restart interrupted go on.
  void downloads.resume();
  const llm = createLlm({
    db: config.profile,
    settings,
    box: secretBox(config.secretKey),
    fetch: config.fetch ?? fetch,
    lmStudio: config.lmStudio,
    cli: config.cli,
  });
  const runs = createRuns({
    db: config.profile,
    content,
    now,
    appVersion: config.appVersion,
  });
  const mistakes = createMistakes(config.profile);
  const lessons = createLessonContext(content);
  const llmRuns = createLlmRuns({ db: config.profile, now, appVersion: config.appVersion });
  const tutor = createTutor({
    runs: llmRuns,
    llm,
    mistakes,
    lessons,
    tools: createTutorTools({ content, lessons, mistakes, progress: runs.progress }),
  });
  const practice = createPractice({
    db: config.profile,
    session: runs.shownEvents,
    runs: llmRuns,
    llm,
    lessons,
    mistakes,
    now,
  });
  const scenes = createScenes({ runs: llmRuns, llm, lessons });
  const explain = createExplain({ llm, content });

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
    .get("/health", (c) => c.json({ status: "ok" as const, version: config.appVersion }))
    .get("/courses", async (c) => {
      const progress = await runs.progress();
      return c.json(
        await Promise.all(
          (await content.courses()).map(async ({ lessons, ...course }) => {
            const at = courseProgress(lessons, progress);
            // The lesson to go on with, as its card shows it: title and exercises worked.
            const next = at.next as LessonKey | null;
            const edition = course.editions[0];
            const locale =
              next && edition && (await content.localeLesson(course.series, next, edition));
            const state = next && (await runs.lessonStates(course.series, [next]))[next];
            return {
              ...course,
              lessons: lessons.length,
              ...at,
              nextTitle: locale ? locale.title : null,
              nextRun: state?.run ?? null,
            };
          }),
        ),
      );
    })
    .get(
      "/course",
      zod("query", z.object({ series: Series, course: z.string(), edition: Edition })),
      async (c) => {
        const { series, course, edition } = c.req.valid("query");
        const map = await content.courseMap(series, course, edition);
        const lessons = map.index.units.flatMap((u) => u.lessons) as LessonKey[];
        return c.json({ ...map, lessons: await runs.lessonStates(series, lessons) });
      },
    )
    // A course's integrity and counts.
    .get("/course/check", zod("query", CourseRef), async (c) => {
      const { series, course } = c.req.valid("query");
      return c.json(await config.library.check(series, course));
    })
    // What can be downloaded, and the downloads (first download, completing it, syncing: one job).
    .get("/catalog", async (c) => {
      const installed = new Set((await content.courses()).map((c) => c.key));
      return c.json(await downloads.catalog(installed));
    })
    .get("/downloads", (c) => c.json({ available: downloads.available, jobs: downloads.list() }))
    .post("/downloads", zod("json", CourseRef), (c) => {
      const { series, course } = c.req.valid("json");
      if (!downloads.available) throw new HTTPException(409, { message: "downloads_unavailable" });
      return c.json(downloads.start(series, course));
    })
    .get("/storage", async (c) => c.json(await downloads.storage()))
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
    .get(
      "/runs/lesson",
      zod("query", z.object({ series: Series, lessonKey: LessonKey })),
      async (c) => {
        const { series, lessonKey } = c.req.valid("query");
        return c.json({ state: await runs.lessonState(series, lessonKey) });
      },
    )
    .post(
      "/runs",
      zod(
        "json",
        z.object({
          series: Series,
          lessonKey: LessonKey,
          edition: Edition,
          restart: z.boolean().optional(),
        }),
      ),
      (c) => {
        const { series, lessonKey, edition, restart } = c.req.valid("json");
        return c.json(runs.start(series, lessonKey, edition, restart));
      },
    )
    .post(
      "/runs/:id/events",
      zod("json", z.object({ events: z.array(z.unknown()).max(200) })),
      async (c) =>
        c.json({ outcomes: await runs.append(c.req.param("id"), c.req.valid("json").events) }),
    )
    // Resetting progress: a whole course (it leaves "My courses") or one of its lessons.
    .post(
      "/progress/reset",
      zod("json", CourseRef.extend({ lesson: LessonKey.optional() })),
      (c) => {
        const { series, course, lesson } = c.req.valid("json");
        const key = courseKey(series as SeriesKey, course);
        if (lesson && !lesson.startsWith(`${key}/`))
          throw new HTTPException(400, { message: "lesson is not in this course" });
        return c.json(runs.reset(key, lesson));
      },
    )
    .post("/runs/:id/finish", async (c) => c.json(await runs.finish(c.req.param("id"))))
    .route("/llm", llmRoutes(llm, explain, tutor, practice, scenes))
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
