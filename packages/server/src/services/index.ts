// The services, wired once per server and once per profile (app.ts mounts their routes): the library's
// content, course downloads and imported decks are shared; each profile has its own runs and
// histories, cards and study, Notebook, settings and AI assistant, over its own database, made when it
// is first used.
import type { ApkgRuntime } from "@sprachanker/anki-export";
import type { LibraryView } from "@sprachanker/course-kit/view";
import {
  courseDeckFolder,
  courseKey,
  editionSetting,
  type LessonKey,
  lessonOrder,
  parseEditionId,
  parseLessonKey,
  type SeriesKey,
} from "@sprachanker/schema";
import type { ProfileDb } from "../db/profile/db.ts";
import type { ServerDb } from "../db/server/db.ts";
import { ServiceError } from "../errors.ts";
import { secretBox } from "../security/secrets.ts";
import { createCardStore } from "./card-store.ts";
import { createCards } from "./cards.ts";
import { type Content, createContent } from "./content.ts";
import { type CourseJobs, createCourseJobs } from "./course-jobs.ts";
import {
  type CourseTransfer,
  type CourseTransferFiles,
  createCourseTransfer,
} from "./course-transfer.ts";
import { createCoursesContext } from "./courses-context.ts";
import { createDeckApkg, type DeckApkg } from "./deck-apkg.ts";
import { createDeckAudio, type DeckAudio } from "./deck-audio.ts";
import { createDeckExamples, type DeckExamples } from "./deck-examples.ts";
import { createDeckExtras, type DeckExtrasStore } from "./deck-extras.ts";
import { createDeckTransfer, type DeckTransfer, type DeckTransferFiles } from "./deck-transfer.ts";
import { createDecks, type DeckFiles, type Decks } from "./decks.ts";
import { createDevices } from "./devices.ts";
import {
  type CourseInstaller,
  createDownloads,
  type Downloads,
  experimentalSwitch,
} from "./downloads.ts";
import { createExamConversation } from "./exam-conversation.ts";
import { createExamRating } from "./exam-rating.ts";
import { createExamples } from "./examples.ts";
import { createExams } from "./exams.ts";
import { createExplain } from "./explain.ts";
import { createFinds } from "./finds.ts";
import { createGoingOver } from "./going-over.ts";
import { createHeard, type Heard, type HeardFiles } from "./heard.ts";
import { createHearing, type Hearing } from "./hearing.ts";
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
  PRACTICE_PARALLEL,
  PRACTICE_STEPS,
  type PracticeFiles,
  type PracticeStepName,
  type PracticeTarget,
  type PracticeUnit,
} from "./practice.ts";
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
import { createUpdates, type UpdateConfig } from "./updates.ts";
import { createWordVoice, type WordVoice } from "./word-voice.ts";
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
  /** Experimental courses offered and listed (`serve --experimental`): `experimentalSwitch`. */
  experimental?: boolean;
  speech?: SpeechHost;
  piper?: PiperHost;
  /** Readings kept (Piper's and Qwen3-TTS's); without it each is made again. */
  readings?: ReadingCache;
  /** Profile files exported and imported (runtime adapter). */
  transfers: TransferFiles;
  /** Course bundles exported and imported (runtime adapter). */
  courseTransfers: CourseTransferFiles;
  /** Deck files exported and imported (runtime adapter). */
  deckTransfers: DeckTransferFiles;
  /** A course's practice written (runtime adapter); without it none is made. */
  practice?: PracticeFiles;
  /** A course's recordings heard written (runtime adapter); without it none is heard. */
  heard?: HeardFiles;
  /** The imported decks' folders, and what reading a package needs of the runtime. */
  decks: DeckFiles;
  apkg: ApkgRuntime;
  /** Reads a library media file (runtime adapter): course recordings the recogniser hears. */
  mediaBlob(file: string): Blob;
  /** Where the server listens, and this machine's networks and Tailscale (runtime adapter). */
  listensOn: ListensOn;
  network?: NetworkHost;
  /** What updates this build (absent: a build from the sources). */
  update?: UpdateConfig;
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
    deckTransfer: DeckTransfer;
    deckApkg: DeckApkg;
    speech: Speech;
    readAloud: ReadAloud;
    qwenTts: QwenTts;
    wordVoice: WordVoice;
    practiceJobs: CourseJobs<PracticeTarget, PracticeUnit>;
    heard: Heard;
    hearing: Hearing;
    /** Whether an installed course is listed (an experimental one only with `--experimental`). */
    listed: (key: string) => boolean;
  },
  profileId: string,
  db: ProfileDb,
  recordingFiles: RecordingFiles,
) {
  const { now } = config;
  const { content, deckAudio, deckExtras, deckExamples, downloads, courseTransfer } = shared;
  // The decks as this profile sees them: another profile's own (its Finds) left out.
  const decks = shared.decks.of(profileId);
  const { speech, readAloud, qwenTts, wordVoice } = shared;
  const settings = createSettings(db);
  const speechOfProfile = createProfileSpeech({ speech, readAloud, qwenTts, wordVoice, settings });
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
  // The lesson's AI practice taken as it starts (the prep is made below, with the AI's services).
  let lessonStarted: (lesson: LessonStart) => void = () => {};
  const lessons = createLessons({
    store,
    content,
    heard: shared.heard.texts,
    started: (lesson) => lessonStarted(lesson),
    listed: shared.listed,
  });
  const exams = createExams({ store, content, settings, now, listed: shared.listed });
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
    madeFor: (folder) => Object.keys(deckExtras.book(folder).words).length > 0,
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
  const mistakes = createMistakes(store, lessons.judged);
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
  const practicePrep = createPracticePrep({ understanding, writing, talk, settings });
  lessonStarted = practicePrep.lessonStarted;
  const goingOver = createGoingOver({ store, session: lessons.shown, llm, lessonContext });
  const scenes = createScenes({ store, llm, lessonContext });
  const explain = createExplain({ llm, lessonContext, lessonRun: lessons.lessonRun, store, now });
  const speaking = createSpeaking({
    llm,
    lessonContext,
    lessonRun: lessons.lessonRun,
    store,
    heard: (series, lessonKey) => shared.heard.texts(series, parseLessonKey(lessonKey).courseId),
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
  // Words selected anywhere, translated by this profile's model and kept in its own deck "Finds".
  const finds = createFinds({
    profile: profileId,
    llm,
    decks,
    notes: () => cardStore.all(),
    // The word as a card already, whatever the part of speech or gender its key was made with (the
    // model's and the course's may differ): the same lemma in the same language.
    hasCard: (lexeme, lang) => {
      if (cardStore.byLexeme(lexeme, lang)) return true;
      const lemma = lexeme.split(":").slice(0, 3).join(":");
      return cardStore
        .all()
        .some(
          (n) =>
            n.translationLang === lang && n.lexemeKey?.split(":").slice(0, 3).join(":") === lemma,
        );
    },
    take: (deck, keys) => cards.takeDeck({ deck }, keys),
    // The edition each started course is shown in (the learner's choice of it), else its editions.
    started: async () =>
      (await lessons.courses())
        .filter((c) => c.started)
        .flatMap((c) => {
          const chosen = settings.all()[editionSetting(c.series, c.course)];
          return (typeof chosen === "string" ? [chosen] : c.editions).map((e) =>
            parseEditionId(e as Parameters<typeof parseEditionId>[0]),
          );
        })
        .map(({ source, target }) => ({ lang: target, translationLang: source })),
    reader: speechOfProfile.deckReader,
    warm: speechOfProfile.warmWords,
    uiLanguage: () => settings.value("uiLanguage"),
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
    judged: lessons.judged,
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
      // Only a deck this profile sees (another's Finds is none of it).
      stop: async (scope: string) => {
        await cards.sourceNotes(scope);
        return deckAudio.stop(scope);
      },
      remove: async (scope: string) => {
        await cards.sourceNotes(scope);
        return deckAudio.remove(scope);
      },
    },
    downloads,
    courseTransfer,
    // Decks as files: those this profile sees exported, a Finds deck imported as its own and taken.
    deckTransfer: shared.deckTransfer.of(profileId, (deck, from, keys, added) => {
      const moved = cards.moveDeck(from, deck, keys);
      // Only the words added and those moved: a word whose card the learner left stays without one.
      return cards.takeDeck({ deck }, [...added, ...moved]);
    }),
    // Decks this profile sees as Anki packages: their words as its cards show them.
    deckApkg: shared.deckApkg.of(profileId, {
      notes: cards.sourceNotes,
      aiExamples: () => !settings.value("llm.offIn").includes("example"),
    }),
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
    /** The source's answers a lesson's items are checked by, as heard so far: those not heard yet
     *  heard in the background, with this profile's model while it hears speech. */
    heard: {
      lesson: (series: string, lessonKey: LessonKey) => {
        const { recognition, model } = speechOfProfile.state();
        return shared.heard.lesson(series, lessonKey, (recognition && model) || undefined);
      },
    },
    /** The course preparation step hearing the source's answers: the server's, every profile's. */
    hearing: shared.hearing,
    examRating,
    examConversation,
    examples,
    finds,
    tutor,
    understanding,
    writing,
    practicePrep,
    // The course's practice made in one go, by this profile's model and voices: its state, a job.
    practiceCourse: {
      /** How many variants of each step a lesson's practice has in an edition, and how many of them
       *  the learner has not had yet. */
      lesson: (series: string, lessonKey: LessonKey, edition: string) =>
        practice.counts({ series, lessonKey, edition }),
      /** The step's next variant the learner has not had taken into the run the lesson shows (owner,
       *  2026-10-15: "Another version", no model); none left: no_such_item. `ifNone`: only while the
       *  learner has no work of the step yet (a step opening empty) — else null, nothing taken. */
      async next(
        series: string,
        lessonKey: LessonKey,
        edition: string,
        step: PracticeStepName,
        ifNone = false,
      ) {
        const r = { series, lessonKey, edition };
        const taken = await practice.take(
          r,
          step,
          () => !ifNone || !practice.worked(lessonKey, step),
        );
        if (taken) return taken;
        if (ifNone && practice.worked(lessonKey, step)) return null;
        throw new ServiceError("no_such_item", 404);
      },
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
          job: shared.practiceJobs.get({ series, course, edition }),
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
        // Each lesson's steps filled up to the count (owner, 2026-10-14): a job started again goes
        // on where the last one stopped.
        const units: Array<PracticeUnit & { count: number }> = [];
        for (const lessonKey of lessons) {
          const has = await practice.lesson({ series, lessonKey, edition });
          for (const step of steps) {
            const count = options.count - (has?.[step].length ?? 0);
            if (count > 0) units.push({ lessonKey, step, count });
          }
        }
        const language = practice.language(edition);
        // Several units at a time; one on this computer's own model (LM Studio answers one at a time).
        const parallel = llm.state().provider === "lmstudio" ? 1 : PRACTICE_PARALLEL;
        return shared.practiceJobs.start(
          { series, course, edition, steps, count: options.count },
          units,
          async ({ lessonKey, step, count }) => {
            const request = { series, lessonKey, edition, language };
            if (step === "reading" || step === "listening")
              await understanding.make({ ...request, step }, count);
            else if (step === "writing") await writing.make(request, count);
            else await talk.make(request, count);
          },
          parallel,
        );
      },
      stop: (series: string, course: string, edition: string) =>
        shared.practiceJobs.stop({ series, course, edition }),
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

  const { installer, listed } = experimentalSwitch(config.installer, !!config.experimental);
  const downloads = createDownloads({
    installer,
    now,
    // A download ended: the course's recordings of the source's answers heard (its next step).
    onEnd: (series, course) => {
      for (const s of open.values()) void relink(s);
      hearing.installed(series, course);
    },
    // A course removed: its deck folder's jobs stop, saving nothing more (deck-extras writes no
    // course folder of a course not installed); what they made stays for the course's return.
    onRemoved: (series, course) => {
      deckExtras.forget(courseDeckFolder(`${series}/${course}`));
      hearing.forget(series, course);
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
  // What the server makes for a deck's words (audio read aloud, examples), kept beside the deck.
  const deckExtras = createDeckExtras({ files: config.decks, decks, library: config.library, now });
  // Cards take the audio read aloud for their decks' words.
  const practiceJobs = createCourseJobs<PracticeTarget, PracticeUnit>({ now });
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
  // A Whisper model downloaded: the courses waiting to be heard go on.
  const speech = createSpeech({
    host: config.speech,
    fetch: config.fetch,
    installed: () => void hearing.modelReady(),
  });
  // The source's answers heard once into the courses, the same for every profile.
  const heard = createHeard({
    library: config.library,
    content,
    speech,
    ...(config.heard && { files: config.heard }),
    mediaBlob: config.mediaBlob,
    now,
  });
  // The course preparation step after every install: the source's answers heard (hearing.ts), with
  // the model the engine runs, else the best installed for this machine; none without heard files.
  const heardFiles = config.heard;
  const hearing = createHearing({
    heard,
    files: heardFiles ?? { marker: () => undefined, mark() {} },
    engine: () => !!heardFiles && speech.built(),
    model: () => (heardFiles && speech.built() ? speech.modelFor(speech.loaded()) : undefined),
    // The courses listed only: an experimental one is not prepared without --experimental.
    courses: () =>
      config.library.courses().filter((c) => listed(courseKey(c.series as SeriesKey, c.course))),
    now,
  });
  // A server that installs courses looks at every installed one once (not a command beside it).
  if (config.installer) void hearing.sweep();
  const readAloud = createReadAloud({ host: config.piper, readings: config.readings });
  const qwenTts = createQwenTts({
    host: config.speech,
    readings: config.readings,
    fetch: config.fetch,
  });
  // The voice words are read with, taken from a course's recording: every profile's.
  const wordVoice = createWordVoice({
    // Recordings proposed from the courses listed only (an experimental one with --experimental).
    content: { courses: async () => (await content.courses()).filter((c) => listed(c.key)) },
    library: config.library,
    qwen: qwenTts,
    store: config.speech?.wordVoices,
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
    onInstalled: (courses) => {
      for (const s of open.values()) void relink(s);
      for (const c of courses) hearing.installed(c.series, c.course);
    },
    listed,
  });

  // Decks moved as files (the server's, as decks are); cards follow their words after one.
  const deckTransfer = createDeckTransfer({
    files: config.deckTransfers,
    decks,
    extras: deckExtras,
    course: async (key) => {
      const c = (await content.courses()).find((c) => c.key === key);
      if (!c) return undefined;
      const [first] = c.editions;
      if (!first) return undefined;
      const pairs = c.editions.map((e) =>
        parseEditionId(e as Parameters<typeof parseEditionId>[0]),
      );
      return {
        lang: pairs[0]?.target as string,
        translationLangs: [...new Set(pairs.map((p) => p.source))],
        title: c.titles[first] ?? key,
      };
    },
    onImported: () => {
      for (const s of open.values()) void relink(s);
    },
    appVersion: config.appVersion,
    now,
  });
  // Decks as Anki packages, with what is played for their words.
  const deckApkg = createDeckApkg({
    files: config.deckTransfers,
    apkg: config.apkg,
    folderOf: deckExtras.folderOf,
    readAudio: deckAudio.readAudio,
    examplesOf: deckExamples.examplesOf,
    now,
  });

  return {
    content,
    decks,
    downloads,
    courseTransfer,
    profileTransfer,
    heard,
    hearing,
    speech,
    network: createNetwork({ host: config.network, listensOn: config.listensOn, now }),
    updates: createUpdates({
      version: config.appVersion,
      update: config.update,
      fetch: config.fetch,
      now,
    }),
    profiles,
    devices: createDevices({ db: config.server, now }),
    /** Deletes a profile with all it holds — its database and its daily copies, recordings, devices —
     *  its services let go first (the learner's own request, asked to confirm in the app). */
    removeProfile(profileId: string) {
      open.delete(profileId);
      profiles.remove(profileId);
      decks.removeOwned(profileId);
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
            deckTransfer,
            deckApkg,
            speech,
            readAloud,
            practiceJobs,
            heard,
            hearing,
            qwenTts,
            wordVoice,
            listed,
          },
          profileId,
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
