// Imported decks (04, "Decks"; 05, "Locations"): an `.apkg` read into `<data-root>/decks/<id>/` —
// deck.json with the words, their translations and the deck's own examples, and the audio they use in
// media/ — server-wide as the library; each profile takes one as a course's deck (cards.ts). A package
// is uploaded once: previewed (kept beside the decks), then imported by its upload's id. Importing a
// deck again (most of its notes here, the same languages) updates it in place. A deck goes only while
// no profile has cards made from it.
import {
  type Apkg,
  ApkgError,
  type ApkgRuntime,
  ApkgTooLarge,
  fieldLanguages,
  lexemeOf,
  type NoteWord,
  noteWords,
  readApkg,
} from "@sprachanker/anki-export";
import { DECK_FORMAT, Deck, DeckId, DeckWord, type Lang } from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import type { MediaBlob } from "../media.ts";
import { createOnce } from "../once.ts";
import { sha256Hex } from "../security/encoding.ts";
import { readStored } from "./run-store.ts";

/** The decks' folders (`<data-root>/decks/<id>/`) and the packages uploaded to be imported. */
export interface DeckFiles {
  ids(): string[];
  /** A deck's deck.json as text; undefined when there is none. */
  read(id: string): string | undefined;
  /** Writes a deck's folder anew, whole or not at all: its media by path, a batch at a time (each
   *  read when the one before is written), then deck.json as `deck` gives it. Media of the deck as it
   *  was that this import does not bring stay (a card of a word an update drops keeps its audio). */
  write(id: string, media: Iterable<Map<string, Uint8Array>>, deck: () => string): Promise<void>;
  remove(id: string): void;
  /** A file of the deck's own (`media/<name>`); undefined when there is none. */
  media(id: string, path: string): MediaBlob | undefined;
  /** Keeps an uploaded package — the request's body streamed to a file — until it is imported (one
   *  a day old goes); its id, or undefined past `max` bytes. */
  stage(body: ReadableStream<Uint8Array>, max: number): Promise<string | undefined>;
  /** An uploaded package's bytes; undefined when it is gone. */
  staged(upload: string): Uint8Array | undefined;
  /** Lets an uploaded package go; with `deck`, notes the deck it made (kept as an upload is). */
  unstage(upload: string, deck?: string): void;
  /** The deck an upload made; undefined when it made none (or it was long ago). */
  made(upload: string): string | undefined;
}

/** The largest package taken. */
export const DECK_MAX_BYTES = 512 * 1024 * 1024;
/** Media files taken: audio only (a page or a picture is never served from a deck). */
const AUDIO = /\.(mp3|ogg|oga|opus|wav|m4a|aac|flac)$/i;
/** Words a preview shows. */
const PREVIEW_WORDS = 5;
/** Media files read from a package at once. */
const MEDIA_BATCH = 200;

