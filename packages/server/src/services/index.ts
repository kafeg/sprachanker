// The services, wired once per server and once per profile (app.ts mounts their routes): the library's
// content and course downloads are shared; each profile has its own runs and histories, cards and study,
// Notebook, settings and AI assistant, over its own database, made when it is first used.
import type { LibraryView } from "@sprachanker/course-kit";
import { SRS_DEFAULTS } from "@sprachanker/engine";
import { courseKey, type SeriesKey } from "@sprachanker/schema";
import type { ProfileDb } from "../db/profile/db.ts";
import type { ServerDb } from "../db/server/db.ts";
import { secretBox } from "../security/secrets.ts";
import { createCardStore } from "./card-store.ts";
import { createCards } from "./cards.ts";
import { type Content, createContent } from "./content.ts";
import { createDevices } from "./devices.ts";
import { type CourseInstaller, createDownloads, type Downloads } from "./downloads.ts";
import { createExamples } from "./examples.ts";
import { createExplain } from "./explain.ts";
import { createLessonContext } from "./lesson-context.ts";
import { type CliHost, createLlm, type LmStudioHost } from "./llm.ts";
import { createMistakes } from "./mistakes.ts";
import { createNotebook } from "./notebook.ts";
import { createProfiles, type ProfileFiles } from "./profiles.ts";
import { createRunStore } from "./run-store.ts";
import { createRuns } from "./runs.ts";
import { createScenes } from "./scene.ts";
import { createSettings } from "./settings.ts";
import { createStudy } from "./study.ts";
import { createTutor } from "./tutor.ts";
import { createTutorTools } from "./tutor-tools.ts";
import { createWords } from "./words.ts";
import { createWriting } from "./writing.ts";

export interface ServicesConfig {
  library: LibraryView;
  /** The server database (profiles, devices) and the profiles' own files. */
  server: ServerDb;
  profiles: ProfileFiles;
  appVersion: string;
  secretKey: Uint8Array;
  fetch: typeof fetch;
  lmStudio?: LmStudioHost;
  cli?: CliHost;
  installer?: CourseInstaller;
  now: () => number;
}

/** A profile's services over its database; the content and downloads are the server's. */
function profileServices(
  config: ServicesConfig,
  shared: { content: Content; downloads: Downloads },
  db: ProfileDb,
) {
  const { now } = config;
  const { content, downloads } = shared;
  const settings = createSettings(db);
  const llm = createLlm({
    db,
    settings,
    box: secretBox(config.secretKey),
    fetch: config.fetch,
    lmStudio: config.lmStudio,
    cli: config.cli,
  });
  const store = createRunStore({ db, now, appVersion: config.appVersion });
  const cardStore = createCardStore(db);
  const runs = createRuns({ store, cards: cardStore, content });
  const cards = createCards({ cards: cardStore, content, settings, session: runs.shown, now });
  const study = createStudy({ cards: cardStore, store, content, settings, now });
  const words = createWords({ cards: cardStore, store });
  const mistakes = createMistakes(store);
  const lessons = createLessonContext(content);
  const tutor = createTutor({
    store,
    session: runs.shown,
    llm,
    mistakes,
    lessons,
    tools: createTutorTools({ content, lessons, mistakes, progress: runs.progress }),
    now,
  });
  const writing = createWriting({ store, session: runs.shown, llm, lessons, now });
  const scenes = createScenes({ store, llm, lessons, now });
  const explain = createExplain({ llm, content, lessonRun: runs.lessonRun, store, now });
  const examples = createExamples({
    cards: cardStore,
    lessons,
    llm,
    store,
    reviewRun: study.reviewRun,
    now,
  });
  const notebook = createNotebook({
    store,
    content,
    cards: cardStore,
    tutor,
    scenes,
    progress: runs.progress,
    dayStartHour: () => settings.get("srs.dayStartHour") ?? SRS_DEFAULTS.dayStartHour,
    now,
  });
  return {
    library: config.library,
    content,
    downloads,
    settings,
    runs,
    cards,
    study,
    words,
    notebook,
    llm,
    explain,
    examples,
    tutor,
    writing,
    scenes,
  };
}
export type ProfileServices = ReturnType<typeof profileServices>;

/**
 * The server's services: the shared content and downloads, the profiles and how devices sign in to
 * them, and each profile's own services (`of`), made on first use and kept.
 */
export function createServices(config: ServicesConfig) {
  const { now } = config;
  const content = createContent(config.library);
  const profiles = createProfiles({ db: config.server, files: config.profiles, now });
  profiles.adoptFirst();
  const open = new Map<string, ProfileServices>();
  // Cards follow their words' lexemes after a course was normalised again (also on a download's end).
  const relink = (s: ProfileServices) =>
    s.cards.relink().catch((error: unknown) => console.error("relinking cards:", error));

  const downloads = createDownloads({
    installer: config.installer,
    now,
    onEnd: (series, course) => {
      content.forget(series, course);
      for (const s of open.values()) {
        s.runs.forget(courseKey(series as SeriesKey, course));
        void relink(s);
      }
    },
  });
  // Downloads a restart interrupted go on.
  downloads.resume().catch((error: unknown) => console.error("resuming downloads:", error));

  return {
    content,
    downloads,
    profiles,
    devices: createDevices({ db: config.server, now }),
    /** A profile's services (its database opened and its cards relinked on first use). */
    of(profileId: string): ProfileServices {
      let s = open.get(profileId);
      if (!s) {
        s = profileServices(config, { content, downloads }, config.profiles.open(profileId));
        open.set(profileId, s);
        void relink(s);
      }
      return s;
    },
    /** Forgets a removed profile's services. */
    close(profileId: string) {
      open.delete(profileId);
    },
  };
}
export type Services = ReturnType<typeof createServices>;
