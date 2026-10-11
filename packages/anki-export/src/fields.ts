// A note's fields (04, "Decks"): what each holds by its name — the word, its translation, plural, part
// of speech; or a language's text, an example sentence in it (`sentence_1_german`), the audio of
// either (`audio_german`, `audio_sentence_1_german`) — and a field's HTML as plain text.

export type Named = "word" | "translation" | "plural" | "pos";

/** What a field holds: one of the named roles, or text in a language — the word or its translation,
 *  an example sentence (its number), or the audio of either. */
export type FieldRole =
  | { named: Named }
  | { lang: string; sentence?: number; audio?: true }
  | undefined;

/** Field names by role, lowercased, `_` and `-` as spaces. */
const NAMED: Record<Named, string[]> = {
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

/** Languages by their names in English, German and themselves (and Russian), lowercased. */
const LANGUAGES: Record<string, string[]> = {
  de: ["german", "deutsch", "немецкий"],
  en: ["english", "englisch", "английский"],
  ru: ["russian", "russisch", "русский"],
  uk: ["ukrainian", "ukrainisch", "українська", "украинский"],
  fr: ["french", "französisch", "français", "francais", "французский"],
  es: ["spanish", "spanisch", "español", "espanol", "испанский"],
  it: ["italian", "italienisch", "italiano", "итальянский"],
  pl: ["polish", "polnisch", "polski", "польский"],
  tr: ["turkish", "türkisch", "türkçe", "турецкий"],
};
const langOf = (token: string) =>
  Object.entries(LANGUAGES).find(([, names]) => names.includes(token))?.[0];
const SENTENCE = ["sentence", "example", "satz", "beispiel", "пример", "предложение"];
const AUDIO = ["audio", "sound", "ton", "аудио"];

export function fieldRole(name: string): FieldRole {
  const norm = name.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const named = (Object.keys(NAMED) as Named[]).find((role) => NAMED[role].includes(norm));
  if (named) return { named };
  const tokens = norm.split(" ");
  const lang = tokens.map(langOf).find(Boolean);
  if (!lang) return undefined;
  const sentence = tokens.some((t) => SENTENCE.includes(t))
    ? Number(tokens.find((t) => /^\d+$/.test(t)) ?? 1)
    : undefined;
  return {
    lang,
    ...(sentence !== undefined && { sentence }),
    ...(tokens.some((t) => AUDIO.includes(t)) && { audio: true as const }),
  };
}

/** The languages a note type's fields hold words or translations in, in field order. */
export const fieldLanguages = (names: string[]) => [
  ...new Set(
    names.flatMap((n) => {
      const role = fieldRole(n);
      return role && "lang" in role && !role.sentence && !role.audio ? [role.lang] : [];
    }),
  ),
];

const SOUND = /\[sound:([^\]]+)\]/g;
const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** The media file a field's first `[sound:…]` names. */
export const soundOf = (html: string | undefined) => html?.match(/\[sound:([^\]]+)\]/)?.[1];

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