export function createDecks(deps: {
  files: DeckFiles;
  /** The runtime's SQLite and zstd, which reading a package needs. */
  apkg: ApkgRuntime;
  /** Whether any profile has cards made from the deck. */
  inUse(id: DeckId): boolean;
  /** After an import: cards follow their words (relinking). */
  onImport?(): void;
  now: () => number;
}) {
  const { files } = deps;
  const read = new Map<string, Deck | undefined>();
  const importing = createOnce<ReturnType<typeof summary>>();

  /** A deck as stored; undefined when there is none or it no longer reads (logged). */
  function deckOf(id: string): Deck | undefined {
    if (!read.has(id)) read.set(id, readStored(files.read(id) ?? null, Deck, `deck ${id}`));
    return read.get(id);
  }

  const summary = (deck: Deck) => ({
    id: deck.id,
    title: deck.title,
    lang: deck.lang,
    translationLang: deck.translationLang,
    words: deck.words.length,
    withAudio: deck.words.filter((w) => w.audio).length,
    withExamples: deck.words.filter((w) => w.examples?.length).length,
    file: deck.source.file,
    importedAt: deck.source.importedAt,
  });

  function open(upload: string): Apkg {
    const bytes = files.staged(upload);
    if (!bytes) throw new ServiceError("deck_upload_gone", 404);
    return refused(() => readApkg(bytes, deps.apkg));
  }

  /** The decks here most of whose notes a package holds, and that hold mostly them: the one of the
   *  same languages it updates (the same file imported in other language pairs is several). */
  const updatable = (notes: Array<{ guid: string }>) => {
    const keys = new Set(notes.map((n) => n.guid));
    return files
      .ids()
      .flatMap((id) => deckOf(id) ?? [])
      .filter((d) => {
        const shared = d.words.filter((w) => keys.has(w.key)).length;
        return shared * 2 > keys.size && shared * 2 > d.words.length;
      });
  };

  /** A note's lexeme in a language; none when it has none a key can hold. */
  const lexemeIn = (note: NoteWord, lang: Lang) => {
    try {
      return lexemeOf(note, lang);
    } catch {
      return undefined;
    }
  };

  /** What a preview says of a package: its deck's name, words (with audio, with examples), the
   *  languages its fields are named by, the first words with their translation in each, and the decks
   *  here it would update — each in its languages. */
  function previewOf(upload: string, apkg: Apkg) {
    const words = noteWords(apkg.notes);
    const languages = [
      ...new Set(
        [...new Set(apkg.notes.map((n) => n.fieldNames.join("\x1f")))].flatMap((names) =>
          fieldLanguages(names.split("\x1f")),
        ),
      ),
    ];
    // The notes of the first words shown, each language's translations read from them.
    const shown = new Set(words.slice(0, PREVIEW_WORDS).map((w) => w.key));
    const first = apkg.notes.filter((n) => shown.has(n.guid));
    // The words' language is the first named: each other's translations, by language.
    const translations = (languages.length > 1 ? languages.slice(1) : [""]).map((lang) => ({
      lang,
      words: lang ? noteWords(first, { lang: languages[0], translationLang: lang }) : words,
    }));
    return {
      upload,
      title: apkg.deckName ?? "",
      words: words.length,
      withAudio: words.filter((w) => w.sound).length,
      withExamples: words.filter((w) => w.examples?.length).length,
      languages,
      first: words.slice(0, PREVIEW_WORDS).map((w) => ({
        target: w.target,
        translations: Object.fromEntries(
          translations.flatMap((t) => {
            const translation = t.words.find((x) => x.key === w.key)?.translation;
            return translation ? [[t.lang, translation]] : [];
          }),
        ) as Record<string, string>,
      })),
      updates: updatable(apkg.notes).map((d) => ({
        id: d.id,
        title: d.title,
        lang: d.lang,
        translationLang: d.translationLang,
      })),
    };
  }

  return {
    deck: deckOf,

    /** The decks here, by title. */
    list: () =>
      files
        .ids()
        .flatMap((id) => deckOf(id) ?? [])
        .map(summary)
        .sort((a, b) => a.title.localeCompare(b.title)),

    /** Keeps an uploaded package and says what it holds (its upload's id imports it). */
    async preview(body: ReadableStream<Uint8Array> | null) {
      if (!body) throw new ServiceError("not_a_deck", 422);
      const upload = await files.stage(body, DECK_MAX_BYTES);
      if (!upload) throw new ServiceError("deck_too_large", 413);
      try {
        return previewOf(upload, open(upload));
      } catch (error) {
        files.unstage(upload);
        throw error;
      }
    },

    /** Imports an uploaded package as a deck of words in `lang` translated into `translationLang`: a
     *  new one, or the deck in these languages most of whose notes it holds, updated. A
     *  note that makes no word (no lemma, a key too long) is left out; only audio files are taken. */
    async import(request: {
      upload: string;
      title: string;
      lang: Lang;
      translationLang: Lang;
      file: string;
    }) {
      if (request.lang === request.translationLang)
        throw new ServiceError("deck_same_languages", 400);
      // Once per upload: asked again while it runs, the same import; after it, the deck it made (a
      // retry after a dropped connection gets the deck, not deck_upload_gone).
      return importing(request.upload, async () => {
        const made = files.made(request.upload);
        const done = made ? deckOf(made) : undefined;
        if (done) return summary(done);
        const apkg = open(request.upload);
        const notes = noteWords(apkg.notes, request);
        // Where each audio file the notes name is kept in the deck's folder; those the words use.
        const named = notes.flatMap((n) => [n.sound, ...(n.examples ?? []).map((e) => e.sound)]);
        const paths = new Map(
          await Promise.all(
            [...new Set(named)]
              .filter((s): s is string => !!s && AUDIO.test(s))
              .map(async (s) => [s, await mediaPath(s)] as const),
          ),
        );
        const used = new Set<string>();
        const pathOf = (sound: string | undefined) => {
          const path = sound && paths.get(sound);
          if (path) used.add(sound);
          return path || undefined;
        };
        const words: DeckWord[] = [];
        const keys = new Set<string>();
        for (const note of notes) {
          if (keys.has(note.key)) continue;
          const lexeme = lexemeIn(note, request.lang);
          if (!lexeme) continue;
          const audio = pathOf(note.sound);
          const examples = (note.examples ?? []).map((e) => {
            const at = pathOf(e.sound);
            return {
              sentence: e.sentence,
              ...(e.translation && { translation: e.translation }),
              ...(at && { audio: at }),
            };
          });
          const word = DeckWord.safeParse({
            key: note.key,
            target: note.target,
            ...lexeme,
            ...(note.translation && { translation: note.translation }),
            tags: note.tags,
            ...(audio && { audio }),
            ...(examples.length && { examples }),
          });
          if (!word.success) continue;
          keys.add(note.key);
          words.push(word.data);
        }
        if (!words.length) throw new ServiceError("deck_without_words", 422);
        // Paths of sounds the package does not hold are dropped from the words.
        const sounds = [...used];
        const held = new Set<string>();
        function* media() {
          for (let i = 0; i < sounds.length; i += MEDIA_BATCH) {
            const batch = apkg.media(sounds.slice(i, i + MEDIA_BATCH));
            const out = new Map<string, Uint8Array>();
            for (const [sound, bytes] of batch) {
              const path = paths.get(sound) as string;
              held.add(path);
              out.set(path, bytes);
            }
            yield out;
          }
        }
        const same = updatable(apkg.notes).find(
          (d) => d.lang === request.lang && d.translationLang === request.translationLang,
        );
        const id = same?.id ?? (await newId(request.title, [...keys], files.ids()));
        const deckOfWords = () =>
          Deck.parse({
            format: DECK_FORMAT,
            id,
            title: request.title,
            lang: request.lang,
            translationLang: request.translationLang,
            source: { file: request.file, importedAt: deps.now() },
            words: words.map((w) => withHeld(w, held)),
          });
        let deck: Deck | undefined;
        // deck.json last, once the files its words name are known to be there.
        await refused(() =>
          files.write(id, media(), () => {
            deck = deckOfWords();
            return `${JSON.stringify(deck, null, 2)}\n`;
          }),
        );
        files.unstage(request.upload, id);
        read.delete(id);
        deps.onImport?.();
        return summary(deck as Deck);
      });
    },

    /** Deletes a deck with its files; refused while a profile has its cards (they leave it first). */
    remove(id: DeckId) {
      if (!deckOf(id)) throw new ServiceError("no_such_deck", 404);
      if (deps.inUse(id)) throw new ServiceError("deck_in_use", 409);
      files.remove(id);
      read.delete(id);
    },

    /** A file of a deck's own media. */
    media: (id: string, path: string) =>
      DeckId.safeParse(id).success ? files.media(id, path) : undefined,
  };
}
export type Decks = ReturnType<typeof createDecks>;

