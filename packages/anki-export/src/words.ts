// Notes → a deck's words (04, "Decks"): the word, its translation (the field of the translation
// language when the fields are named by language), plural, part of speech and the deck's example
// sentences with their translations and audio, by the fields' names (fields.ts) — else the first field
// is the word and the second its translation; then the word's lexeme by the rules every course uses
// (schema `shapeHeadword`, `germanGender`), so a word a course has links to its card.
import {
  type Gender,
  germanGender,
  type Lang,
  type LexemeKey,
  lemmaSlug,
  lexemeKey,
  type PartOfSpeech,
  shapeHeadword,
} from "@sprachanker/schema";
import type { AnkiNote } from "./apkg.ts";
import { type FieldRole, fieldRole, fieldText, type Named, soundOf } from "./fields.ts";

/** A note's word as its fields give it. */
export interface NoteWord {
  key: string;
  target: string;
  translation?: string;
  plural?: string;
  /** The part of speech as the deck names it ("Nomen", "Verb", "nf"). */
  pos?: string;
  tags: string[];
  /** The media file of the word's audio (its first `[sound:…]`). */
  sound?: string;
  /** The deck's example sentences in the word's language, with their translations and audio. */
  examples?: Array<{ sentence: string; translation?: string; sound?: string }>;
}

/** The languages chosen for a deck: the words' and their translations'. Either may be unknown (a
 *  preview): then the first field named by a language holds the word, the next its translation. */
export interface DeckLanguages {
  lang?: string;
  translationLang?: string;
}

/** Which field holds what in a note type. */
function layout(names: string[], langs: DeckLanguages) {
  const roles: FieldRole[] = names.map(fieldRole);
  const named = (role: Named) => roles.findIndex((r) => r && "named" in r && r.named === role);
  const inLang = (lang: string | undefined, sentence?: number, audio?: boolean) =>
    roles.findIndex(
      (r) =>
        !!r &&
        "lang" in r &&
        (lang === undefined || r.lang === lang) &&
        r.sentence === sentence &&
        !!r.audio === !!audio,
    );
  const found = (...i: number[]) => i.find((n) => n >= 0);
  // Fields of a language's word or translation; fields of no role at all.
  const languages = roles.flatMap((r, i) =>
    r && "lang" in r && !r.sentence && !r.audio ? [i] : [],
  );
  const free = () =>
    names.map((_, i) => i).filter((i) => roles[i] === undefined && i !== word && i !== translation);
  let word = found(named("word"), langs.lang ? inLang(langs.lang) : -1) ?? -1;
  let translation =
    found(named("translation"), langs.translationLang ? inLang(langs.translationLang) : -1) ?? -1;
  if (word < 0) word = languages.find((i) => i !== translation) ?? free()[0] ?? -1;
  if (translation < 0) translation = languages.find((i) => i !== word) ?? free()[0] ?? -1;
  const wordRole = roles[word];
  const wordLang = wordRole && "lang" in wordRole ? wordRole.lang : langs.lang;
  const translationRole = roles[translation];
  const translationLang =
    translationRole && "lang" in translationRole ? translationRole.lang : langs.translationLang;
  const sentences = [
    ...new Set(
      roles.flatMap((r) =>
        r && "lang" in r && r.lang === wordLang && r.sentence ? [r.sentence] : [],
      ),
    ),
  ].sort((a, b) => a - b);
  return {
    word,
    translation,
    plural: named("plural"),
    pos: named("pos"),
    audio: wordLang ? inLang(wordLang, undefined, true) : -1,
    examples: sentences.map((n) => ({
      sentence: inLang(wordLang, n),
      translation: translationLang ? inLang(translationLang, n) : -1,
      audio: inLang(wordLang, n, true),
    })),
  };
}

/** Each note's word, in note order; a note with no word in its word field is left out. */
export function noteWords(notes: AnkiNote[], langs: DeckLanguages = {}): NoteWord[] {
  const layouts = new Map<string, ReturnType<typeof layout>>();
  const out: NoteWord[] = [];
  for (const note of notes) {
    const names = note.fieldNames.length ? note.fieldNames : note.fields.map(() => "");
    const id = names.join("\x1f");
    const at = layouts.get(id) ?? layout(names, langs);
    layouts.set(id, at);
    const raw = (i: number) => (i >= 0 ? note.fields[i] : undefined);
    const text = (i: number) => fieldText(raw(i) ?? "") || undefined;
    const target = text(at.word);
    if (!target) continue;
    const sound = soundOf(raw(at.audio)) ?? soundOf(raw(at.word));
    const examples = at.examples.flatMap((e) => {
      const sentence = text(e.sentence);
      if (!sentence) return [];
      const [translation, audio] = [text(e.translation), soundOf(raw(e.audio))];
      return [{ sentence, ...(translation && { translation }), ...(audio && { sound: audio }) }];
    });
    const [translation, plural, pos] = [text(at.translation), text(at.plural), text(at.pos)];
    out.push({
      key: note.guid,
      target,
      ...(translation && { translation }),
      ...(plural && { plural }),
      ...(pos && { pos }),
      tags: note.tags,
      ...(sound && { sound }),
      ...(examples.length && { examples }),
    });
  }
  return out;
}

