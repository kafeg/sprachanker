// The services, wired once per server and once per profile (app.ts mounts their routes): the library's
// content, course downloads and imported decks are shared; each profile has its own runs and
// histories, cards and study, Notebook, settings and AI assistant, over its own database, made when it
// is first used.
import type { ApkgRuntime } from "@sprachanker/anki-export";
import type { LibraryView } from "@sprachanker/course-kit/view";
import type { ProfileDb } from "../db/profile/db.ts";
import type { ServerDb } from "../db/server/db.ts";
import { secretBox } from "../security/secrets.ts";
import { createCardStore } from "./card-store.ts";
import { createCards } from "./cards.ts";
import { type Content, createContent } from "./content.ts";
import { createDeckAudio, type DeckAudio } from "./deck-audio.ts";
import { createDecks, type DeckFiles, type Decks } from "./decks.ts";
import { createDevices } from "./devices.ts";
import { type CourseInstaller, createDownloads, type Downloads } from "./downloads.ts";
import { createExamConversation } from "./exam-conversation.ts";
import { createExamRating } from "./exam-rating.ts";
import { createExamples } from "./examples.ts";
import { createExams } from "./exams.ts";
import { createExplain } from "./explain.ts";
import { createLessonContext } from "./lesson-context.ts";
import { createLessonJournal } from "./lesson-journal.ts";
import { createLessons } from "./lessons.ts";
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
  /** The imported decks' folders, and what reading a package needs of the runtime. */
  decks: DeckFiles;
  apkg: ApkgRuntime;
  /** Reads a library media file (runtime adapter): course recordings the recogniser hears. */
  mediaBlob(file: string): Blob;
  now: () => number;
}

/** A take no answer holds goes once it is this old (one younger may be an answer still on its way). */
const DAY_MS = 24 * 60 * 60_000;

/** A profile's services over its database; the content and downloads are the server's. */
function profileServices(
  config: ServicesConfig,
  profileId: string,
  shared: {
    content: Content;
    decks: Decks;
    deckAudio: DeckAudio;
    downloads: Downloads;
    speech: Speech;
    readAloud: ReadAloud;
    qwenTts: QwenTts;
  },
  db: ProfileDb,
  recordingFiles: RecordingFiles,
) {
  const { now } = config;
  const { content, decks, deckAudio, downloads, speech, readAloud, qwenTts } = shared;
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
  const lessons = createLessons({ store, content });
  const exams = createExams({ store, content, settings, now });
  const cards = createCards({
    cards: cardStore,
    store,
    content,
    decks,
    settings,
    session: lessons.shown,
    myCourses: async () =>
      new Set((await lessons.courses()).filter((c) => c.started).map((c) => c.key)),
    readAudio: deckAudio.readAudio,
    usedElsewhere: (deck) => decks.inUse(deck, profileId),
    now,
  });
  const study = createStudy({ cards: cardStore, store, content, decks, settings, now });
  const words = createWords({ cards: cardStore, store });
  const mistakes = createMistakes(store);
  const lessonContext = createLessonContext(content);
  const tutor = createTutor({
    store,
    session: lessons.shown,
    llm,
    mistakes,
    lessonContext,
    tools: createTutorTools({ content, lessonContext, mistakes, progress: lessons.progress }),
    now,
  });
  const writing = createWriting({ store, session: lessons.shown, llm, lessonContext });
  const scenes = createScenes({ store, llm, lessonContext });
  const explain = createExplain({ llm, lessonContext, lessonRun: lessons.lessonRun, store, now });
  const speaking = createSpeaking({
    llm,
    lessonContext,
    lessonRun: lessons.lessonRun,
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
    lessonContext,
    llm,
    store,
    reviewRun: study.reviewRun,
  });
  // Every module reports its standing the same way; the Notebook gathers them.
  const notebook = createNotebook({
    store,
    modules: [study.standing, lessons.standing, exams.standing],
    now,
  });
  const lessonJournal = createLessonJournal({
    store,
    content,
    cards: cardStore,
    chats: (lessonKey) => tutor.chats(lessonKey, Number.POSITIVE_INFINITY),
    scenes: (lessonKey) => scenes.list(lessonKey, Number.POSITIVE_INFINITY),
  });
  return {
    library: config.library,
    content,
    decks,
    // A deck's words read aloud with the engine and voice this profile reads them with.
    deckAudio: {
      state: (scope: string) => deckAudio.state(scope, speechOfProfile.deckReader),
      start: (scope: string) => deckAudio.start(scope, speechOfProfile.deckReader),
      stop: deckAudio.stop,
    },
    downloads,
    settings,
    speech: speechOfProfile,
    recordings,
    lessons,
    progress,
    exams,
    cards,
    study,
    words,
    notebook,
    lessonJournal,
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
  const decks = createDecks({
    files: config.decks,
    apkg: config.apkg,
    // Any profile's cards made from the deck keep it (a profile not opened yet too); `except`: one
    // profile left out (whether others study it).
    inUse: (id, except) =>
      profiles.list().some(
        (p) =>
          p.id !== except &&
          createCardStore(config.profiles.open(p.id))
            .all()
            .some((n) => n.deck === `deck:${id}`),
      ),
    // Cards follow their words in a deck imported again.
    onImport: () => {
      for (const s of open.values()) void relink(s);
    },
    onReplace: (id) => deckAudio.forget(id),
    now,
  });
  // Cards take the audio read aloud for their decks' words.
  const deckAudio = createDeckAudio({
    files: config.decks,
    decks,
    content,
    onRead: async () => {
      await Promise.all([...open.values()].map(relink));
    },
    now,
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
    decks,
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
          profileId,
          { content, decks, deckAudio, downloads, speech, readAloud, qwenTts },
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
