// Audio read aloud for a deck's words without their own (04, "Decks"; 08): an imported deck's or a
// course's, read by the server's engine (Piper or Qwen3-TTS) a word at a time and kept in the deck's
// folder — `extras.json` and media/ (05) — so cards play it on any device. Server-wide: one job per
// deck at a time, its progress in memory; stopped and started again, it goes on where it was (a word
// read is not read again unless its text changed).
import {
  courseDeckFolder,
  DECK_EXTRAS_FORMAT,
  DeckExtras,
  type DeckReadAudio,
  type LexemeKey,
  parseLexemeKey,
} from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import { sha256Hex } from "../security/encoding.ts";
import type { Content } from "./content.ts";
import type { DeckFiles, Decks } from "./decks.ts";
import { readStored } from "./run-store.ts";

/** A server engine reading a language with one voice (profile-speech.ts chooses them). */
export interface DeckReader {
  engine: DeckReadAudio["engine"];
  voice: string;
  read(text: string): Promise<Uint8Array>;
}

/** Words read at once: Piper runs a process per word; Qwen3-TTS is one engine reading one at a time. */
const AT_ONCE: Record<DeckReader["engine"], number> = { piper: 2, qwen: 1 };
/** extras.json is written after every so many words read, and when the job ends. */
const SAVE_EVERY = 20;
/** A job stops after this many words in a row the engine could not read. */
const FAILURES_IN_A_ROW = 3;

type Job = {
  /** Stopping: asked to stop, the words under way still being read (kept when they are). */
  status: "running" | "stopping" | "done" | "stopped" | "failed";
  engine: DeckReader["engine"];
  voice: string;
  total: number;
  done: number;
  failed: number;
  /** The word being read. */
  current?: string;
  /** Why the latest word failed: an error code, else the engine's message. */
  error?: string;
  controller: AbortController;
  /** The deck's folder was replaced or removed: what is read is not saved there. */
  dropped?: boolean;
};

type Word = { key: string; text: string; own: boolean };

/** A job still reading (or finishing the words under way). */
const going = (job: Job | undefined) => job?.status === "running" || job?.status === "stopping";

