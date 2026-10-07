// Runtime-agnostic Hono app. apps/web imports `AppType` from here (type-only), so this module graph
// must stay free of Bun/Node APIs; those live in src/runtime/.

import { type LibraryView, NotInstalledError } from "@sprachanker/course-kit";
import {
  CardFace,
  CardRating,
  CourseKey,
  CourseSlug,
  courseKey,
  EditionId,
  LessonKey,
  SeriesKey,
  Ulid,
} from "@sprachanker/schema";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { ProfileDb } from "./db/profile/db.ts";
import { ServiceError } from "./errors.ts";
import { blobResponse, type MediaBlob } from "./media.ts";
import { llmRoutes } from "./routes/llm.ts";
import { hostGuard } from "./security/host.ts";
import { secretBox } from "./security/secrets.ts";
import { createCards } from "./services/cards.ts";
import { createContent } from "./services/content.ts";
import { type CourseInstaller, createDownloads } from "./services/downloads.ts";
import { createExplain } from "./services/explain.ts";
import { createLessonContext } from "./services/lesson-context.ts";
import { type CliHost, createLlm, type LmStudioHost } from "./services/llm.ts";
import { createMistakes } from "./services/mistakes.ts";
import { createPractice } from "./services/practice.ts";
import { createRunStore } from "./services/run-store.ts";
import { createRuns } from "./services/runs.ts";
import { createScenes } from "./services/scene.ts";
import { createSettings } from "./services/settings.ts";
import { createTutor } from "./services/tutor.ts";
import { createTutorTools } from "./services/tutor-tools.ts";
import { zod } from "./validate.ts";
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
  /** Names this machine is reached by besides localhost, IPs and `.local` (its host name). */
  hosts?: string[];
}

/** Mutating requests must carry this header (CSRF protection, 06). */
export const CLIENT_HEADER = "x-sprachanker";

const CourseRef = z.object({ series: SeriesKey, course: CourseSlug });

const CardParam = z.object({ id: Ulid });
/** Every deck, a language, a course, or a lesson's own words (services/cards.ts). */
const DeckScope = z.union([
  z.literal("all"),
  z.string().regex(/^lang:[a-z]{2,3}$/),
  z.templateLiteral(["course:", CourseKey]),
  z.templateLiteral(["lesson:", LessonKey]),
]);

