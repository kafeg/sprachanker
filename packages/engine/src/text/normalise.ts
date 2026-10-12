// Text normalisation for checking typed and spoken answers.

const DASHES = /[‐‑‒–—―]/g;

/** NFC; one form for quotes, apostrophes and dashes; collapsed whitespace. */
const tidy = (text: string) =>
  text
    .normalize("NFC")
    .replace(/[’‘`´ʼ‚‛]/g, "'")
    .replace(/[“”„«»‹›]/g, '"')
    .replace(DASHES, "-")
    .replace(/[​-‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Tidied as `tidy`, and no final punctuation. */
export function normalise(text: string): string {
  return tidy(text)
    .replace(/\s*[.!?…]+$/, "")
    .trim();
}

/** Words of a normalised text; punctuation stays attached so "Ihnen?" ≠ "Ihnen". */
export const tokens = (text: string) => normalise(text).split(" ").filter(Boolean);

/** Words of a text as written, its final mark too: for showing a diff word by word. */
export const writtenTokens = (text: string) => tidy(text).split(" ").filter(Boolean);

/** Whether a gap_text answer leaves a gap empty: blank, or a dash for "nothing here". */
export const isEmptyGap = (text: string) => /^[\s-]*$/.test(text.replace(DASHES, "-"));

const SENTENCE_END = /[.!?:]$/;

/** Whether text ends a sentence, so the next word starts one. */
export const endsSentence = (text: string) => SENTENCE_END.test(text.trimEnd());

/**
 * Whether the reference word at `index` keeps its case when compared: German capitalises nouns and
 * the formal "Sie", so a capitalised word that does not start a sentence must match exactly.
 * `startsSentence`: whether the first word starts a sentence (a gap in mid-sentence does not).
 */
function caseMatters(lang: string, words: string[], index: number, startsSentence = true): boolean {
  if (lang !== "de") return false;
  const word = words[index] ?? "";
  const starts = index === 0 ? startsSentence : endsSentence(words[index - 1] ?? "");
  return !starts && /^\p{Lu}/u.test(word);
}

/**
 * Whether `actual` is the reference word at `index`, with the language's case rule; `strip` takes
 * what does not count off both words (punctuation, for dictation and speech).
 */
export function wordMatches(
  lang: string,
  reference: string[],
  index: number,
  actual: string,
  options: {
    ignoreCase?: boolean;
    startsSentence?: boolean;
    strip?: (word: string) => string;
  } = {},
) {
  const strip = options.strip ?? ((w: string) => w);
  const expected = strip(reference[index] ?? "");
  const got = strip(actual);
  if (!options.ignoreCase && caseMatters(lang, reference, index, options.startsSentence))
    return expected === got;
  return expected.toLocaleLowerCase(lang) === got.toLocaleLowerCase(lang);
}

/**
 * Typed answer equals the reference after normalisation, with the case rule of the language.
 * `startsSentence`: false for a gap in mid-sentence, whose first word keeps its case rule.
 */
export function sameText(
  lang: string,
  reference: string,
  actual: string,
  startsSentence = true,
): boolean {
  const ref = tokens(reference);
  const got = tokens(actual);
  return (
    ref.length === got.length &&
    ref.every((_, i) => wordMatches(lang, ref, i, got[i] as string, { startsSentence }))
  );
}

/** Words before a headword that are not the word itself (articles, "sich", "to"…), per language. */
const LEADING: Record<string, RegExp> = {
  de: /^\(?(der|die|das|ein|eine|sich|etwas|jemand(en|em)?)\)?\s+/g,
  en: /^\(?(the|a|an|to)\)?\s+/g,
};

/** A headword for looking a word up: without articles, case and the forms after a comma
 *  ("die Frau, die Frauen" → "frau"). */
export const headword = (lang: string, text: string) =>
  (text.split(",")[0] ?? "")
    .toLocaleLowerCase(lang)
    .replace(LEADING[lang] ?? /^$/, "")
    .trim();
