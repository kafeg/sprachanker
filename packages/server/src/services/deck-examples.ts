// Examples for a deck's words: the words of
// a deck in a language pair, taken or not — an imported deck's notes, a course's words in an edition —
// that bring no example of their own get three to five sentences from a model, five words a call, kept in the deck's folder by
// lexeme and the language they are translated into (deck-extras.ts), so every profile's cards show
// them. A sentence that does not use its word is dropped; the words left without any are asked for
// once more, together in one call. Server-wide, one job per deck and language pair; the model is the
// profile's that starts it.
import { hasForm, usesWord, type VocabWord } from "@sprachanker/engine";
import type { DeckMadeExamples, WordExamples } from "@sprachanker/schema";
import { type DeckExtrasStore, type DeckJobSpec, type DeckNote, failureOf } from "./deck-extras.ts";

/** What writes examples for a few words of one translation language: the profile's model
 *  (examples.ts), with the context of the deck — the words it gave as known, too. */
export type ExampleWriter = (
  words: DeckNote[],
) => Promise<{ result: WordExamples; model: string; known: VocabWord[] }>;

/** Words a call. */
export const EXAMPLES_BATCH = 5;
/** Examples kept a word. */
const KEPT = 5;

/** A card's word brings examples of its own (an imported deck's sentences, a course's). */
const ownExamples = (n: DeckNote) => !!n.display.examples?.length || !!n.display.example;

/** A deck's words, one per lexeme and translation language (a card each). */
function wordsOf(notes: DeckNote[]) {
  const seen = new Set<string>();
  return notes.filter((n) => {
    const key = `${n.lexeme} ${n.translationLang}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The translation languages of a deck's words (an edition's one). */
const languagesOf = (notes: DeckNote[]) => new Set(notes.map((n) => n.translationLang));
/** The translation language of a deck's words in an edition: its job's (one per language pair). */
const langOf = (notes: DeckNote[]) => notes[0]?.translationLang;

export function createDeckExamples(deps: { extras: DeckExtrasStore; now(): number }) {
  const { extras } = deps;

  /** A word's examples translated into `lang`. */
  const examplesOf = (folder: string, lexeme: string, lang: string): DeckMadeExamples | undefined =>
    extras.book(folder).words[lexeme]?.examples?.[lang];

  /** The words still without examples, a call's worth at a time, each call of one language. */
  function batches(folder: string, notes: DeckNote[]) {
    const todo = wordsOf(notes).filter(
      (n) => !ownExamples(n) && !examplesOf(folder, n.lexeme, n.translationLang),
    );
    const out: DeckNote[][] = [];
    for (const lang of new Set(todo.map((n) => n.translationLang))) {
      const inLang = todo.filter((n) => n.translationLang === lang);
      for (let i = 0; i < inLang.length; i += EXAMPLES_BATCH)
        out.push(inLang.slice(i, i + EXAMPLES_BATCH));
    }
    return out;
  }

  /** Writes examples for a few words into the book: those using their word, a word without any
   *  asked for once more. */
  const writeWords =
    (write: ExampleWriter): DeckJobSpec<DeckNote>["work"] =>
    async (step, book, dropped) => {
      const made = new Map<DeckNote, WordExamples["words"][number]["examples"]>();
      let model = "";
      let error: string | undefined;
      let asked = step;
      for (let round = 0; round < 2 && asked.length; round++) {
        let reply: Awaited<ReturnType<ExampleWriter>>;
        try {
          reply = await write(asked);
        } catch (failure) {
          // The first call failing is the step failing; a second, only its words.
          if (round === 0) throw failure;
          error = failureOf(failure);
          break;
        }
        model = reply.model;
        for (const w of reply.result.words) {
          const note = asked[w.n - 1];
          if (!note || made.has(note)) continue;
          // The word found by its forms, or by the form the model says it used — of this word, not
          // of another asked or known.
          const others = [...step.filter((n) => n !== note).map((n) => n.display), ...reply.known];
          const good = w.examples.filter(
            (e) =>
              usesWord(e.sentence, note.display) ||
              hasForm(e.sentence, e.form, note.display, others),
          );
          if (good.length) made.set(note, good.slice(0, KEPT));
        }
        asked = asked.filter((n) => !made.has(n));
      }
      if (dropped()) return { done: 0, failed: 0 };
      for (const [note, examples] of made) {
        const entry = book.words[note.lexeme];
        book.words[note.lexeme] = {
          ...entry,
          examples: {
            ...entry?.examples,
            [note.translationLang]: {
              items: examples.map(({ sentence, translation, glossary, form }) => ({
                sentence,
                translation,
                ...(glossary.length && { glossary }),
                form,
              })),
              model,
              made: deps.now(),
            },
          },
        };
      }
      const failed = step.length - made.size;
      return {
        done: made.size,
        failed,
        ...(failed && { error: error ?? "examples_without_word" }),
      };
    };

  return {
    examplesOf,

    /** A deck's words (taken or not) — with examples of their own, given examples,
     *  without — and the deck's job, running or the latest. */
    async state(scope: string, notes: DeckNote[]) {
      const folder = await extras.folderOf(scope);
      const words = wordsOf(notes);
      const own = words.filter(ownExamples).length;
      const made = words.filter(
        (n) => !ownExamples(n) && examplesOf(folder, n.lexeme, n.translationLang),
      ).length;
      return {
        words: words.length,
        own,
        made,
        missing: words.length - own - made,
        job: extras.job("examples", folder, langOf(notes)),
      };
    },

    /** The words the next call would ask for (the prompt viewer): those first without examples, else
     *  the deck's first. */
    async next(scope: string, notes: DeckNote[]) {
      const folder = await extras.folderOf(scope);
      return batches(folder, notes)[0] ?? wordsOf(notes).slice(0, EXAMPLES_BATCH);
    },

    /** Starts giving a deck's words without examples theirs (once: a job running goes on); `again`:
     *  the examples made for them in their translation language go first, every word asked anew. */
    async start(scope: string, notes: DeckNote[], write: ExampleWriter, again = false) {
      const folder = await extras.folderOf(scope);
      if (extras.going("examples", folder, langOf(notes))) return;
      if (again) for (const lang of languagesOf(notes)) extras.clear("examples", folder, lang);
      extras.start(
        "examples",
        folder,
        {
          steps: batches(folder, notes),
          atOnce: 1,
          // A paid call's work is kept as soon as it is made: a server stopped loses at most a call.
          saveEvery: 1,
          label: (step) => step.map((n) => n.display.target).join(", "),
          work: writeWords(write),
        },
        langOf(notes),
      );
    },

    /** Stops a deck's job in its words' translation language: the examples written so far are kept. */
    async stop(scope: string, notes: DeckNote[]) {
      extras.stop("examples", await extras.folderOf(scope), langOf(notes));
    },

    /** Removes the examples made for a deck's words in their translation language (never the deck's
     *  own sentences). Refused while its job writes. */
    async remove(scope: string, notes: DeckNote[]) {
      const folder = await extras.folderOf(scope);
      for (const lang of languagesOf(notes)) extras.clear("examples", folder, lang);
    },
  };
}
export type DeckExamples = ReturnType<typeof createDeckExamples>;
