// Words selected anywhere in the app, translated and kept (owner, 2026-10-15): the profile's model
// tells which language they are in and gives the words in the language learnt as a card's front with
// their translation; they are added to the profile's own deck "Finds" (a deck folder like an imported
// one: decks.ts), then made a card as a deck's word is (cards.ts `takeDeck`) — and shown at once; their
// audio is read after, on its own request, by the engine that reads the profile's decks (the voice for
// words where it is there). A word the learner has a card of already is not added again.
import { lexemeOf } from "@sprachanker/anki-export";
import { type SelectionTranslation, translateSelectionTask } from "@sprachanker/llm";
import { type DeckId, type DeckWord, findsDeckId, Lang } from "@sprachanker/schema";
import { ulid } from "ulid";
import { ServiceError } from "../errors.ts";
import { sha256Hex } from "../security/encoding.ts";
import { type DeckReader, spokenText } from "./deck-audio.ts";
import type { Decks } from "./decks.ts";
import type { Llm } from "./llm.ts";

/** The deck's name as stored; the app shows it in the learner's language. */
const FINDS_TITLE = "Finds";
/** A part of speech the model names, as a deck names it (none: the headword's shape decides). */
const POS: Partial<Record<SelectionTranslation["pos"], string>> = {
  noun: "noun",
  verb: "verb",
  adjective: "adjective",
};

/** The sentence of a text the words are in (a paragraph's); none when no sentence holds them (the
 *  words across two, or past the part of the text sent). */
export const sentenceOf = (context: string, words: string) =>
  context
    .split(/(?<=[.!?…])\s+/u)
    .find((sentence) => sentence.includes(words))
    ?.trim() || undefined;

/** A language pair the learner studies: the words' language and their translations'. */
type Pair = { lang: Lang; translationLang: Lang };

