// Audio read aloud for a deck's words without their own: the
// words of a deck, taken or not — an imported deck's notes, a course's words in every headword its
// lessons give them as —, read by the server's engine (Piper or Qwen3-TTS) a headword at a time and
// kept in the deck's folder by lexeme (deck-extras.ts), so cards play it on any device. A headword read
// is not read again; one the deck no longer gives the word as goes with its file when the word is read
// again; what was read is removed on request (never the deck's own).
import type { DeckExtrasWord, DeckReadAudio } from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import { sha256Hex } from "../security/encoding.ts";
import type { DeckExtrasStore, DeckJobSpec, DeckNote } from "./deck-extras.ts";

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

/** The text read for a word as its card shows it: variants ("der Großvater / der Opa") as a list, a
 *  separable verb's bar left out ("her|kommen" is read "herkommen", not "her kommen"). */
export const spokenText = (target: string) =>
  target
    .replace(/\|/g, "")
    .replace(/\s*\/\s*/g, ", ")
    .trim();

/** A word's readings, one per headword: the first, then the others. */
export const readingsOf = (word: DeckExtrasWord | undefined): DeckReadAudio[] =>
  word ? [...(word.audio ? [word.audio] : []), ...(word.variants ?? [])] : [];

/** A deck's word (a lexeme: its cards in two translation languages are one word) and the texts of
 *  its headwords — `own` when every one shown so has a recording. */
type Word = { key: string; texts: Array<{ text: string; own: boolean }> };
/** A headword to read: its word's key, its text, and the texts of the word to keep readings of. */
type Step = { key: string; text: string; keep: string[] };

/** A deck's words, one per lexeme, each with its headwords' texts. */
function wordsOf(notes: DeckNote[]): Word[] {
  const words = new Map<string, Word>();
  for (const n of notes) {
    let word = words.get(n.lexeme);
    if (!word) {
      word = { key: n.lexeme, texts: [] };
      words.set(n.lexeme, word);
    }
    const text = spokenText(n.display.target);
    const own = !!n.display.audio;
    const known = word.texts.find((t) => t.text === text);
    if (known) known.own &&= own;
    else word.texts.push({ text, own });
  }
  return [...words.values()];
}

/** The texts of a word read aloud for it (those without a recording). */
const toRead = (w: Word) => w.texts.filter((t) => !t.own).map((t) => t.text);

export function createDeckAudio(deps: {
  extras: DeckExtrasStore;
  /** After a job: cards follow (their display takes the audio read). */
  onRead(): Promise<void>;
  now(): number;
}) {
  const { extras } = deps;

  /** A headword's reading while it is of that text and its file is there. */
  const readingOf = (folder: string, key: string, text: string) =>
    readingsOf(extras.book(folder).words[key]).find(
      (r) => r.text === text && extras.has(folder, r.path),
    );

  /** A word read: every headword of it to read has its reading. */
  const isRead = (folder: string, w: Word) =>
    toRead(w).every((text) => readingOf(folder, w.key, text));

  /** Reads one headword into the deck's folder (a file read before with this engine, voice and text
   *  is taken as it is); the word's readings of texts it is no longer given as go, their files too
   *  unless another word's reading is in them. */
  const readStep =
    (folder: string, reader: DeckReader): DeckJobSpec<Step>["work"] =>
    async ([step], book, dropped) => {
      const s = step as Step;
      const hash = await sha256Hex(`${reader.engine}\n${reader.voice}\n${s.text}`, 12);
      const path = `media/read-${hash}.wav`;
      if (!extras.has(folder, path)) {
        const bytes = await reader.read(s.text);
        // A folder removed meanwhile is not made again.
        if (dropped()) return { done: 0, failed: 0 };
        extras.writeMedia(folder, path, bytes);
      }
      if (dropped()) return { done: 0, failed: 0 };
      const before = readingsOf(book.words[s.key]);
      const made: DeckReadAudio = {
        path,
        engine: reader.engine,
        voice: reader.voice,
        text: s.text,
        made: deps.now(),
      };
      const kept = [
        ...before.filter((r) => r.text !== s.text && s.keep.includes(r.text)),
        made,
      ].sort((a, b) => s.keep.indexOf(a.text) - s.keep.indexOf(b.text));
      const [first, ...others] = kept;
      const entry: DeckExtrasWord = { ...book.words[s.key], audio: first };
      if (others.length) entry.variants = others;
      else delete entry.variants;
      book.words[s.key] = entry;
      const used = new Set(
        Object.values(book.words).flatMap((x) => readingsOf(x).map((r) => r.path)),
      );
      for (const gone of new Set(before.map((r) => r.path)))
        if (!used.has(gone)) extras.removeMedia(folder, gone);
      return { done: 1, failed: 0 };
    };

  return {
    /** A word's audio read aloud, `<folder>/media/<file>`, while it is of the headword as shown now
     *  (`target`) and its file is there. */
    readAudio(folder: string, key: string, target: string) {
      const audio = readingOf(folder, key, spokenText(target));
      return audio && `${folder}/${audio.path}`;
    },

    /** A deck's words (taken or not) — with audio of their own, read aloud, without (a word with a
     *  headword neither has) — the engine that would read them (none: nothing here reads their
     *  language) and the deck's job, running or the latest. */
    async state(
      scope: string,
      notes: DeckNote[],
      readerOf: (lang: string) => DeckReader | undefined,
    ) {
      const folder = await extras.folderOf(scope);
      const words = wordsOf(notes);
      const lang = notes[0]?.lang ?? "";
      const own = words.filter((w) => !toRead(w).length).length;
      const read = words.filter((w) => toRead(w).length && isRead(folder, w)).length;
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

    /** Starts reading a deck's words without audio (once: a job running goes on); `again`: what was
     *  read for them goes first, every word read anew. */
    async start(
      scope: string,
      notes: DeckNote[],
      readerOf: (lang: string) => DeckReader | undefined,
      again = false,
    ) {
      const folder = await extras.folderOf(scope);
      if (extras.going("audio", folder)) return;
      const reader = notes[0] && readerOf(notes[0].lang);
      if (!reader) throw new ServiceError("speech_unavailable", 409);
      if (again && extras.clear("audio", folder)) await deps.onRead();
      const steps = wordsOf(notes).flatMap((w) => {
        const keep = toRead(w);
        return keep
          .filter((text) => !readingOf(folder, w.key, text))
          .map((text): Step[] => [{ key: w.key, text, keep }]);
      });
      extras.start("audio", folder, {
        steps,
        atOnce: AT_ONCE[reader.engine],
        saveEvery: SAVE_EVERY,
        info: { engine: reader.engine },
        label: ([s]) => (s as Step).text,
        work: readStep(folder, reader),
        end: deps.onRead,
      });
    },

    /** Stops a deck's job: the words read so far are kept. */
    async stop(scope: string) {
      extras.stop("audio", await extras.folderOf(scope));
    },

    /** Removes the audio read for a deck's words (never its own recordings); the cards follow.
     *  Refused while its job reads. */
    async remove(scope: string) {
      if (extras.clear("audio", await extras.folderOf(scope))) await deps.onRead();
    },
  };
}
export type DeckAudio = ReturnType<typeof createDeckAudio>;
