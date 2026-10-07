// Words of a sentence against a vocabulary (04, "AI examples"; 07): which words the learner has met —
// a headword's forms (its plural and the forms the course gives, "studiert, studierte, hat studiert")
// or a form that differs only by an ending ("wohne" — "wohnen") — and which are new, with a translation where
// a vocabulary has one. Rough by design: it marks words to look at, it checks no answer.

export interface VocabWord {
  /** Headword as the course shows it: "die Frau, die Frauen", "(etwas) studieren". */
  target: string;
  plural?: string;
  forms?: string;
  translation?: string;
}

/** A piece of a sentence: a word new to the learner is marked, with its translation when known. */
export interface Segment {
  text: string;
  new?: true;
  translation?: string;
}

const WORD = /(\p{L}[\p{L}'’-]*)/u;
const lower = (word: string) => word.normalize("NFC").toLocaleLowerCase();

/** The written forms of a word, lower case: its headword, plural and forms, without what is in
 *  brackets ("(etwas)"). */
export function wordForms(word: VocabWord): string[] {
  const text = [word.target, word.plural, word.forms].filter(Boolean).join(" ");
  return [
    ...new Set(
      text
        .replace(/\([^)]*\)/g, " ")
        .split(/[^\p{L}'’-]+/u)
        .filter(Boolean)
        .map(lower),
    ),
  ];
}

/** What inflection adds to a stem, as German and English write it ("-e", "-st", "-en", "-em", "-s",
 *  "-ed"); a longer or other ending is another word ("Wohnung" is not "wohnen"). */
const ENDING = /^[denmrst]{0,3}$/;

/** Whether a written word is a form: the same, or a stem of three letters or more with inflection
 *  after it in both ("heißt" — "heißen", "Kaffees" — "Kaffee", "trinkst" — "trinken"). */
export function sameWord(written: string, form: string): boolean {
  const a = lower(written);
  if (a === form) return true;
  let common = 0;
  while (common < a.length && a[common] === form[common]) common++;
  return common >= 3 && ENDING.test(a.slice(common)) && ENDING.test(form.slice(common));
}

/** Whether a sentence uses the word: one of its words is a form of the word's main part (its
 *  longer words: "Frau" of "die Frau", not "die"). */
export function usesWord(sentence: string, word: VocabWord): boolean {
  const forms = wordForms(word);
  const main = forms.some((f) => f.length >= 4) ? forms.filter((f) => f.length >= 4) : forms;
  return sentence
    .split(WORD)
    .filter((part) => WORD.test(part))
    .some((w) => main.some((f) => sameWord(w, f)));
}

/**
 * A sentence in pieces, its words marked new unless `known` has them; a new word takes the
 * translation of the first entry of `glossary` that has it (the course's vocabulary, then others).
 */
export function markWords(sentence: string, known: VocabWord[], glossary: VocabWord[]): Segment[] {
  const knownForms = known.flatMap(wordForms);
  const glossed = glossary.map((g) => ({ forms: wordForms(g), translation: g.translation }));
  return sentence
    .split(WORD)
    .filter(Boolean)
    .map((part) => {
      if (!WORD.test(part) || knownForms.some((f) => sameWord(part, f))) return { text: part };
      const translation = glossed.find((g) => g.forms.some((f) => sameWord(part, f)))?.translation;
      return translation ? { text: part, new: true, translation } : { text: part, new: true };
    });
}
