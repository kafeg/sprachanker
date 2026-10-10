// The services, wired once per server and once per profile (app.ts mounts their routes): the library's
// content and course downloads are shared; each profile has its own runs and histories, cards and study,
// Notebook, settings and AI assistant, over its own database, made when it is first used.
import type { LibraryView } from "@sprachanker/course-kit/view";
import type { ProfileDb } from "../db/profile/db.ts";
import type { ServerDb } from "../db/server/db.ts";
import { secretBox } from "../security/secrets.ts";
import { createCardStore } from "./card-store.ts";
import { createCards } from "./cards.ts";
import { type Content, createContent } from "./content.ts";
import { createDevices } from "./devices.ts";
import { type CourseInstaller, createDownloads, type Downloads } from "./downloads.ts";
import { createExamConversation } from "./exam-conversation.ts";
import { createExamRating } from "./exam-rating.ts";
import { createExamples } from "./examples.ts";
import { createExams } from "./exams.ts";
import { createExplain } from "./explain.ts";
import { createLessonContext } from "./lesson-context.ts";
import { type CliHost, createLlm, type LmStudioHost } from "./llm.ts";
import type { ReadingCache, SpeechHost } from "./local-engines.ts";
import { createMistakes } from "./mistakes.ts";
import { createNotebook } from "./notebook.ts";
import { createProfileSpeech } from "./profile-speech.ts";
import { createProfiles, type ProfileFiles, type RecordingFiles } from "./profiles.ts";
import { createProgress } from "./progress.ts";
import { createQwenTts, type QwenTts } from "./qwen-tts.ts";
import { createReadAloud, type PiperHost, type ReadAloud } from "./read-aloud.ts";
import { createRecordings } from "./recordings.ts";
import { createRunStore } from "./run-store.ts";
import { createRuns } from "./runs.ts";
import { createScenes } from "./scene.ts";
import { createSettings } from "./settings.ts";
import { createSpeaking } from "./speaking.ts";
import { createSpeech, type Speech } from "./speech.ts";
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
  speech?: SpeechHost;
  piper?: PiperHost;
  /** Readings kept (Piper's and Qwen3-TTS's); without it each is made again. */
  readings?: ReadingCache;
  /** Reads a library media file (runtime adapter): course recordings the recogniser hears. */
  mediaBlob(file: string): Blob;
  now: () => number;
}

/** A take no answer holds goes once it is this old (one younger may be an answer still on its way). */
const DAY_MS = 24 * 60 * 60_000;

/** A profile's services over its database; the content and downloads are the server's. */
function profileServices(
  config: ServicesConfig,
  shared: {
    content: Content;
    downloads: Downloads;
    speech: Speech;
    readAloud: ReadAloud;
    qwenTts: QwenTts;
  },
  db: ProfileDb,
  recordingFiles: RecordingFiles,
) {
  const { now } = config;
  const { content, downloads, speech, readAloud, qwenTts } = shared;
  const settings = createSettings(db);
  const speechOfProfile = createProfileSpeech({ speech, readAloud, qwenTts, settings });
  const llm = createLlm({
    db,
    settings,
    box: secretBox(config.secretKey),
    fetch: config.fetch,
    lmStudio: config.lmStudio,
    cli: config.cli,
    now,
  });
  const store = createRunStore({ db, now, appVersion: config.appVersion });
  const cardStore = createCardStore(db);
  const recordings = createRecordings(recordingFiles, now);
  const progress = createProgress({ store, cards: cardStore, recordings });
  // Takes no answer of any run holds (recorded again, never answered with, not to be kept), a day old;
  // housekeeping never keeps the profile from opening.
  try {
    recordings.removeUnused(progress.recordingsInUse(), now() - DAY_MS);
  } catch (error) {
    console.error("removing unused recordings:", error);
  }
  const runs = createRuns({ store, content });
  const exams = createExams({ store, content, settings, now });
  const cards = createCards({
    cards: cardStore,
    store,
    content,
    settings,
    session: runs.shown,
    myCourses: async () =>
      new Set((await runs.courses()).filter((c) => c.started).map((c) => c.key)),
    now,
  });
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
  const writing = createWriting({ store, session: runs.shown, llm, lessons });
  const scenes = createScenes({ store, llm, lessons });
  const explain = createExplain({ llm, lessons, lessonRun: runs.lessonRun, store, now });
  const speaking = createSpeaking({
    llm,
    lessons,
    lessonRun: runs.lessonRun,
    store,
    hear: speechOfProfile.hearing({
      file: (series, path) => config.library.mediaFile(series, path),
      blob: config.mediaBlob,
    }),
  });
  const examRating = createExamRating({ llm, store, exams });
  const examConversation = createExamConversation({ llm, store, exams });
  const examples = createExamples({
    cards: cardStore,
    lessons,
    llm,
    store,
    reviewRun: study.reviewRun,
  });
  const notebook = createNotebook({
    store,
    content,
    cards: cardStore,
    tutor,
    scenes,
    progress: runs.progress,
    dayStartHour: () => settings.value("srs.dayStartHour"),
    now,
  });
  return {
    library: config.library,
    content,
    downloads,
    settings,
    speech: speechOfProfile,
    recordings,
    runs,
    progress,
    exams,
    cards,
    study,
    words,
    notebook,
    llm,
    explain,
    speaking,
    examRating,
    examConversation,
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
  // Every profile's database migrated now: one that cannot be stops the server here (05), not every
  // request of that profile later.
  for (const p of profiles.list()) config.profiles.open(p.id);
  const open = new Map<string, ProfileServices>();
  // Cards follow their words' lexemes after a course was normalised again (also on a download's end).
  const relink = (s: ProfileServices) =>
    s.cards.relink().catch((error: unknown) => console.error("relinking cards:", error));

  const downloads = createDownloads({
    installer: config.installer,
    now,
    onEnd: () => {
      for (const s of open.values()) void relink(s);
    },
  });
  // Downloads a restart interrupted go on.
  downloads.resume().catch((error: unknown) => console.error("resuming downloads:", error));
  const speech = createSpeech({ host: config.speech, fetch: config.fetch });
  const readAloud = createReadAloud({ host: config.piper, readings: config.readings });
  const qwenTts = createQwenTts({
    host: config.speech,
    readings: config.readings,
    fetch: config.fetch,
  });

  return {
    content,
    downloads,
    speech,
    profiles,
    devices: createDevices({ db: config.server, now }),
    /** Deletes a profile with all it holds — its database and its daily copies, recordings, devices —
     *  its services let go first (the learner's own request, asked to confirm in the app). */
    removeProfile(profileId: string) {
      open.delete(profileId);
      profiles.remove(profileId);
    },
    /** A profile's services (its database opened and its cards relinked on first use). */
    of(profileId: string): ProfileServices {
      let s = open.get(profileId);
      if (!s) {
        s = profileServices(
          config,
          { content, downloads, speech, readAloud, qwenTts },
          config.profiles.open(profileId),
          config.profiles.recordings(profileId),
        );
        open.set(profileId, s);
        void relink(s);
      }
      return s;
    },
  };
}
export type Services = ReturnType<typeof createServices>;