/** Parts of speech as decks name them; nouns' codes give their gender (`nf`; `die (pl)`: plural only;
 *  `der, die`: either). Only the first of several (`adj; adv`) counts. */
const POS: Array<[{ pos: PartOfSpeech; gender?: Gender }, string[]]> = [
  [{ pos: "noun" }, ["nomen", "substantiv", "noun", "n", "n.", "существительное", "сущ."]],
  [{ pos: "noun", gender: "m" }, ["nm", "der"]],
  [{ pos: "noun", gender: "f" }, ["nf", "die"]],
  [{ pos: "noun", gender: "n" }, ["nn", "das"]],
  [{ pos: "verb" }, ["verb", "v", "v.", "глагол", "гл."]],
  [{ pos: "adj" }, ["adjektiv", "adjective", "adj", "adj.", "прилагательное", "прил."]],
];
export function posOf(
  named: string | undefined,
): { pos: PartOfSpeech; gender?: Gender } | undefined {
  const first = named?.split(";")[0]?.trim().toLowerCase();
  if (!first) return undefined;
  if (/^((der|die|das),?\s*)*\(pl\)$/.test(first))
    return { pos: "noun", ...(/^(die\s*)?\(pl\)$/.test(first) && { gender: "pl" as const }) };
  // Two articles: a noun of either gender ("der, die Deutsche").
  if (/^(der|die|das)(,\s*(der|die|das))+$/.test(first)) return { pos: "noun" };
  return POS.find(([, names]) => names.includes(first))?.[0];
}

const ARTICLE = /^(der|die|das)\s+(.+)$/;
/** A plural field that says the noun has only a plural, or none. */
const PLURAL_ONLY = /^\(?(nur (im )?pl(ural|\.)?|plural only|only plural|pl\.?)\)?$/i;
const NO_PLURAL = /^(-|–|—|\(?kein(e)? plural\)?|\(?nur (im )?singular\)?|no plural)$/i;

/** A word's lemma, part of speech and gender in its language; none when it has no lemma (a field of
 *  only an image or punctuation). */
export function lexemeOf(
  word: Pick<NoteWord, "target" | "pos" | "plural">,
  lang: Lang,
): { lexeme: LexemeKey; gender?: Gender; plural?: string } | undefined {
  const stated = posOf(word.pos);
  // Parenthesised parts are no part of the lemma, as the courses read them: "(sich) freuen".
  const head = word.target.replace(/\s*\([^)]*\)\s*/g, " ").trim() || word.target;
  const article = lang === "de" ? ARTICLE.exec(head) : null;
  // "der Kaffee, die Kaffees": the plural given after the noun (not "der Doktor, Dr.").
  const [noun = "", ...after] = (article?.[2] ?? "").split(",");
  // Without a stated part of speech only one word after the article is a noun, as the courses read
  // it: "die Zähne putzen" is a phrase.
  const isNoun =
    !!article && (stated?.pos === "noun" || (!word.pos && /^[^\s.!?]+$/u.test(noun.trim())));
  const pluralOnly = stated?.gender === "pl" || (!!word.plural && PLURAL_ONLY.test(word.plural));
  let plural = word.plural && !pluralOnly && !NO_PLURAL.test(word.plural) ? word.plural : undefined;
  let lemma: string;
  let pos: PartOfSpeech;
  let gender: Gender | undefined;
  if (article && isNoun) {
    lemma = noun.trim();
    const tail = after.join(",").trim();
    plural ??= /^die\s/.test(tail) ? tail : undefined;
    pos = "noun";
    gender = pluralOnly ? "pl" : (germanGender(article[1]) ?? stated?.gender);
  } else {
    const shaped = shapeHeadword(lang, head);
    lemma = shaped.lemma;
    // A phrase stays one whatever the deck calls it ("die Zähne putzen": Verb), as in the courses.
    pos = shaped.pos === "phrase" ? "phrase" : (stated?.pos ?? shaped.pos);
    // A noun the deck names without its article ("Leute", die (pl)) keeps the gender it states.
    if (pos === "noun") gender = pluralOnly ? "pl" : stated?.gender;
  }
  if (!lemmaSlug(lemma)) return undefined;
  return {
    lexeme: lexemeKey(lang, lemma, pos, gender),
    ...(gender && { gender }),
    ...(plural && { plural }),
  };
}
