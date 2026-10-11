// Imported decks (04, "Decks"; 05, "Locations"): an `.apkg` read into `<data-root>/decks/<id>/` —
// deck.json with the words and the audio they use in media/ — server-wide as the library; each profile
// takes one as a course's deck (cards.ts). Importing a deck again (most of its notes here, the same
// languages) updates it in place. A deck goes only while no profile has cards made from it.
import {
  ApkgError,
  type ApkgRuntime,
  lexemeOf,
  noteWords,
  readApkg,
} from "@sprachanker/anki-export";
import { DECK_FORMAT, Deck, DeckId, DeckWord, type Lang } from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import type { MediaBlob } from "../media.ts";
import { readStored } from "./run-store.ts";

/** The decks' folders (`<data-root>/decks/<id>/`). */
export interface DeckFiles {
  ids(): string[];
  /** A deck's deck.json as text; undefined when there is none. */
  read(id: string): string | undefined;
  /** Writes a deck's folder anew, whole or not at all: deck.json and its media by path. */
  write(id: string, deck: string, media: Map<string, Uint8Array>): Promise<void>;
  remove(id: string): void;
  /** A file of the deck's own (`media/<name>`); undefined when there is none. */
  media(id: string, path: string): MediaBlob | undefined;
}

/** The largest package taken. */
export const DECK_MAX_BYTES = 100 * 1024 * 1024;
/** Media files taken: audio only (a page or a picture is never served from a deck). */
const AUDIO = /\.(mp3|ogg|oga|opus|wav|m4a|aac|flac)$/i;
/** Words a preview shows. */
const PREVIEW_WORDS = 5;

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
    file: deck.source.file,
    importedAt: deck.source.importedAt,
  });

  function open(bytes: Uint8Array) {
    try {
      const apkg = readApkg(bytes, deps.apkg);
      return { apkg, words: noteWords(apkg.notes) };
    } catch (error) {
      if (error instanceof ApkgError) throw new ServiceError("not_a_deck", 422);
      throw error;
    }
  }

  /** The deck here most of whose notes a package holds, and that holds mostly them: the one it
   *  updates. */
  const updated = (notes: Array<{ key: string }>) => {
    const keys = new Set(notes.map((n) => n.key));
    return files
      .ids()
      .flatMap((id) => deckOf(id) ?? [])
      .find((d) => {
        const shared = d.words.filter((w) => keys.has(w.key)).length;
        return shared * 2 > keys.size && shared * 2 > d.words.length;
      });
  };

  /** A note's lexeme in a language; none when it has none a key can hold. */
  const lexemeIn = (note: Parameters<typeof lexemeOf>[0], lang: Lang) => {
    try {
      return lexemeOf(note, lang);
    } catch {
      return undefined;
    }
  };

  return {
    deck: deckOf,

    /** The decks here, by title. */
    list: () =>
      files
        .ids()
        .flatMap((id) => deckOf(id) ?? [])
        .map(summary)
        .sort((a, b) => a.title.localeCompare(b.title)),

    /** What a package holds before it is imported: its deck's name, how many words (with audio), the
     *  first of them, and the deck here it would update. */
    preview(bytes: Uint8Array) {
      const { apkg, words } = open(bytes);
      const updates = updated(words);
      return {
        title: apkg.deckName ?? "",
        words: words.length,
        withAudio: words.filter((w) => w.sound).length,
        first: words
          .slice(0, PREVIEW_WORDS)
          .map((w) => ({ target: w.target, translation: w.translation ?? null })),
        updates: updates
          ? {
              id: updates.id,
              title: updates.title,
              lang: updates.lang,
              translationLang: updates.translationLang,
            }
          : null,
      };
    },

    /** Imports a package as a deck of words in `lang` translated into `translationLang`: a new one, or
     *  the deck most of whose notes it holds, updated when its languages are the same. A note that
     *  makes no word (no lemma, a key too long) is left out; only audio files are taken. */
    async import(
      bytes: Uint8Array,
      request: { title: string; lang: Lang; translationLang: Lang; file: string },
    ) {
      const { apkg, words: notes } = open(bytes);
      const words: DeckWord[] = [];
      const media = new Map<string, Uint8Array>();
      const audioOf = new Map<string, string | undefined>();
      const keys = new Set<string>();
      for (const note of notes) {
        if (keys.has(note.key)) continue;
        const lexeme = lexemeIn(note, request.lang);
        if (!lexeme) continue;
        if (note.sound && AUDIO.test(note.sound) && !audioOf.has(note.sound)) {
          const found = apkg.media(note.sound);
          const path = found && mediaPath(note.sound, media);
          if (path && found) media.set(path, found);
          audioOf.set(note.sound, path);
        }
        const audio = note.sound && audioOf.get(note.sound);
        const word = DeckWord.safeParse({
          key: note.key,
          target: note.target,
          ...lexeme,
          ...(note.translation && { translation: note.translation }),
          tags: note.tags,
          ...(audio && { audio }),
        });
        if (!word.success) continue;
        keys.add(note.key);
        words.push(word.data);
      }
      if (!words.length) throw new ServiceError("deck_without_words", 422);
      const same = updated(notes);
      const id =
        same?.lang === request.lang && same.translationLang === request.translationLang
          ? same.id
          : await newId(request.title, [...keys], files.ids());
      const deck = Deck.parse({
        format: DECK_FORMAT,
        id,
        title: request.title,
        lang: request.lang,
        translationLang: request.translationLang,
        source: { file: request.file, importedAt: deps.now() },
        words,
      });
      await files.write(id, `${JSON.stringify(deck, null, 2)}\n`, media);
      read.delete(id);
      deps.onImport?.();
      return summary(deck);
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

/** A media file's path in the deck's folder: its name in letters, digits, `.`, `_` and `-`, made
 *  unique among those taken. */
function mediaPath(name: string, taken: Map<string, unknown>) {
  const safe =
    name
      .normalize("NFC")
      .replace(/[^\p{L}\p{N}._-]+/gu, "_")
      .replace(/^[.]+/, "") || "audio";
  const dot = safe.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [safe.slice(0, dot), safe.slice(dot)] : [safe, ""];
  for (let n = 1; ; n++) {
    const path = `media/${n === 1 ? safe : `${stem}-${n}${ext}`}`;
    if (!taken.has(path)) return path;
  }
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
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keys.sort().join("\n"))),
  );
  const hash = [...digest.slice(0, 3)].map((b) => b.toString(16).padStart(2, "0")).join("");
  for (let n = 1; ; n++) {
    const id = DeckId.parse(`${slug}-${hash}${n === 1 ? "" : `-${n}`}`);
    if (!taken.includes(id)) return id;
  }
}