/** What reading a package throws, as the service refuses it. */
function refused<T>(read: () => T): T {
  const refuse = (error: unknown) => {
    if (error instanceof ApkgTooLarge) throw new ServiceError("deck_unpacked_too_large", 422);
    if (error instanceof ApkgError) throw new ServiceError("not_a_deck", 422);
    throw error;
  };
  try {
    const out = read();
    return out instanceof Promise ? (out.catch(refuse) as T) : out;
  } catch (error) {
    return refuse(error);
  }
}

/** A word with only the media the package held. */
function withHeld(word: DeckWord, held: Set<string>): DeckWord {
  const { audio, examples, ...rest } = word;
  return {
    ...rest,
    ...(audio && held.has(audio) && { audio }),
    ...(examples && {
      examples: examples.map(({ audio: a, ...e }) => ({
        ...e,
        ...(a && held.has(a) && { audio: a }),
      })),
    }),
  };
}

/** A media file's path in the deck's folder, the same for its name in every import: the name in
 *  lowercase letters and digits, and a hash of the name as the package gives it — so names that differ
 *  only in case (one file on a case-insensitive disk) or in what the slug drops never share a path. */
async function mediaPath(name: string) {
  const dot = name.lastIndexOf(".");
  const slug = (text: string) =>
    text
      .normalize("NFC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  const stem = slug(dot > 0 ? name.slice(0, dot) : name) || "audio";
  const ext = dot > 0 ? `.${slug(name.slice(dot + 1))}` : "";
  return `media/${stem}-${await sha256Hex(name, 12)}${ext}`;
}

/** A new deck's id: its title's slug and a short hash of its notes (`deutsch-a1-3f9c2a`). */
async function newId(title: string, keys: string[], taken: string[]) {
  const slug =
    title
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "deck";
  const hash = await sha256Hex(keys.sort().join("\n"), 6);
  for (let n = 1; ; n++) {
    const id = DeckId.parse(`${slug}-${hash}${n === 1 ? "" : `-${n}`}`);
    if (!taken.includes(id)) return id;
  }
}