export function createApp(config: AppConfig) {
  const now = config.now ?? Date.now;
  const content = createContent(config.library);
  const settings = createSettings(config.profile);
  const llm = createLlm({
    db: config.profile,
    settings,
    box: secretBox(config.secretKey),
    fetch: config.fetch ?? fetch,
    lmStudio: config.lmStudio,
    cli: config.cli,
  });
  const store = createRunStore({ db: config.profile, now, appVersion: config.appVersion });
  const runs = createRuns({ store, content });
  const downloads = createDownloads({
    installer: config.installer,
    now,
    onEnd: (series, course) => {
      content.forget(series, course);
      runs.forget(courseKey(series as SeriesKey, course));
      void relink();
    },
  });
  // Downloads a restart interrupted go on.
  downloads.resume().catch((error: unknown) => console.error("resuming downloads:", error));
  const cards = createCards({ db: config.profile, store, content, settings, now });
  // Cards follow their words' lexemes after a course was normalised again (also on a download's end).
  const relink = () =>
    cards.relink().catch((error: unknown) => console.error("relinking cards:", error));
  void relink();
  const mistakes = createMistakes(store);
  const lessons = createLessonContext(content);
  const tutor = createTutor({
    store,
    session: runs.shown,
    llm,
    mistakes,
    lessons,
    tools: createTutorTools({ content, lessons, mistakes, progress: runs.progress }),
  });
  const practice = createPractice({
    session: runs.shown,
    store,
    llm,
    lessons,
    now,
  });
  const scenes = createScenes({ store, llm, lessons });
  const explain = createExplain({ llm, content, lessonRun: runs.lessonRun, store, now });

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
    .get("/courses", async (c) => c.json(await runs.courses()))
    .get("/course", zod("query", CourseRef.extend({ edition: EditionId })), async (c) => {
      const { series, course, edition } = c.req.valid("query");
      const map = await content.courseMap(series, course, edition);
      const lessons = map.index.units.flatMap((u) => u.lessons) as LessonKey[];
      return c.json({ ...map, lessons: await runs.lessonStates(lessons) });
    })
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
      return c.json(downloads.start(series, course));
    })
    .get("/storage", async (c) => c.json(await downloads.storage()))
    .get(
      "/lesson",
      zod("query", z.object({ series: SeriesKey, key: LessonKey, edition: EditionId })),
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
      zod("json", z.object({ key: z.string().min(1).max(300), value: z.unknown() })),
      (c) => {
        const { key, value } = c.req.valid("json");
        settings.setByLearner(key, value);
        return c.json(settings.all());
      },
    )
    .get(
      "/runs/lesson",
      zod("query", z.object({ series: SeriesKey, lessonKey: LessonKey })),
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
          series: SeriesKey,
          lessonKey: LessonKey,
          edition: EditionId,
          restart: z.boolean().optional(),
        }),
      ),
      async (c) => {
        const { series, lessonKey, edition, restart } = c.req.valid("json");
        return c.json(await runs.start(series, lessonKey, edition, restart));
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
        const key = courseKey(series, course);
        if (lesson && !lesson.startsWith(`${key}/`))
          throw new HTTPException(400, { message: "lesson is not in this course" });
        return c.json(runs.reset(key, lesson));
      },
    )
    .post("/runs/:id/finish", async (c) => c.json(await runs.finish(c.req.param("id"))))
    // Cards and review as in Anki (04): cards from a lesson's words, decks, study, the reviewer's actions.
    .post(
      "/cards/lesson",
      zod("json", z.object({ series: SeriesKey, lessonKey: LessonKey, edition: EditionId })),
      async (c) => c.json(await cards.fromLesson(c.req.valid("json"))),
    )
    .get("/cards/decks", async (c) => c.json({ decks: await cards.decks() }))
    .get("/cards/study", zod("query", z.object({ scope: DeckScope })), async (c) =>
      c.json(await cards.study(c.req.valid("query").scope)),
    )
    .post(
      "/cards/:id/review",
      zod("param", CardParam),
      zod(
        "json",
        z.object({ id: Ulid, face: CardFace, rating: CardRating, reps: z.number().int().min(0) }),
      ),
      (c) => {
        const { id, face, rating, reps } = c.req.valid("json");
        return c.json({ state: cards.rate(c.req.valid("param").id, face, rating, { id, reps }) });
      },
    )
    .post("/cards/undo", (c) => c.json(cards.undo()))
    .post(
      "/cards/:id/bury",
      zod("param", CardParam),
      zod("json", z.object({ face: CardFace.optional() })),
      (c) => {
        cards.bury(c.req.valid("param").id, c.req.valid("json").face);
        return c.json({ ok: true as const });
      },
    )
    .post("/cards/unbury", zod("json", z.object({ scope: DeckScope })), async (c) => {
      await cards.unbury(c.req.valid("json").scope);
      return c.json({ ok: true as const });
    })
    .put(
      "/cards/:id/suspend",
      zod("param", CardParam),
      zod("json", z.object({ suspended: z.boolean(), face: CardFace.optional() })),
      (c) => {
        const { suspended, face } = c.req.valid("json");
        cards.suspend(c.req.valid("param").id, suspended, face);
        return c.json({ ok: true as const });
      },
    )
    .put(
      "/cards/:id/flag",
      zod("param", CardParam),
      zod("json", z.object({ face: CardFace, flag: z.number().int().min(0).max(7) })),
      (c) => {
        const { face, flag } = c.req.valid("json");
        cards.flag(c.req.valid("param").id, face, flag);
        return c.json({ ok: true as const });
      },
    )
    .put(
      "/cards/:id/mark",
      zod("param", CardParam),
      zod("json", z.object({ marked: z.boolean() })),
      (c) => {
        cards.mark(c.req.valid("param").id, c.req.valid("json").marked);
        return c.json({ ok: true as const });
      },
    )
    .get("/cards", (c) => c.json({ words: cards.words() }))
    .route("/llm", llmRoutes(llm, explain, tutor, practice, scenes))
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
