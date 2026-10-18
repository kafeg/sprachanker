// What each language writes in more than one way and says one way — data by language code, read by
// the code that compares words (a word as heard: diff.ts; a misspelling: going-over.ts) and by the
// case rule of typed answers (normalise.ts). A language with no entry has none of them; no code path
// names a language.
import { NUMBER_WORDS } from "./numbers.ts";

export interface LanguageForms {
  /** A number of 0–9999 in digits as said, its words joined (numbers.ts). */
  number?: (n: number) => string;
  /** Words written in two ways and said alike, on a word lower-cased with its apostrophe "'": short
   *  forms in full ("geht's" → "gehtes"; written apart, "geht es", the words join to the same: a frame
   *  and wordDiff join two words), a number's optional part ("einhundert" → "hundert"). */
  said?: Array<[RegExp, string]>;
  /** Spellings of one sound made one ("ß" → "ss"): a word spelt so is misspelt, not another word. */
  spellings?: Array<[RegExp, string]>;
  /** Nouns are capitalised: a capitalised word in mid-sentence is matched with its case when typed. */
  nounsCapitalised?: true;
}

const FORMS: Record<string, LanguageForms> = {
  de: {
    number: NUMBER_WORDS.de,
    said: [
      [/'s$/, "es"],
      [/^ein(?=hundert|tausend)/, ""],
    ],
    spellings: [
      [/ß/g, "ss"],
      [/^tschüs$/, "tschüss"],
    ],
    nounsCapitalised: true,
  },
  en: {
    number: NUMBER_WORDS.en,
    said: [
      [/^can't$/, "cannot"],
      [/^won't$/, "willnot"],
      [/^shan't$/, "shallnot"],
      [/^let's$/, "letus"],
      [/n't$/, "not"],
      [/'re$/, "are"],
      [/'m$/, "am"],
      [/'ll$/, "will"],
      [/'ve$/, "have"],
      [/'d$/, "would"],
      [/'s$/, "is"],
    ],
  },
};

/** A language's forms by its code ("de", "de-AT"); none: an empty set. */
export const formsOf = (lang: string): LanguageForms =>
  FORMS[lang.split("-")[0]?.toLowerCase() ?? ""] ?? {};

/** `word` with the rules applied in order. */
export const applied = (word: string, rules: Array<[RegExp, string]> = []) =>
  rules.reduce((w, [from, to]) => w.replace(from, to), word);
