// What the server makes for a deck's words, kept beside the deck (04; 05): `extras.json` and media/ in
// the deck's folder — an imported deck's, or a course's (`course~<series>~<course>`) — by lexeme, as
// a deck's cards are one per lexeme. Read once and shared by the jobs that write it: one job per deck
// and kind (audio read aloud, examples) at a time, the server's — one profile starts it, any sees
// it —, its progress in memory; stopped, the work under way is finished and kept, and started again
// it does only the rest.

import { LlmError } from "@sprachanker/llm";
import {
  type CardDisplay,
  courseDeckFolder,
  DECK_EXTRAS_FORMAT,
  DeckExtras,
  LexemeKey,
} from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import type { Content } from "./content.ts";
import type { DeckFiles, Decks } from "./decks.ts";
import { readStored } from "./run-store.ts";

export type DeckJobKind = "audio" | "examples";

/** A card of a deck as the deck's jobs take it (cards.ts gives them, in the order they were made). */
export interface DeckNote {
  lexeme: string;
  /** The words' language. */
  lang: string;
  translationLang: string;
  display: CardDisplay;
}

/** A job ends after this many steps in a row that did nothing (each failed). */
const FAILURES_IN_A_ROW = 3;

/** What a job does: its words in steps (a word read aloud, a few words given examples). */
export interface DeckJobSpec<T> {
  steps: T[][];
  /** Steps under way at once. */
  atOnce: number;
  /** extras.json is written after so many words done, and when the job ends. */
  saveEvery: number;
  /** What the job shows of itself besides its progress (the engine that reads). */
  info?: Record<string, string>;
  /** The step under way, as the job shows it. */
  label(step: T[]): string;
  /** Does a step, writing what it made into `book` — never once `dropped()` (the folder is gone):
   *  how many of its words were done and how many failed, and why. Throws: the whole step failed. */
  work(
    step: T[],
    book: DeckExtras,
    dropped: () => boolean,
  ): Promise<{ done: number; failed: number; error?: string }>;
  /** After the job, its work saved (cards follow). */
  end?(): Promise<void>;
}

type Job = {
  /** Stopping: asked to stop, the steps under way still being done (kept when they are). */
  status: "running" | "stopping" | "done" | "stopped" | "failed";
  total: number;
  done: number;
  failed: number;
  /** The step under way. */
  current?: string;
  /** Why the latest step failed: an error code, else the message. */
  error?: string;
  startedAt: number;
  info: Record<string, string>;
  controller: AbortController;
  /** The deck's folder was replaced or removed: what is made is not saved there. */
  dropped?: boolean;
};

/** A job still working (or finishing the steps under way). */
const going = (job: Job | undefined) => job?.status === "running" || job?.status === "stopping";

/** Why something failed: its code when it has one (a service's; a model's as the server answers it,
 *  `llm_<code>`), else its message. */
export function failureOf(error: unknown): string {
  if (error instanceof LlmError) return `llm_${error.code}`;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : String(error).slice(0, 200);
}

