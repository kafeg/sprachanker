// The services, wired once per server and once per profile (app.ts mounts their routes): the library's
// content, course downloads and imported decks are shared; each profile has its own runs and
// histories, cards and study, Notebook, settings and AI assistant, over its own database, made when it
// is first used.
import type { ApkgRuntime } from "@sprachanker/anki-export";
import type { LibraryView } from "@sprachanker/course-kit/view";
import { lessonOrder, parseEditionId } from "@sprachanker/schema";
import type { ProfileDb } from "../db/profile/db.ts";
import type { ServerDb } from "../db/server/db.ts";
import { ServiceError } from "../errors.ts";
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
import { createGoingOver } from "./going-over.ts";
import { createLessonContext } from "./lesson-context.ts";
import { createLessonJournal } from "./lesson-journal.ts";
import { createLessons, type LessonStart } from "./lessons.ts";
import { type CliHost, createLlm, type LmStudioHost } from "./llm.ts";
import type { ReadingCache, SpeechHost } from "./local-engines.ts";
import { createMistakes } from "./mistakes.ts";
import { createNetwork, type ListensOn, type NetworkHost } from "./network.ts";
import { createNotebook } from "./notebook.ts";
import {
  createPractice,
  PRACTICE_STEPS,
  type PracticeFiles,
  type PracticeStepName,
} from "./practice.ts";
import { createPracticeJobs, type PracticeJobs } from "./practice-jobs.ts";
import { createPracticePrep } from "./practice-prep.ts";
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
import { createTalk } from "./talk.ts";
import { createTextMaker } from "./text-maker.ts";
import { createTutor } from "./tutor.ts";
import { createTutorTools } from "./tutor-tools.ts";
import { createUnderstanding } from "./understanding.ts";
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
  /** A course's practice written (runtime adapter); without it none is made. */
  practice?: PracticeFiles;
  /** The imported decks' folders, and what reading a package needs of the runtime. */
  decks: DeckFiles;
  apkg: ApkgRuntime;
  /** Reads a library media file (runtime adapter): course recordings the recogniser hears. */
  mediaBlob(file: string): Blob;
  /** Where the server listens, and this machine's networks and Tailscale (runtime adapter). */
  listensOn: ListensOn;
  network?: NetworkHost;
  now: () => number;
  random: () => number;
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
    practiceJobs: PracticeJobs;
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
  // The lesson's AI practice made ahead as it starts (the prep is made below, with the AI's services).
  let lessonStarted: (lesson: LessonStart) => void = () => {};
  const lessons = createLessons({ store, content, started: (lesson) => lessonStarted(lesson) });
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
  const maker = createTextMaker({ store, llm, lessonContext, random: config.random });
  const practice = createPractice({
    store,
    library: config.library,
    ...(config.practice && { files: config.practice }),
    session: lessons.shown,
    random: config.random,
    now,
  });
  const reader = (lang: string) => speechOfProfile.practiceReader(lang);
  const understanding = createUnderstanding({
    store,
    llm,
    maker,
    practice,
    reader,
    recording: async (series, path) => {
      const file = config.library.practiceFile(series, path);
      return file ? new Uint8Array(await config.mediaBlob(file).arrayBuffer()) : undefined;
    },
    voices: speechOfProfile.textVoices,
    say: (text, lang, voice) => speechOfProfile.say({ text, lang, ...(voice && { voice }) }),
    now,
  });
  const writing = createWriting({
    store,
    session: lessons.shown,
    llm,
    lessonContext,
    maker,
    practice,
    random: config.random,
    now,
  });
  const talk = createTalk({
    store,
    session: lessons.shown,
    llm,
    maker,
    practice,
    reader,
    now,
  });
  const practicePrep = createPracticePrep({ understanding, writing, talk, settings, llm });
  lessonStarted = practicePrep.lessonStarted;
  const goingOver = createGoingOver({ store, session: lessons.shown, llm, lessonContext });
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
  const examConversation = createExamConversation({
    llm,
    store,
    exams,
    voices: speechOfProfile.textVoices,
    random: config.random,
  });
  const examples = createExamples({
    cards: cardStore,
    shown: cards.shown,
    sourceNotes: cards.sourceNotes,
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
    // A deck's words, taken or not, read aloud with the engine and voice this profile reads them with.
    deckAudio: {
      state: async (scope: string) =>
        deckAudio.state(scope, await cards.sourceNotes(scope), speechOfProfile.deckReader),
      start: async (scope: string, again?: boolean) =>
        deckAudio.start(scope, await cards.sourceNotes(scope), speechOfProfile.deckReader, again),
      stop: deckAudio.stop,
      remove: deckAudio.remove,
    },
    downloads,
    courseTransfer,
    settings,
    speech: speechOfProfile,
    recordings: {
      ...recordings,
      /** A take nothing was heard in removed, unless an answer holds it. */
      forget: (id: string) => recordings.forget(id, progress.recordingsInUse()),
    },
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
    understanding,
    writing,
    practicePrep,
    // The course's practice made in one go, by this profile's model and voices: its state, a job.
    practiceCourse: {
      async state(series: string, course: string, edition: string) {
        const lessons = lessonOrder(await shared.content.courseIndex(series, course));
        const variants = { reading: 0, listening: 0, writing: 0, speaking: 0 };
        let made = 0;
        for (const lessonKey of lessons) {
          const p = await practice.lesson({ series, lessonKey, edition });
          if (!p) continue;
          made++;
          for (const step of PRACTICE_STEPS) variants[step] += p[step].length;
        }
        return {
          lessons: lessons.length,
          made,
          variants,
          voice: !!reader(parseEditionId(edition).target),
          job: shared.practiceJobs.get(series, course, edition),
        };
      },
      async start(
        series: string,
        course: string,
        edition: string,
        options: { steps: PracticeStepName[]; count: number },
      ) {
        if (options.steps.includes("listening") && !reader(parseEditionId(edition).target))
          throw new ServiceError("practice_needs_voice", 409);
        const lessons = lessonOrder(await shared.content.courseIndex(series, course));
        const steps = PRACTICE_STEPS.filter((s) => options.steps.includes(s));
        const units = lessons.flatMap((lessonKey) => steps.map((step) => ({ lessonKey, step })));
        const language = practice.language(edition);
        return shared.practiceJobs.start(
          { series, course, edition, steps, count: options.count },
          units,
          async ({ lessonKey, step }) => {
            const request = { series, lessonKey, edition, language };
            if (step === "reading" || step === "listening")
              await understanding.make({ ...request, step }, options.count);
            else if (step === "writing") await writing.make(request, options.count);
            else await talk.make(request, options.count);
          },
        );
      },
      stop: (series: string, course: string, edition: string) =>
        shared.practiceJobs.stop(series, course, edition),
    },
    talk,
    goingOver,
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
  // Every profile's database migrated now: one that cannot be stops the server here, not every
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
    // The profiles whose cards made from the deck keep it (a profile not opened yet too); one whose
    // cards do not read is counted as keeping it — logged, never failing the others.
    studiedBy: (id) =>
      profiles
        .list()
        .filter((p) => {
          try {
            return createCardStore(config.profiles.open(p.id))
              .all()
              .some((n) => n.deck === `deck:${id}`);
          } catch (error) {
            console.error(`profile ${p.id}: its cards do not read:`, error);
            return true;
          }
        })
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
  const practiceJobs = createPracticeJobs({ now });
  const deckAudio = createDeckAudio({
    extras: deckExtras,
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
            practiceJobs,
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
