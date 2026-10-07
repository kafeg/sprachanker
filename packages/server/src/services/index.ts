// The services of a profile, wired once (app.ts mounts their routes): content, runs and their histories,
// cards and study, the Notebook, the AI assistant and course downloads.
import type { LibraryView } from "@sprachanker/course-kit";
import { courseKey, type SeriesKey } from "@sprachanker/schema";
import type { ProfileDb } from "../db/profile/db.ts";
import { secretBox } from "../security/secrets.ts";
import { createCardStore } from "./card-store.ts";
import { createCards } from "./cards.ts";
import { createContent } from "./content.ts";
import { type CourseInstaller, createDownloads } from "./downloads.ts";
import { createExplain } from "./explain.ts";
import { createLessonContext } from "./lesson-context.ts";
import { type CliHost, createLlm, type LmStudioHost } from "./llm.ts";
import { createMistakes } from "./mistakes.ts";
import { createNotebook } from "./notebook.ts";
import { createRunStore } from "./run-store.ts";
import { createRuns } from "./runs.ts";
import { createScenes } from "./scene.ts";
import { createSettings } from "./settings.ts";
import { createStudy } from "./study.ts";
import { createTutor } from "./tutor.ts";
import { createTutorTools } from "./tutor-tools.ts";
import { createWords } from "./words.ts";
import { createWriting } from "./writing.ts";

export function createServices(config: {
  library: LibraryView;
  profile: ProfileDb;
  appVersion: string;
  secretKey: Uint8Array;
  fetch: typeof fetch;
  lmStudio?: LmStudioHost;
  cli?: CliHost;
  installer?: CourseInstaller;
  now: () => number;
}) {
  const { now } = config;
  const content = createContent(config.library);
  const settings = createSettings(config.profile);
  const llm = createLlm({
    db: config.profile,
    settings,
    box: secretBox(config.secretKey),
    fetch: config.fetch,
    lmStudio: config.lmStudio,
    cli: config.cli,
  });
  const store = createRunStore({ db: config.profile, now, appVersion: config.appVersion });
  const cardStore = createCardStore(config.profile);
  const runs = createRuns({ store, cards: cardStore, content });

  const cards = createCards({ cards: cardStore, content, settings, session: runs.shown, now });
  const study = createStudy({ cards: cardStore, store, content, settings, now });
  const words = createWords({ cards: cardStore, store });
  // Cards follow their words' lexemes after a course was normalised again (also on a download's end).
  const relink = () =>
    cards.relink().catch((error: unknown) => console.error("relinking cards:", error));

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
    now,
  });
  const writing = createWriting({ store, session: runs.shown, llm, lessons, now });
  const scenes = createScenes({ store, llm, lessons, now });
  const explain = createExplain({ llm, content, lessonRun: runs.lessonRun, store, now });
  const notebook = createNotebook({ store, content, cards: cardStore, tutor, scenes, now });

  return {
    content,
    settings,
    runs,
    downloads,
    cards,
    study,
    words,
    notebook,
    llm,
    explain,
    tutor,
    writing,
    scenes,
  };
}
