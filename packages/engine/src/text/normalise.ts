// Text normalisation for checking typed and spoken answers (04, "Checking").

/** NFC; one form for quotes, apostrophes and dashes; collapsed whitespace; no final punctuation. */
export function normalise(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[’‘`´ʼ]/g, "'")
    .replace(/[“”„«»‹›]/g, '"')
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*[.!?…]+$/, "")
    .trim();
}

/** Words of a normalised text; punctuation stays attached so "Ihnen?" ≠ "Ihnen". */
export const tokens = (text: string) => normalise(text).split(" ").filter(Boolean);

const SENTENCE_END = /[.!?:]$/;

/**
 * Whether the reference word at `index` keeps its case when compared: German capitalises nouns and
 * the formal "Sie", so a capitalised word that does not start a sentence must match exactly (04).
 */
export function caseMatters(lang: string, words: string[], index: number): boolean {
  if (lang !== "de") return false;
  const word = words[index] ?? "";
  const starts = index === 0 || SENTENCE_END.test(words[index - 1] ?? "");
  return !starts && /^\p{Lu}/u.test(word);
}

function sameWord(
  lang: string,
  reference: string[],
  index: number,
  actual: string,
  ignoreCase: boolean,
) {
  const expected = reference[index] ?? "";
  if (!ignoreCase && caseMatters(lang, reference, index)) return expected === actual;
  return expected.toLocaleLowerCase(lang) === actual.toLocaleLowerCase(lang);
}

/** Typed answer equals the reference after normalisation, with the case rule of the language. */
export function sameText(lang: string, reference: string, actual: string): boolean {
  const ref = tokens(reference);
  const got = tokens(actual);
  return (
    ref.length === got.length &&
    ref.every((_, i) => sameWord(lang, ref, i, got[i] as string, false))
  );
}
