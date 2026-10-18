// A deck as an Anki package (.apkg, owner 2026-10-19), to study it in Anki or AnkiDroid: any deck the
// profile sees — a course's words in one of its editions, an imported deck, its Finds —, a note per
// word as its card shows it there (the word, its translation, its examples — its own, then the AI's
// unless the learner turned those off —) with what SprachAnker plays for it (its recording, else its
// reading for the deck); a word without audio goes without. New cards only: the learner's progress
// is not in it. The same deck exported again updates the same notes (their guids are the deck's and
// the word's). Made ready as the deck file is — its audio linked aside, the collection in memory —,
// then downloaded once.
import { type ApkgRuntime, ankiId, noteGuid, writeApkg } from "@sprachanker/anki-export";
import {
  DECK_AUDIO_EXTENSIONS,
  DECK_BUNDLE_MAX_BYTES,
  type DeckMadeExamples,
  isFindsDeck,
} from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import { sha256Hex } from "../security/encoding.ts";
import type { DeckNote } from "./deck-extras.ts";
import type { DeckTransferFiles, ZipHead } from "./deck-transfer.ts";
import { guarded, preparedExports } from "./transfers.ts";

export const APKG_EXTENSION = ".apkg";

type Source = { root: "decks" | "library"; path: string };

/** Where a word's audio is under the data root: its recording — in its deck's folder, or in its
 *  course's library —, else its reading for the deck (`<folder>/media/<file>`). */
function audioOf(note: DeckNote, read: string | undefined): Source | undefined {
  const { display } = note;
  if (display.audio)
    return "deck" in display
      ? { root: "decks", path: `${display.deck}/${display.audio}` }
      : { root: "library", path: `${display.series}/${display.audio}` };
  return read ? { root: "decks", path: read } : undefined;
}

const extensionOf = (path: string) => {
  const dot = path.lastIndexOf(".");
  const ext = dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
  return DECK_AUDIO_EXTENSIONS.includes(ext) ? ext : undefined;
};

export function createDeckApkg(deps: {
  files: Pick<DeckTransferFiles, "stageNumbered" | "bytes" | "stream" | "discard">;
  apkg: Pick<ApkgRuntime, "newSqlite">;
  /** A deck's folder (`course:<key>`, `deck:<id>`); 404 when it is not here. */
  folderOf(scope: string): Promise<string>;
  /** A word's reading for its deck while it is of the headword shown (deck-audio.ts). */
  readAudio(folder: string, lexeme: string, target: string): string | undefined;
  /** The examples the AI made for a word of a deck, in a language. */
  examplesOf(folder: string, lexeme: string, lang: string): DeckMadeExamples | undefined;
  now(): number;
}) {
  const { files } = deps;
  /** Packages made ready, each the profile's that asked, until downloaded (an hour). */
  const exports = preparedExports<{
    head: ZipHead[];
    paths: string[];
    fileName: string;
    bytes: number;
  }>(files.discard, "deck_export_gone");

  /** What a profile exports: the decks it sees (`notes`: their words, taken or not, 404 for one it
   *  does not), the AI's examples with them unless it turned those off. */
  function of(
    profile: string,
    own: {
      notes(scope: string, edition?: string): Promise<DeckNote[]>;
      aiExamples(): boolean;
    },
  ) {
    return {
      /** A deck made ready as an .apkg — named in Anki as the app names it (`title`) —: its name and
       *  size; one not downloaded within an hour goes. */
      async prepare(scope: string, title: string, edition?: string) {
        const all = await own.notes(scope, edition);
        const folder = await deps.folderOf(scope);
        // A word once: where it is first met (a course gives it as several headwords).
        const seen = new Set<string>();
        const words = all.filter((n) => !seen.has(n.lexeme) && seen.add(n.lexeme));
        if (!words.length) throw new ServiceError("no_such_deck", 404);
        const lang = words[0]?.translationLang ?? "";
        const sources = words.map((n) => {
          const source = audioOf(n, deps.readAudio(folder, n.lexeme, n.display.target));
          return source && extensionOf(source.path) ? source : undefined;
        });
        const wanted = [...new Map(sources.flatMap((s) => (s ? [[s.path, s]] : []))).values()];
        const staged = await guarded(() => files.stageNumbered(wanted));
        try {
          // Each file by a name of its own in Anki's media folder, the same in every export.
          const names = new Map<string, string>();
          for (const at of staged.staged) {
            const s = wanted[at] as Source;
            const hash = await sha256Hex(`${s.root}/${s.path}`, 16);
            names.set(s.path, `sprachanker-${hash}.${extensionOf(s.path)}`);
          }
          const ai = own.aiExamples();
          const seed = `${folder} ${lang}`;
          const written = writeApkg(
            {
              name: title,
              deckId: ankiId(seed),
              now: deps.now(),
              media: [...names.values()],
              notes: words.map((n, i) => {
                const { display } = n;
                const made = ai ? deps.examplesOf(folder, n.lexeme, lang)?.items : undefined;
                const audio = sources[i] && names.get((sources[i] as Source).path);
                const examples = [
                  ...(display.example ? [{ sentence: display.example }] : []),
                  ...(display.examples ?? []),
                  ...(made ?? []),
                ].map((e) => ({ sentence: e.sentence, translation: e.translation }));
                return {
                  guid: noteGuid(`${seed} ${n.key ?? n.lexeme}`),
                  front: display.target,
                  ...(display.plural && { plural: display.plural }),
                  back: display.translation ?? "",
                  ...(audio && { audio }),
                  ...(examples.length && { examples }),
                };
              }),
            },
            deps.apkg,
          );
          const paths = staged.staged.map((_, n) => String(n));
          const bytes = files.bytes(staged.id, written.head, paths);
          if (bytes > DECK_BUNDLE_MAX_BYTES) throw new ServiceError("deck_file_too_large", 422);
          const day = new Date(deps.now()).toISOString().slice(0, 10);
          // As the deck file names it (a Finds deck by its pair, not its profile); a course's by its
          // edition's language too.
          const name = isFindsDeck(folder)
            ? `finds-${lang}-${words[0]?.lang}`
            : folder.replace(/^course~/, "").replaceAll("~", "-");
          const pair = scope.startsWith("course:") ? `-${lang}` : "";
          const fileName = `${name}${pair}-${day}${APKG_EXTENSION}`;
          exports.keep(staged.id, profile, { head: written.head, paths, fileName, bytes });
          const withAudio = sources.filter((s) => s && names.has(s.path)).length;
          return { id: staged.id, fileName, bytes, notes: words.length, withAudio };
        } catch (error) {
          files.discard(staged.id);
          throw error;
        }
      },

      /** A package made ready still there to download: its name and size (404 when gone). */
      ready(id: string) {
        const { fileName, bytes } = exports.ready(profile, id);
        return { fileName, bytes };
      },

      /** A package made ready as a stream, once (404 as `ready`). */
      download(id: string) {
        const p = exports.take(profile, id);
        return { stream: files.stream(id, p.head, p.paths), fileName: p.fileName, bytes: p.bytes };
      },
    };
  }
  return { of };
}
export type DeckApkg = ReturnType<typeof createDeckApkg>;
export type ProfileDeckApkg = ReturnType<DeckApkg["of"]>;
