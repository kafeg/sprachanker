// Words of a sentence against a vocabulary: which words the learner has met —
// a headword's forms (its plural and the forms the course gives, "studiert, studierte, hat studiert")
// or a form that differs only by an ending ("wohne" — "wohnen") — and which are new, with a translation where
// a vocabulary has one. Rough by design: it marks words to look at, it checks no answer.
import { IRREGULAR_VERBS } from "./irregular-verbs.ts";

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

/** How many words a text has, as a writing task counts them: a dash or a lone mark is no word. */
export const wordCount = (text: string) =>
  text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;

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

/** Whether a written word is a form: the same, or a stem of `stem` letters or more (three by
 *  default) with inflection after it in both ("heißt" — "heißen", "Kaffees" — "Kaffee", "trinkst" —
 *  "trinken"). */
export function sameWord(written: string, form: string, stem = 3): boolean {
  const a = lower(written);
  if (a === form) return true;
  let common = 0;
  while (common < a.length && a[common] === form[common]) common++;
  return common >= stem && ENDING.test(a.slice(common)) && ENDING.test(form.slice(common));
}

/** The stem a translation is given by: longer than for knowing a word, so "Wann" is not "die Wand"
 *  nor "Haus" "die Haut". */
const GLOSS_STEM = 4;

/** A word's main part: its longer forms ("frau" of "die Frau", not "die"), else all of them. */
function mainForms(word: VocabWord): string[] {
  const forms = wordForms(word);
  return forms.some((f) => f.length >= 4) ? forms.filter((f) => f.length >= 4) : forms;
}

/** Whether a sentence uses the word: one of its words is a form of the word's main part (its
 *  longer words: "Frau" of "die Frau", not "die"). */
export function usesWord(sentence: string, word: VocabWord): boolean {
  const main = mainForms(word);
  return sentence
    .split(WORD)
    .filter((part) => WORD.test(part))
    .some((w) => main.some((f) => sameWord(w, f)));
}

/** Lower case, umlauts as their vowels ("lädt" — "ladt"): a vowel inflection changed. */
const plain = (word: string) =>
  lower(word).normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");

const IRREGULAR = new Map(
  Object.entries(IRREGULAR_VERBS).map(([verb, forms]) => [
    plain(verb),
    new Set(forms.split(" ").map(plain)),
  ]),
);

/** How many first letters two words share. */
function common(a: string, b: string): number {
  let n = 0;
  while (n < a.length && a[n] === b[n]) n++;
  return n;
}

/** Whether a written word may be a form of a word's form (both plain): three first letters or more
 *  in common, a participle's "ge-" aside ("gefahren" — "fahren"), or an irregular verb's form. */
const mayBeForm = (written: string, form: string) =>
  common(written, form) >= 3 ||
  (written.startsWith("ge") && common(written.slice(2), form) >= 3) ||
  !!IRREGULAR.get(form)?.has(written);

/** Whether a written word is surely a form of `word`: by the ending rule, or an irregular form. */
const surelyForm = (written: string, word: VocabWord) =>
  usesWord(written, word) ||
  mainForms(word).some((f) => !!IRREGULAR.get(plain(f))?.has(plain(written)));