export function createDeckAudio(deps: {
  files: Pick<DeckFiles, "extras" | "writeExtras" | "writeMedia">;
  decks: Pick<Decks, "deck">;
  content: Pick<Content, "courses" | "lesson">;
  /** After a job: cards follow (their display takes the audio read). */
  onRead(): Promise<void>;
  now(): number;
}) {
  const { files } = deps;
  const extras = new Map<string, DeckExtras>();
  const jobs = new Map<string, Job>();

  const extrasOf = (folder: string) => {
    let read = extras.get(folder);
    if (!read) {
      read = readStored(files.extras(folder) ?? null, DeckExtras, `extras of ${folder}`) ?? {
        format: DECK_EXTRAS_FORMAT,
        words: {},
      };
      extras.set(folder, read);
    }
    return read;
  };

  /** A word's reading while it is of the word's text now. */
  const readingOf = (folder: string, key: string, text: string) => {
    const audio = extrasOf(folder).words[key]?.audio;
    return audio?.text === text ? audio : undefined;
  };

  /** A deck's folder, the language of its words and its words: an imported deck's notes, a course's
   *  lexemes (each by its first entry in course order, as its deck is taken). */
  async function deckOf(scope: string): Promise<{ folder: string; lang: string; words: Word[] }> {
    if (scope.startsWith("deck:")) {
      const deck = deps.decks.deck(scope.slice("deck:".length));
      if (!deck) throw new ServiceError("no_such_deck", 404);
      return {
        folder: deck.id,
        lang: deck.lang,
        words: deck.words.map((w) => ({ key: w.key, text: w.target, own: !!w.audio })),
      };
    }
    const key = scope.slice("course:".length);
    const course = (await deps.content.courses()).find((c) => c.key === key);
    if (!course) throw new ServiceError("no_such_deck", 404);
    const words = new Map<string, Word>();
    for (const lesson of course.lessons)
      for (const v of (await deps.content.lesson(course.series, lesson)).vocab)
        if (!words.has(v.lexeme))
          words.set(v.lexeme, { key: v.lexeme, text: v.target, own: !!v.audio });
    const first = words.keys().next().value;
    return {
      folder: courseDeckFolder(course.key),
      lang: first ? parseLexemeKey(first as LexemeKey).lang : "",
      words: [...words.values()],
    };
  }

  /** Reads `todo` with `reader` into the deck's folder, a few at a time, saving as it goes. */
  async function run(folder: string, job: Job, todo: Word[], reader: DeckReader) {
    const { signal } = job.controller;
    const book = extrasOf(folder);
    let next = 0;
    let inARow = 0;
    let unsaved = 0;
    const save = () => {
      if (!unsaved || job.dropped) return;
      unsaved = 0;
      files.writeExtras(folder, `${JSON.stringify(book, null, 2)}\n`);
    };
    const worker = async () => {
      while (!signal.aborted && next < todo.length) {
        const word = todo[next++] as Word;
        job.current = word.text;
        try {
          const bytes = await reader.read(word.text);
          if (signal.aborted && job.dropped) break;
          const hash = await sha256Hex(`${reader.engine}\n${reader.voice}\n${word.text}`, 12);
          const path = `media/read-${hash}.wav`;
          files.writeMedia(folder, path, bytes);
          book.words[word.key] = {
            ...book.words[word.key],
            audio: {
              path,
              engine: reader.engine,
              voice: reader.voice,
              text: word.text,
              made: deps.now(),
            },
          };
          job.done++;
          inARow = 0;
          if (++unsaved >= SAVE_EVERY) save();
        } catch (error) {
          job.failed++;
          // The engines log their own failures.
          if (error instanceof ServiceError) job.error = error.code;
          else {
            job.error = String(error).slice(0, 200);
            console.error(`reading ${folder}'s word aloud:`, error);
          }
          if (++inARow >= FAILURES_IN_A_ROW && job.status === "running") {
            job.status = "failed";
            job.controller.abort();
          }
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: AT_ONCE[reader.engine] }, worker));
      save();
    } catch (error) {
      console.error(`saving ${folder}'s audio:`, error);
      job.status = "failed";
      job.error = String(error).slice(0, 200);
    } finally {
      job.current = undefined;
      // Done once the cards show what was read.
      await deps.onRead().catch((error: unknown) => console.error("after reading aloud:", error));
      if (job.status === "running") job.status = "done";
      else if (job.status === "stopping") job.status = "stopped";
    }
  }

  return {
    /** A word's audio read aloud, `<folder>/media/<file>`, while it is of the word's text now. */
    readAudio(folder: string, key: string, text: string) {
      const audio = readingOf(folder, key, text);
      return audio && `${folder}/${audio.path}`;
    },

    /** A deck's words — with audio of their own, read aloud, without — the engine that would read
     *  them (none: nothing here reads their language) and the deck's job, running or the latest. */
    async state(scope: string, readerOf: (lang: string) => DeckReader | undefined) {
      const { folder, lang, words } = await deckOf(scope);
      const own = words.filter((w) => w.own).length;
      const read = words.filter((w) => !w.own && readingOf(folder, w.key, w.text)).length;
      const reader = readerOf(lang);
      const job = jobs.get(folder);
      return {
        lang,
        words: words.length,
        own,
        read,
        missing: words.length - own - read,
        reader: reader ? { engine: reader.engine, voice: reader.voice } : null,
        job: job
          ? {
              status: job.status,
              engine: job.engine,
              total: job.total,
              done: job.done,
              failed: job.failed,
              ...(job.current && { current: job.current }),
              ...(job.error && { error: job.error }),
            }
          : null,
      };
    },

    /** Starts reading a deck's words without audio (once: a job running goes on). */
    async start(scope: string, readerOf: (lang: string) => DeckReader | undefined) {
      const { folder, lang, words } = await deckOf(scope);
      if (going(jobs.get(folder))) return;
      const reader = readerOf(lang);
      if (!reader) throw new ServiceError("speech_unavailable", 409);
      const todo = words.filter((w) => !w.own && !readingOf(folder, w.key, w.text));
      const job: Job = {
        status: "running",
        engine: reader.engine,
        voice: reader.voice,
        total: todo.length,
        done: 0,
        failed: 0,
        controller: new AbortController(),
      };
      jobs.set(folder, job);
      void run(folder, job, todo, reader);
    },

    /** Stops a deck's job: the words read so far are kept. */
    async stop(scope: string) {
      const job = jobs.get((await deckOf(scope)).folder);
      if (job?.status !== "running") return;
      job.status = "stopping";
      job.controller.abort();
    },

    /** A deck's folder is replaced (imported again) or removed: its job stops, saving nothing more
     *  there, and its extras are read anew. */
    forget(folder: string) {
      const job = jobs.get(folder);
      if (job) {
        job.dropped = true;
        if (going(job)) job.status = "stopped";
        job.controller.abort();
        jobs.delete(folder);
      }
      extras.delete(folder);
    },
  };
}
export type DeckAudio = ReturnType<typeof createDeckAudio>;
