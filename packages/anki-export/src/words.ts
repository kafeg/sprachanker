// Notes → a deck's words (04, "Decks"): each field's role by its name — the word, its translation,
// plural, part of speech — else the first field is the word and the second its translation; HTML made
// plain text, the first `[sound:…]` the word's audio; then the word's lexeme by the rules every course
// uses (schema `shapeHeadword`, `germanGender`), so a word a course has links to its card.
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

/** A note's word as its fields give it, before its language is known. */
export interface NoteWord {
  key: string;
  target: string;
  translation?: string;
  plural?: string;
  /** The part of speech as the deck names it ("Nomen", "Verb"). */
  pos?: string;
  tags: string[];
  /** The media file's name its first `[sound:…]` names. */
  sound?: string;
}

type Role = "word" | "translation" | "plural" | "pos";

/** Field names by role, lowercased; a field named after a language is the word when it comes first
 *  of those, else the translation. */
const ROLES: Record<Role, string[]> = {
  word: [
    "wort",
    "word",
    "front",
    "vorderseite",
    "vokabel",
    "vocabulary",
    "term",
    "expression",
    "слово",
  ],
  translation: [
    "übersetzung",
    "translation",
    "back",
    "rückseite",
    "meaning",
    "bedeutung",
    "definition",
    "перевод",
    "значение",
  ],
  plural: ["plural", "mehrzahl", "множественное число"],
  pos: ["wortart", "part of speech", "pos", "word type", "часть речи"],
};
const LANGUAGE_NAMES = [
  "deutsch",
  "german",
  "englisch",
  "english",
  "russisch",
  "russian",
  "русский",
  "немецкий",
  "английский",
];

/** Which field holds what, by name; unnamed word and translation fall to the first fields left. */
function rolesOf(names: string[]): Partial<Record<Role, number>> {
  const lower = names.map((n) => n.trim().toLowerCase());
  const roles: Partial<Record<Role, number>> = {};
  for (const role of Object.keys(ROLES) as Role[]) {
    const i = lower.findIndex((n) => ROLES[role].includes(n));
    if (i >= 0) roles[role] = i;
  }
  const taken = () => new Set(Object.values(roles));
  for (const role of ["word", "translation"] as const) {
    if (roles[role] !== undefined) continue;
    const free = lower.map((_, i) => i).filter((i) => !taken().has(i));
    roles[role] = free.find((i) => LANGUAGE_NAMES.includes(lower[i] as string)) ?? free[0];
  }
  return roles;
}

const SOUND = /\[sound:([^\]]+)\]/g;
const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** A field's text: tags dropped, line breaks as "; ", entities decoded, `[sound:…]` left out. */
export function fieldText(html: string): string {
  return html
    .replace(SOUND, " ")
    .replace(/<br\s*\/?>|<\/(div|p|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
      if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? match;
      const code =
        name[1] === "x" || name[1] === "X"
          ? Number.parseInt(name.slice(2), 16)
          : Number(name.slice(1));
      return code <= 0x10ffff ? String.fromCodePoint(code) : match;
    })
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("; ")
    .normalize("NFC");
}

/** Each note's word, in note order; a note with no word in its word field is left out. */
export function noteWords(notes: AnkiNote[]): NoteWord[] {
  const out: NoteWord[] = [];
  for (const note of notes) {
    const roles = rolesOf(note.fieldNames.length ? note.fieldNames : note.fields.map(() => ""));
    const field = (role: Role) => {
      const i = roles[role];
      return i === undefined ? undefined : fieldText(note.fields[i] ?? "") || undefined;
    };
    const target = field("word");
    if (!target) continue;
    const wordField = note.fields[roles.word ?? -1] ?? "";
    const sound = [wordField, ...note.fields].join(" ").match(/\[sound:([^\]]+)\]/)?.[1];
    const [translation, plural, pos] = [field("translation"), field("plural"), field("pos")];
    out.push({
      key: note.guid,
      target,
      ...(translation && { translation }),
      ...(plural && { plural }),
      ...(pos && { pos }),
      tags: note.tags,
      ...(sound && { sound }),
    });
  }
  return out;
}

const POS: Array<[PartOfSpeech, string[]]> = [
  ["noun", ["nomen", "substantiv", "noun", "n", "n.", "существительное", "сущ."]],
  ["verb", ["verb", "v", "v.", "глагол", "гл."]],
  ["adj", ["adjektiv", "adjective", "adj", "adj.", "прилагательное", "прил."]],
];
const posOf = (named: string | undefined) =>
  named ? POS.find(([, names]) => names.includes(named.trim().toLowerCase()))?.[0] : undefined;

const ARTICLE = /^(der|die|das)\s+(.+)$/i;
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
  const pluralOnly = !!word.plural && PLURAL_ONLY.test(word.plural);
  let plural = word.plural && !pluralOnly && !NO_PLURAL.test(word.plural) ? word.plural : undefined;
  let lemma: string;
  let pos: PartOfSpeech;
  let gender: Gender | undefined;
  if (article && (stated === "noun" || !word.pos)) {
    // "der Kaffee, die Kaffees": the plural given after the noun.
    const [noun = "", ...after] = (article[2] as string).split(",");
    lemma = noun.trim();
    plural ??= after.join(",").trim() || undefined;
    pos = "noun";
    gender = pluralOnly ? "pl" : germanGender(article[1]);
  } else {
    const shaped = shapeHeadword(lang, head);
    lemma = shaped.lemma;
    // A phrase stays one whatever the deck calls it ("die Zähne putzen": Verb), as in the courses.
    pos = shaped.pos === "phrase" ? "phrase" : (stated ?? shaped.pos);
  }
  if (!lemmaSlug(lemma)) return undefined;
  return {
    lexeme: lexemeKey(lang, lemma, pos, gender),
    ...(gender && { gender }),
    ...(plural && { plural }),
  };
}