export function createDeckExtras(deps: {
  files: Pick<DeckFiles, "extras" | "writeExtras" | "media" | "folders" | "remove">;
  decks: Pick<Decks, "deck">;
  content: Pick<Content, "courses">;
  now(): number;
}) {
  const { files } = deps;
  const books = new Map<string, DeckExtras>();
  const jobs = new Map<string, Job>();
  const jobKey = (kind: DeckJobKind, folder: string) => `${kind} ${folder}`;

  /** A folder's extras as kept (entries an earlier version keyed by note are left out: made again,
   *  the files they name are found there). */
  const book = (folder: string) => {
    let read = books.get(folder);
    if (!read) {
      read = readStored(files.extras(folder) ?? null, DeckExtras, `extras of ${folder}`) ?? {
        format: DECK_EXTRAS_FORMAT,
        words: {},
      };
      for (const key of Object.keys(read.words))
        if (!LexemeKey.safeParse(key).success) delete read.words[key];
      books.set(folder, read);
    }
    return read;
  };

  /** A deck's folder replaced (imported again) or removed: its jobs stop, saving nothing more there,
   *  and its extras are read anew. */
  function forget(folder: string) {
    for (const kind of ["audio", "examples"] as const) {
      const job = jobs.get(jobKey(kind, folder));
      if (!job) continue;
      job.dropped = true;
      if (going(job)) job.status = "stopped";
      job.controller.abort();
      jobs.delete(jobKey(kind, folder));
    }
    books.delete(folder);
  }

  async function run<T>(folder: string, job: Job, spec: DeckJobSpec<T>) {
    const { signal } = job.controller;
    const words = book(folder);
    const dropped = () => !!job.dropped;
    let next = 0;
    let inARow = 0;
    let unsaved = 0;
    /** Writes extras.json; a failure is logged and the words stay unsaved (tried again later). */
    const save = () => {
      if (!unsaved || job.dropped) return true;
      try {
        files.writeExtras(folder, `${JSON.stringify(words, null, 2)}\n`);
        unsaved = 0;
        return true;
      } catch (error) {
        console.error(`saving ${folder}'s extras:`, error);
        job.error = failureOf(error);
        return false;
      }
    };
    const worker = async () => {
      while (!signal.aborted && next < spec.steps.length) {
        const step = spec.steps[next++] as T[];
        job.current = spec.label(step);
        let done = 0;
        try {
          const result = await spec.work(step, words, dropped);
          if (job.dropped) break;
          done = result.done;
          job.done += result.done;
          job.failed += result.failed;
          if (result.error) job.error = result.error;
          unsaved += result.done;
        } catch (error) {
          job.failed += step.length;
          job.error = failureOf(error);
          // Coded failures (an engine's, a model's) are logged where they happen.
          if (!(error as { code?: unknown } | null)?.code) console.error(`${folder}'s job:`, error);
        }
        inARow = done ? 0 : inARow + 1;
        if (inARow >= FAILURES_IN_A_ROW && job.status === "running") {
          job.status = "failed";
          job.controller.abort();
        }
        if (unsaved >= spec.saveEvery) save();
      }
    };
    try {
      await Promise.all(Array.from({ length: spec.atOnce }, worker));
    } catch (error) {
      console.error(`${folder}'s job:`, error);
    }
    if (!save()) job.status = "failed";
    job.current = undefined;
    // Done once the cards show what was made.
    await spec.end?.().catch((error: unknown) => console.error(`after ${folder}'s job:`, error));
    if (job.status === "running") job.status = "done";
    else if (job.status === "stopping") job.status = "stopped";
  }

  return {
    book,

    /** A file of a deck folder's media is there. */
    has: (folder: string, path: string) => !!files.media(folder, path),

    /** The folder of a deck as Review lists it (`course:<key>`, `deck:<id>`); 404 when it is not here. */
    async folderOf(scope: string) {
      if (scope.startsWith("deck:")) {
        const deck = deps.decks.deck(scope.slice("deck:".length));
        if (!deck) throw new ServiceError("no_such_deck", 404);
        return deck.id as string;
      }
      const key = scope.slice("course:".length);
      if (!(await deps.content.courses()).some((c) => c.key === key))
        throw new ServiceError("no_such_deck", 404);
      return courseDeckFolder(key);
    },

    /** A deck's job of a kind, running or the latest; `leftMs`: about how long the rest takes. */
    job(kind: DeckJobKind, folder: string) {
      const job = jobs.get(jobKey(kind, folder));
      if (!job) return null;
      const past = job.done + job.failed;
      const left = job.total - past;
      return {
        status: job.status,
        ...job.info,
        total: job.total,
        done: job.done,
        failed: job.failed,
        ...(job.current && { current: job.current }),
        ...(job.error && { error: job.error }),
        ...(going(job) &&
          past > 0 &&
          left > 0 && { leftMs: Math.round(((deps.now() - job.startedAt) / past) * left) }),
      };
    },

    /** Whether a deck's job of a kind is working. */
    going: (kind: DeckJobKind, folder: string) => going(jobs.get(jobKey(kind, folder))),

    /** Starts a deck's job of a kind (once: one working goes on). */
    start<T>(kind: DeckJobKind, folder: string, spec: DeckJobSpec<T>) {
      if (going(jobs.get(jobKey(kind, folder)))) return;
      const job: Job = {
        status: "running",
        total: spec.steps.reduce((sum, step) => sum + step.length, 0),
        done: 0,
        failed: 0,
        startedAt: deps.now(),
        info: spec.info ?? {},
        controller: new AbortController(),
      };
      jobs.set(jobKey(kind, folder), job);
      void run(folder, job, spec);
    },

    /** Stops a deck's job of a kind: what it made so far is kept. */
    stop(kind: DeckJobKind, folder: string) {
      const job = jobs.get(jobKey(kind, folder));
      if (job?.status !== "running") return;
      job.status = "stopping";
      job.controller.abort();
    },

    forget,

    /** Course folders whose course is no longer here go (at the start). */
    async sweep() {
      const here = new Set((await deps.content.courses()).map((c) => courseDeckFolder(c.key)));
      for (const folder of files.folders())
        if (folder.startsWith("course~") && !here.has(folder)) {
          forget(folder);
          files.remove(folder);
        }
    },
  };
}
export type DeckExtrasStore = ReturnType<typeof createDeckExtras>;
