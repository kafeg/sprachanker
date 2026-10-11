// AI examples for a word (04, "Spaced repetition"; 07): on request, the model writes an example
// sentence for a card's word with the words of the course up to the word's lesson (an imported deck's
// word: none). Each is an `llm_verdict` (`task: example`) on the card in the day's review run (05),
// never shown by itself: the card's examples come back only when asked for again. Which words of a
// sentence are new is worked out when read, against the course as installed now (the engine's
// `markWords`).
import { markWords, usesWord, type VocabWord } from "@sprachanker/engine";
import { structuredRequest, type WordExampleInput, wordExampleTask } from "@sprachanker/llm";
import type { LessonKey, WordExample } from "@sprachanker/schema";
import type { CardStore } from "./card-store.ts";
import { createInFlight } from "./in-flight.ts";
import type { LessonContexts } from "./lesson-context.ts";
import type { Llm, PromptPreview } from "./llm.ts";
import type { RunStore } from "./run-store.ts";
import { keepVerdict, verdicts } from "./verdicts.ts";

export interface ExampleRequest {
  cardId: string;
  /** The learner's language, the translation's. */
  language: string;
}

/** How many earlier sentences of the word the model is told to differ from. */
const EARLIER = 5;

export function createExamples(deps: {
  cards: CardStore;
  lessonContext: LessonContexts;
  llm: Llm;
  store: RunStore;
  /** The day's review run (the study service's). */
  reviewRun: () => string;
}) {
  const { store } = deps;
  const making = createInFlight<true>("example_busy");

  /** The card's word and the course's words around it, in the card's language pair. */
  async function context(cardId: string) {
    const note = deps.cards.note(cardId);
    const { display } = note;
    const edition = `${note.translationLang}-${note.lang}`;
    // An imported deck's word has no course around it.
    const none: { upTo: VocabWord[]; later: VocabWord[] } = { upTo: [], later: [] };
    const vocabulary =
      "lessonKey" in display
        ? await deps.lessonContext
            .vocabulary(display.series, display.lessonKey as LessonKey, edition)
            .catch(() => none)
        : none;
    const word: VocabWord = {
      target: display.target,
      plural: display.plural,
      translation: display.translation,
    };
    return { note, word, vocabulary };
  }

  const stored = (cardId: string) => verdicts(store, "example", { cardId });

  /** A sentence as shown: its words, the new ones marked with a translation where one is known. */
  const shown = (
    v: { ts: number; model: string; result: WordExample },
    { word, vocabulary }: Awaited<ReturnType<typeof context>>,
  ) => ({
    ts: v.ts,
    model: v.model,
    sentence: v.result.sentence,
    translation: v.result.translation,
    words: markWords(
      v.result.sentence,
      [...vocabulary.upTo, word],
      [
        ...vocabulary.later,
        ...v.result.glossary.map((g) => ({ target: g.word, translation: g.translation })),
      ],
    ),
  });

  async function input(request: ExampleRequest, ctx: Awaited<ReturnType<typeof context>>) {
    return {
      language: request.language,
      target: ctx.note.lang,
      rules: deps.llm.rulesFor("example", request.language, ctx.note.lang),
      word: { target: ctx.word.target, translation: ctx.word.translation },
      known: ctx.vocabulary.upTo.map((v) => v.target),
      earlier: stored(request.cardId)
        .slice(0, EARLIER)
        .map((v) => v.result.sentence),
    } satisfies WordExampleInput;
  }

  return {
    /** The card's examples, newest first. */
    async list(cardId: string) {
      const ctx = await context(cardId);
      return stored(cardId).map((v) => shown(v, ctx));
    },

    /** A new example from the configured model, kept with the card. */
    make(request: ExampleRequest) {
      return making.run(request.cardId, true, async () => {
        const ctx = await context(request.cardId);
        const task = wordExampleTask(await input(request, ctx), (s) => usesWord(s, ctx.word));
        const { result, model, latencyMs } = await deps.llm.structured(task);
        const { verdict } = keepVerdict(
          store,
          deps.reviewRun(),
          { task: "example", input: ctx.word.target, result, model, latencyMs },
          { cardId: request.cardId },
        );
        return shown(verdict, ctx);
      });
    },

    async prompt(request: ExampleRequest): Promise<PromptPreview> {
      const ctx = await context(request.cardId);
      return deps.llm.preview(structuredRequest(wordExampleTask(await input(request, ctx))));
    },
  };
}
export type Examples = ReturnType<typeof createExamples>;
