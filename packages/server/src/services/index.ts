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
import {
  type CourseTransfer,
  type CourseTransferFiles,
  createCourseTransfer,
} from "./course-transfer.ts";
import { createCoursesContext } from "./courses-context.ts";
import { createDeckAudio, type DeckAudio } from "./deck-audio.ts";
import { createDeckExamples, type DeckExamples } from "./deck-examples.ts";
import { createDeckExtras, type DeckExtrasStore } from "./deck-extras.ts";
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
import { createNetwork, type ListensOn, type NetworkHost } from "./network.ts";
import { createNotebook } from "./notebook.ts";
import { createProfileSpeech } from "./profile-speech.ts";
import { contentUsed, createProfileTransfer, type TransferFiles } from "./profile-transfer.ts";
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
  /** Profile files exported and imported (runtime adapter). */
  transfers: TransferFiles;
  /** Course bundles exported and imported (runtime adapter). */
  courseTransfers: CourseTransferFiles;
  /** The imported decks' folders, and what reading a package needs of the runtime. */
  decks: DeckFiles;
  apkg: ApkgRuntime;
  /** Reads a library media file (runtime adapter): course recordings the recogniser hears. */
  mediaBlob(file: string): Blob;
  /** Where the server listens, and this machine's networks and Tailscale (runtime adapter). */
  listensOn: ListensOn;
  network?: NetworkHost;
  now: () => number;
}

/** A take no answer holds goes once it is this old (one younger may be an answer still on its way). */
const DAY_MS = 24 * 60 * 60_000;

/** A profile's services over its database; the content and downloads are the server's. */
function profileServices(
  config: ServicesConfig,
  shared: {
    content: Content;
    decks: Decks;
    deckAudio: DeckAudio;
    deckExtras: DeckExtrasStore;
    deckExamples: DeckExamples;
    downloads: Downloads;
    courseTransfer: CourseTransfer;
    speech: Speech;
    readAloud: ReadAloud;
    qwenTts: QwenTts;
  },
  db: ProfileDb,
  recordingFiles: RecordingFiles,
) {
  const { now } = config;
  const { content, decks, deckAudio, deckExtras, deckExamples, downloads, courseTransfer } = shared;
  const { speech, readAloud, qwenTts } = shared;
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
    studiedBy: decks.studiedBy,
    now,
  });
  const study = createStudy({
    cards: cardStore,
    store,
    content,
    decks,
    settings,
    shown: cards.shown,
    now,
  });
  const words = createWords({ cards: cardStore, store, shown: cards.shown });
  const mistakes = createMistakes(store);
  const lessonContext = createLessonContext(content);
  const tutor = createTutor({
    store,
    session: lessons.shown,
    llm,
    mistakes,
    lessonContext,
    tools: createTutorTools({ content, lessonContext, mistakes, progress: lessons.progress }),
    courses: createCoursesContext({ content, lessonContext, studied: lessons.studied, mistakes }),
    placeOn: () => !settings.value("llm.offIn").includes("tutor"),
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
    shown: cards.shown,
    deckNotes: cards.deckNotes,
    decks,
    extras: deckExtras,
    deckExamples,
    lessonContext,
    llm,
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
      state: (scope: string) =>
        deckAudio.state(scope, cards.deckNotes(scope), speechOfProfile.deckReader),
      start: (scope: string) =>
        deckAudio.start(scope, cards.deckNotes(scope), speechOfProfile.deckReader),
      stop: deckAudio.stop,
    },
    downloads,
    courseTransfer,
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
    // The profiles whose cards made from the deck keep it (a profile not opened yet too).
    studiedBy: (id) =>
      profiles
        .list()
        .filter((p) =>
          createCardStore(config.profiles.open(p.id))
            .all()
            .some((n) => n.deck === `deck:${id}`),
        )
        .map((p) => p.name),
    // Cards follow their words in a deck imported again.
    onImport: () => {
      for (const s of open.values()) void relink(s);
    },
    onReplace: (id) => deckExtras.forget(id),
    now,
  });
  // What the server makes for a deck's words (audio read aloud, examples), kept beside the deck; the
  // folders of courses no longer here go.
  const deckExtras = createDeckExtras({ files: config.decks, decks, library: config.library, now });
  try {
    deckExtras.sweep();
  } catch (error) {
    console.error("sweeping deck folders:", error);
  }
  // Cards take the audio read aloud for their decks' words.
  const deckAudio = createDeckAudio({
    extras: deckExtras,
    files: config.decks,
    onRead: async () => {
      await Promise.all([...open.values()].map(relink));
    },
    now,
  });
  // Examples for decks' words, made with the model of the profile that asks.
  const deckExamples = createDeckExamples({ extras: deckExtras, now });
  // Downloads a restart interrupted go on.
  downloads.resume().catch((error: unknown) => console.error("resuming downloads:", error));
  const speech = createSpeech({ host: config.speech, fetch: config.fetch });
  const readAloud = createReadAloud({ host: config.piper, readings: config.readings });
  const qwenTts = createQwenTts({
    host: config.speech,
    readings: config.readings,
    fetch: config.fetch,
  });

  const profileTransfer = createProfileTransfer({
    files: config.transfers,
    profiles,
    used: (id) => {
      const db = config.profiles.open(id);
      return contentUsed(
        createRunStore({ db, now, appVersion: config.appVersion }),
        createCardStore(db),
      );
    },
    content,
    decks: () => decks.list().map((d) => ({ id: d.id, title: d.title })),
    appVersion: config.appVersion,
    now,
  });

  // Courses moved as bundles (the server's, as downloads are); cards follow their words after one.
  const courseTransfer = createCourseTransfer({
    files: config.courseTransfers,
    appVersion: config.appVersion,
    now,
    onInstalled: () => {
      for (const s of open.values()) void relink(s);
    },
  });

  return {
    content,
    decks,
    downloads,
    courseTransfer,
    profileTransfer,
    speech,
    network: createNetwork({ host: config.network, listensOn: config.listensOn, now }),
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
          {
            content,
            decks,
            deckAudio,
            deckExtras,
            deckExamples,
            downloads,
            courseTransfer,
            speech,
            readAloud,
            qwenTts,
          },
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