const wordsIn = (text: string) => text.split(/[^\p{L}'’-]+/u).filter(Boolean);

/**
 * Whether a sentence uses the word in the form a model says it used, which no ending rule finds:
 * every word of `form` is in the sentence (case aside), and the form is of the word — one of its words
 * shares three first letters with the word's main part (umlauts and a participle's "ge-" aside:
 * "Äpfel" of "der Apfel", "gefahren" of "fahren") or is an irregular verb's form (`IRREGULAR_VERBS`:
 * "ist" of "sein", "kann" of "können"), or it is a separable verb's prefix with a form of the verb
 * without it ("lädt … ein" of "einladen", "sieht … fern" of "fernsehen"). A word of the form that is
 * surely a form of one of `others` (the other words asked, the words known; an entry of the word itself
 * aside) is theirs: "fahre" is of "fahren", not of "das Fahrrad".
 */
export function hasForm(
  sentence: string,
  form: string,
  word: VocabWord,
  others: readonly VocabWord[] = [],
): boolean {
  const written = new Set(wordsIn(sentence).map(lower));
  const parts = wordsIn(form);
  if (!parts.length || !parts.every((p) => written.has(lower(p)))) return false;
  const plains = parts.map(plain);
  const main = mainForms(word);
  // Another entry of the word itself ("der Apfel, die Äpfel" among the known) is no other word.
  const rivals = others.filter((o) => !mainForms(o).some((f) => main.includes(f)));
  const ours = (i: number) => !rivals.some((o) => surelyForm(parts[i] as string, o));
  return main
    .map(plain)
    .some((f) =>
      plains.some((p, i) =>
        plains.length > 1 && f.length > p.length && f.startsWith(p)
          ? plains.some((q, j) => j !== i && mayBeForm(q, f.slice(p.length)))
          : mayBeForm(p, f) && ours(i),
      ),
    );
}

/** Articles before a headword or its plural ("die Frau, die Frauen"): no word of a sentence they
 *  translate. */
const ARTICLES = /(^|,\s*)(der|die|das|den|dem|des|ein|eine|the|a|an)\s+/gi;

/** The forms of a word that translate a word of a sentence: its headword's and plural's without their
 *  articles, and its other forms of four letters or more (not "hat" of "hat studiert"). */
function glossForms(word: VocabWord): string[] {
  const head = wordForms({
    target: word.target.replace(ARTICLES, "$1"),
    plural: word.plural?.replace(ARTICLES, "$1"),
  });
  const more = word.forms ? wordForms({ target: word.forms }).filter((f) => f.length >= 4) : [];
  return [...new Set([...head, ...more])];
}

/** A model's glossary of new words, without those `known` has (every word of an entry met, as
 *  `markWords` tells): a word the learner has met is never glossed as new. */
export function newGlosses<G extends { word: string }>(glossary: G[], known: VocabWord[]): G[] {
  const knownForms = known.flatMap(wordForms);
  return glossary.filter(
    (g) =>
      !g.word
        .split(WORD)
        .filter((part) => WORD.test(part))
        .every((part) => knownForms.some((f) => sameWord(part, f))),
  );
}

/** A question as a glossary is held against it: its text, its options or its accepted answers. */
export interface AskedQuestion {
  question: string;
  options?: string[];
  accepted?: string[];
}

/** What stands in quotation marks in a question ("Was bedeutet „nervt“?", «…», German's ‚…‘; '…'
 *  aside: an apostrophe is a letter's). */
const QUOTED = /["„“”«»‹›「『‚]([^"„“”«»‹›「」『』‚‘]{1,80})["“”«»‹›」』‘]/gu;

const wordsOf = (text: string) =>
  text
    .split(WORD)
    .filter((part) => WORD.test(part))
    .map(lower);

/** Whether `words` hold `part` as a run of whole words. */
const holds = (words: string[], part: string[]) =>
  part.length > 0 && words.some((_, i) => part.every((p, k) => words[i + k] === p));

/**
 * A glossary without the entries that would give an answer away — a question asking what the word
 * means: the word quoted in the question ("Was bedeutet „Quatsch“?" — a form of one of its words of
 * four letters or more, all when it has none), or its translation among a question's options or
 * accepted answers. A word a question merely uses ("Anna möchte drei Brötchen.") stays glossed.
 */
export function unaskedGlosses<G extends { word: string; translation: string }>(
  glossary: G[],
  questions: AskedQuestion[],
): G[] {
  const quoted = questions.flatMap((q) =>
    [...q.question.matchAll(QUOTED)].flatMap(([, inside]) => wordsOf(inside ?? "")),
  );
  const answers = questions.flatMap((q) => [...(q.options ?? []), ...(q.accepted ?? [])]);
  return glossary.filter((g) => {
    const forms = glossForms({ target: g.word });
    const main = forms.some((f) => f.length >= 4) ? forms.filter((f) => f.length >= 4) : forms;
    const asked = main.some((f) => quoted.some((w) => sameWord(w, f, Math.min(4, f.length))));
    const meaning = wordsOf(g.translation);
    return !asked && !answers.some((a) => holds(wordsOf(a), meaning));
  });
}

/**
 * A sentence in pieces, its words marked new unless `known` has them; a new word takes the
 * translation of the first entry of `glossary` that has it as written, else of the first that has a
 * form of it (an ending apart).
 */
export function markWords(sentence: string, known: VocabWord[], glossary: VocabWord[]): Segment[] {
  const knownForms = known.flatMap(wordForms);
  const glossed = glossary.map((g) => ({ forms: glossForms(g), translation: g.translation }));
  return sentence
    .split(WORD)
    .filter(Boolean)
    .map((part) => {
      if (!WORD.test(part) || knownForms.some((f) => sameWord(part, f))) return { text: part };
      const written = lower(part);
      const translation = (
        glossed.find((g) => g.forms.includes(written)) ??
        glossed.find((g) => g.forms.some((f) => sameWord(part, f, GLOSS_STEM)))
      )?.translation;
      return translation ? { text: part, new: true, translation } : { text: part, new: true };
    });
}