export function createFinds(deps: {
  profile: string;
  llm: Llm;
  decks: Pick<Decks, "addOwn" | "deck" | "ownAudio">;
  /** The learner's cards: their language pairs (the languages studied). */
  notes(): Pair[];
  /** The language pairs of the courses the learner has started (studied before any card). */
  started(): Promise<Pair[]>;
  /** The interface's language, when chosen: of a course's pairs, the one studied through it first. */
  uiLanguage(): Lang | undefined;
  /** Whether the learner has a card of a lexeme in a translation language. */
  hasCard(lexeme: string, translationLang: string): boolean;
  /** Makes cards of a deck's words given by key, those not cards yet (cards.ts). */
  take(deck: DeckId, keys: string[]): Promise<unknown>;
  /** The engine on this computer that reads a deck's words in a language (profile-speech.ts). */
  reader(lang: string): DeckReader | undefined;
  /** Starts the engine that reads words in a language ahead of reading one. */
  warm?(lang: string): void;
}) {
  /** The pairs the learner studies, the most cards first. */
  function studied(): Pair[] {
    const counts = new Map<string, { pair: Pair; n: number }>();
    for (const { lang, translationLang } of deps.notes()) {
      if (!lang) continue;
      const key = `${translationLang}-${lang}`;
      const known = counts.get(key);
      if (known) known.n++;
      else counts.set(key, { pair: { lang, translationLang }, n: 1 });
    }
    return [...counts.values()].sort((a, b) => b.n - a.n).map((c) => c.pair);
  }

  /** Which pair words marked `hint` are of: a language studied — by cards, the pair studied most
   *  first, then by the courses started — as the words learnt, else as the language the learner
   *  studies through; no hint: the pair studied most. A hint of a language not studied either way (a
   *  third language on the page) is refused: no pair is made up for it. */
  async function pairOf(hint: Lang | undefined): Promise<Pair> {
    const ui = deps.uiLanguage();
    const started = (await deps.started()).sort(
      (a, b) => Number(b.translationLang === ui) - Number(a.translationLang === ui),
    );
    const pairs = [...studied(), ...started];
    const found = hint
      ? (pairs.find((p) => p.lang === hint) ?? pairs.find((p) => p.translationLang === hint))
      : pairs[0];
    if (!found) throw new ServiceError("find_no_language", 409);
    return found;
  }

  /** The words read aloud for the deck; none when nothing here reads the language or it fails. */
  async function audioOf(reader: DeckReader, target: string) {
    const text = spokenText(target);
    try {
      const bytes = await reader.read(text);
      const hash = await sha256Hex(`${reader.engine}\n${reader.voice}\n${text}`, 12);
      return { path: `media/find-${hash}.wav`, bytes };
    } catch (error) {
      console.error(`reading "${text}" aloud for Finds:`, error);
      return undefined;
    }
  }

  return {
    /**
     * Words selected — `lang` the language the page marks them with, `context` the sentence around
     * them — translated by the profile's model and kept: the words in the language learnt with their
     * translation, which of the two languages was selected, their audio's path (`/decks/…`) when
     * Finds has it, the word in Finds whose audio is still to be read (`audio`, next) and whether they
     * were added (false: a card of the word was there already).
     */
    async add(request: { text: string; context?: string; lang?: string }) {
      if (!deps.llm.state().model) throw new ServiceError("llm_not_configured", 409);
      const hint = Lang.safeParse(request.lang?.split("-")[0]?.toLowerCase());
      const pair = await pairOf(hint.success ? hint.data : undefined);
      // Its audio is read next: the engine loads while the model answers.
      deps.warm?.(pair.lang);
      const { result } = await deps.llm.structured(
        translateSelectionTask({
          language: pair.translationLang,
          target: pair.lang,
          text: request.text,
          ...(request.context && { context: request.context }),
          ...(hint.success && { hint: hint.data }),
        }),
      );
      const found = (() => {
        try {
          return lexemeOf(
            { target: result.target, pos: POS[result.pos], plural: result.plural || undefined },
            pair.lang,
          );
        } catch {
          return undefined;
        }
      })();
      if (!found) throw new ServiceError("llm_invalid_output", 502);
      const shown = {
        target: result.target,
        translation: result.translation,
        from: result.from,
        lang: pair.lang,
      };
      if (deps.hasCard(found.lexeme, pair.translationLang))
        return { ...shown, audio: null, word: null, added: false };
      const id = findsDeckId(deps.profile, pair.lang, pair.translationLang);
      const example =
        result.from === "target" && request.context
          ? sentenceOf(request.context, request.text)
          : undefined;
      const word: DeckWord = {
        key: ulid().toLowerCase(),
        target: result.target,
        ...found,
        translation: result.translation,
        tags: ["find"],
        // The sentence the words were met in, where it is in the language learnt.
        ...(example && { examples: [{ sentence: example }] }),
      };
      const deck = await deps.decks.addOwn({
        id,
        owner: deps.profile,
        title: FINDS_TITLE,
        ...pair,
        word,
      });
      // The word as the deck keeps it (one there before, of a card left since, keeps its own): its
      // card alone made — not those of words whose cards the learner left with the deck.
      const kept = deck.words.find((w) => w.lexeme === found.lexeme);
      const key = kept?.key ?? word.key;
      await deps.take(id, [key]);
      // In Finds already (its card left since): its audio there, none read again.
      return {
        ...shown,
        audio: kept?.audio ? `/decks/${id}/${kept.audio}` : null,
        word: !kept?.audio && deps.reader(pair.lang) ? { deck: id, key } : null,
        added: true,
      };
    },

    /** A word of the profile's Finds read aloud and kept with it (once: one with audio keeps it); its
     *  audio's path (`/decks/…`), none when nothing here reads its language or reading fails. */
    async audio(request: { deck: DeckId; key: string }) {
      const deck = deps.decks.deck(request.deck);
      const word = deck?.owner === deps.profile && deck.words.find((w) => w.key === request.key);
      if (!deck || !word) throw new ServiceError("no_such_deck", 404);
      const url = (path: string) => `/decks/${deck.id}/${path}`;
      if (word.audio) return { audio: url(word.audio) };
      const reader = deps.reader(deck.lang);
      const audio = reader && (await audioOf(reader, word.target));
      if (!audio) return { audio: null };
      const kept = await deps.decks.ownAudio({
        id: deck.id,
        owner: deps.profile,
        key: word.key,
        audio,
      });
      return { audio: kept?.audio ? url(kept.audio) : null };
    },
  };
}
export type Finds = ReturnType<typeof createFinds>;
