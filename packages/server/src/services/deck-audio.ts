// Audio read aloud for a deck's words without their own (04, "A deck's words read aloud"; 08): the
// words of the learner's cards in a deck — an imported deck's or a course's —, read by the server's
// engine (Piper or Qwen3-TTS) a word at a time and kept in the deck's folder by lexeme (deck-extras.ts),
// so cards play it on any device. A word read is not read again unless its text changed; the file
// its earlier reading was in goes then.
import type { DeckReadAudio } from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import { sha256Hex } from "../security/encoding.ts";
import type { DeckExtrasStore, DeckJobSpec, DeckNote } from "./deck-extras.ts";
import type { DeckFiles } from "./decks.ts";

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

/** The text read for a word as its card shows it: variants ("der Großvater / der Opa") as a list. */
export const spokenText = (target: string) => target.replace(/\s*\/\s*/g, ", ").trim();

type Word = { key: string; text: string; own: boolean };

/** A deck's words, one per lexeme (a lexeme's cards in two translation languages are one word). */
function wordsOf(notes: DeckNote[]): Word[] {
  const words = new Map<string, Word>();
  for (const n of notes)
    if (!words.has(n.lexeme))
      words.set(n.lexeme, {
        key: n.lexeme,
        text: spokenText(n.display.target),
        own: !!n.display.audio,
      });
  return [...words.values()];
}

export function createDeckAudio(deps: {
  extras: DeckExtrasStore;
  files: Pick<DeckFiles, "writeMedia" | "removeMedia">;
  /** After a job: cards follow (their display takes the audio read). */
  onRead(): Promise<void>;
  now(): number;
}) {
  const { extras, files } = deps;

  /** A word's reading while it is of the word's text now and its file is there. */
  const readingOf = (folder: string, key: string, text: string) => {
    const audio = extras.book(folder).words[key]?.audio;
    return audio?.text === text && extras.has(folder, audio.path) ? audio : undefined;
  };

  /** Reads one word into the deck's folder (a file read before with this engine, voice and text is
   *  taken as it is); the file of the word's earlier reading goes unless another word's is it. */
  const readWord =
    (folder: string, reader: DeckReader): DeckJobSpec<Word>["work"] =>
    async ([word], book, dropped) => {
      const w = word as Word;
      const hash = await sha256Hex(`${reader.engine}\n${reader.voice}\n${w.text}`, 12);
      const path = `media/read-${hash}.wav`;
      if (!extras.has(folder, path)) {
        const bytes = await reader.read(w.text);
        // A folder removed meanwhile is not made again.
        if (dropped()) return { done: 0, failed: 0 };
        files.writeMedia(folder, path, bytes);
      }
      if (dropped()) return { done: 0, failed: 0 };
      const before = book.words[w.key]?.audio?.path;
      book.words[w.key] = {
        ...book.words[w.key],
        audio: { path, engine: reader.engine, voice: reader.voice, text: w.text, made: deps.now() },
      };
      if (
        before &&
        before !== path &&
        !Object.values(book.words).some((x) => x.audio?.path === before)
      )
        files.removeMedia(folder, before);
      return { done: 1, failed: 0 };
    };

  return {
    /** A word's audio read aloud, `<folder>/media/<file>`, while it is of the word as shown now
     *  (`target`) and its file is there. */
    readAudio(folder: string, key: string, target: string) {
      const audio = readingOf(folder, key, spokenText(target));
      return audio && `${folder}/${audio.path}`;
    },

    /** A deck's words (of the learner's cards in it) — with audio of their own, read aloud, without —
     *  the engine that would read them (none: nothing here reads their language) and the deck's job,
     *  running or the latest. */
    async state(
      scope: string,
      notes: DeckNote[],
      readerOf: (lang: string) => DeckReader | undefined,
    ) {
      const folder = await extras.folderOf(scope);
      const words = wordsOf(notes);
      const lang = notes[0]?.lang ?? "";
      const own = words.filter((w) => w.own).length;
      const read = words.filter((w) => !w.own && readingOf(folder, w.key, w.text)).length;
      const reader = lang ? readerOf(lang) : undefined;
      return {
        lang,
        words: words.length,
        own,
        read,
        missing: words.length - own - read,
        reader: reader ? { engine: reader.engine, voice: reader.voice } : null,
        job: extras.job("audio", folder),
      };
    },

    /** Starts reading a deck's words without audio (once: a job running goes on). */
    async start(
      scope: string,
      notes: DeckNote[],
      readerOf: (lang: string) => DeckReader | undefined,
    ) {
      const folder = await extras.folderOf(scope);
      if (extras.going("audio", folder)) return;
      const reader = notes[0] && readerOf(notes[0].lang);
      if (!reader) throw new ServiceError("speech_unavailable", 409);
      const todo = wordsOf(notes).filter((w) => !w.own && !readingOf(folder, w.key, w.text));
      extras.start("audio", folder, {
        steps: todo.map((w) => [w]),
        atOnce: AT_ONCE[reader.engine],
        saveEvery: SAVE_EVERY,
        info: { engine: reader.engine },
        label: ([w]) => (w as Word).text,
        work: readWord(folder, reader),
        end: deps.onRead,
      });
    },

    /** Stops a deck's job: the words read so far are kept. */
    async stop(scope: string) {
      extras.stop("audio", await extras.folderOf(scope));
    },
  };
}
export type DeckAudio = ReturnType<typeof createDeckAudio>;
