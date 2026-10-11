// AI examples of a profile's words (04, "A deck's words given examples"; 07, `word_examples`): a
// deck's job (deck-examples.ts, the server's) started with this profile's model — the words of its
// cards in the deck, what they can be assumed to know (a course's words up to their lesson, an imported
// deck's up to them), the level when the course or deck names one, the learner's own prompt —; the
// request it would send; and a card's examples as shown, the words not met yet marked and translated
// (the engine's `markWords`, against the course as installed now, or the deck).
import { markWords, type VocabWord } from "@sprachanker/engine";
import { structuredRequest, type WordExamplesInput, wordExamplesTask } from "@sprachanker/llm";
import {
  type LessonKey,
  type LexemeKey,
  parseLessonKey,
  parseLexemeKey,
} from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import type { CardStore } from "./card-store.ts";
import type { DeckExamples, ExampleWriter } from "./deck-examples.ts";
import type { DeckExtrasStore, DeckNote } from "./deck-extras.ts";
import type { Decks } from "./decks.ts";
import type { LessonContexts } from "./lesson-context.ts";
import type { Llm, PromptPreview } from "./llm.ts";

/** A CEFR level a course's or deck's name says ("a1-ru", "Deutsch A2", "слова_b1"). */
export const levelIn = (name: string) =>
  /(?:^|[^a-z0-9])([abc][12])(?![0-9])/i.exec(name)?.[1]?.toUpperCase();

/** A headword of one word, with its article or "sich" ("der Abend, die Abende", "sich freuen"), not a
 *  phrase ("Ich muss nach Berlin"). */
const oneWord = (v: VocabWord) =>
  v.target
    .replace(/\([^)]*\)/g, " ")
    .split(",")[0]
    ?.trim()
    .split(/\s+/)
    .filter((t) => !/^(der|die|das|sich|the|a|an|to)$/i.test(t)).length === 1;

const NO_WORDS = { upTo: [] as VocabWord[], later: [] as VocabWord[] };

export function createExamples(deps: {
  cards: Pick<CardStore, "note">;
  /** The learner's cards made in a deck (cards.ts). */
  deckNotes(scope: string): DeckNote[];
  decks: Pick<Decks, "deck">;
  extras: Pick<DeckExtrasStore, "folderOf">;
  deckExamples: DeckExamples;
  lessonContext: LessonContexts;
  llm: Llm;
}) {
  const { llm } = deps;

  /** The words before and after a card's word in its deck (with it among those before): a course's by
   *  lesson in the card's edition, an imported deck's by their order. */
  async function around(note: DeckNote): Promise<typeof NO_WORDS> {
    const { display } = note;
    if ("lessonKey" in display)
      return deps.lessonContext
        .vocabulary(
          display.series,
          display.lessonKey as LessonKey,
          `${note.translationLang}-${note.lang}`,
        )
        .catch(() => NO_WORDS);
    const words = deps.decks.deck(display.deck)?.words ?? [];
    const at = words.findIndex((w) => w.lexeme === note.lexeme);
    const vocab = words.map((w) => ({
      target: w.target,
      plural: w.plural,
      translation: w.translation,
    }));
    return { upTo: vocab.slice(0, at + 1), later: vocab.slice(at + 1) };
  }

  /** What the model is given for a few words of one translation language. */
  async function inputOf(notes: DeckNote[]): Promise<WordExamplesInput> {
    const first = notes[0] as DeckNote;
    // What the last of them can assume: the longest of the words known before each.
    let known: VocabWord[] = [];
    for (const n of notes) {
      const { upTo } = await around(n);
      if (upTo.length > known.length) known = upTo;
    }
    const { display } = first;
    const name =
      "lessonKey" in display
        ? parseLessonKey(display.lessonKey).courseId
        : (deps.decks.deck(display.deck)?.title ?? "");
    const level = levelIn(name);
    return {
      language: first.translationLang,
      target: first.lang,
      rules: llm.rulesFor("examples", first.translationLang, first.lang),
      ...(level && { level }),
      words: notes.map((n) => ({
        target: n.display.target,
        translation: n.display.translation,
        pos: parseLexemeKey(n.lexeme as LexemeKey).pos,
        gender: n.display.gender,
      })),
      known: known.map((v) => v.target),
    };
  }

  const write: ExampleWriter = async (notes) => {
    const input = await inputOf(notes);
    const { result, model } = await llm.structured(wordExamplesTask(input));
    return { result, model, known: input.known.map((target) => ({ target })) };
  };

  return {
    /** A deck's words given examples: their counts and the deck's job. */
    state: (scope: string) => deps.deckExamples.state(scope, deps.deckNotes(scope)),

    /** Starts the deck's job with this profile's model; refused while it has none. */
    async start(scope: string) {
      if (!llm.state().model) throw new ServiceError("llm_not_configured", 409);
      await deps.deckExamples.start(scope, deps.deckNotes(scope), write);
      return deps.deckExamples.state(scope, deps.deckNotes(scope));
    },

    async stop(scope: string) {
      await deps.deckExamples.stop(scope);
      return deps.deckExamples.state(scope, deps.deckNotes(scope));
    },

    /** The request the job's next call would send. */
    async prompt(scope: string): Promise<PromptPreview> {
      const next = await deps.deckExamples.next(scope, deps.deckNotes(scope));
      if (!next.length) throw new ServiceError("no_such_deck", 404);
      return llm.preview(structuredRequest(wordExamplesTask(await inputOf(next))));
    },

    /** A card's examples as shown — each sentence in pieces, the words not met yet marked and
     *  translated (the deck's later words, the model's glossary) —, whether its word brings its own,
     *  and its deck (where examples are made). */
    async ofCard(cardId: string) {
      const n = deps.cards.note(cardId);
      const note: DeckNote = { ...n, lexeme: n.lexemeKey ?? "" };
      const own = !!note.display.examples?.length || !!note.display.example;
      const folder = await deps.extras.folderOf(n.deck).catch(() => undefined);
      const made =
        folder && note.lexeme
          ? deps.deckExamples.examplesOf(folder, note.lexeme, note.translationLang)
          : undefined;
      if (!made) return { scope: n.deck, own, model: null, examples: [] };
      const { upTo, later } = await around(note);
      const word = (form?: string): VocabWord => ({
        target: note.display.target,
        plural: note.display.plural,
        forms: form,
      });
      // A later word translates a word of a sentence only when it is one word itself: a phrase's
      // translation is not that of each of its words.
      const laterWords = later.filter(oneWord);
      return {
        scope: n.deck,
        own,
        model: made.model,
        examples: made.items.map((e) => ({
          sentence: e.sentence,
          translation: e.translation,
          // The model's glossary first: it translates the word as this sentence uses it.
          words: markWords(
            e.sentence,
            [...upTo, word(e.form)],
            [
              ...(e.glossary ?? []).map((g) => ({ target: g.word, translation: g.translation })),
              ...laterWords,
            ],
          ),
        })),
      };
    },
  };
}
export type Examples = ReturnType<typeof createExamples>;
