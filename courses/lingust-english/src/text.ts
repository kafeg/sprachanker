// Telling the course's two scripts apart (course-kit's helpers): the pages mix Russian explanations and
// English examples in one element; how Lingust's lines read.
import {
  CYRILLIC,
  hasCyrillic,
  inLearnerLanguage,
  latinLetters,
  plainText,
} from "@sprachanker/course-kit";

/**
 * Text of an HTML fragment where inline tags do not split words ("c<strong>a</strong>t" → "cat");
 * footnote marks (`<sup>`) are dropped.
 */
export const flatText = (html: string) =>
  plainText(
    html
      .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "")
      .replace(/<\/?(strong|b|em|i|span|a|u|s|small|sub)\b[^>]*>/gi, ""),
  );

/** More Cyrillic letters than Latin ones. */
export const isRussian = (text: string) => inLearnerLanguage(text, "en", "ru");

/** Russian words the key joins English answers with ("… или …", "также можно: …"). */
const OR = /\s*(?:[;,]\s*)?(?<!\p{L})(?:или|также(?:\s+можно)?)(?!\p{L})\s*:?\s*/giu;
/** The key's Russian list letters and era marks, as the English answer writes them. */
const LETTERS: Record<string, string> = { а: "a", б: "b", в: "c", г: "d" };

/**
 * The English answers of a key's line: alternatives it joins with Russian words are answers of
 * their own; its list letters ("а.", "б.") and era marks ("н.э.", "до н.э.") the English ones —
 * the source's answer written in the language it is in (02, "Text language").
 */
export function englishAnswers(line: string): string[] {
  const english = line
    .replace(
      /(^|\s)([абвг])\.(?=\s)/gu,
      (_, space: string, letter: string) => `${space}${LETTERS[letter]}.`,
    )
    .replace(/\s*(?:до|д\.)\s*н\.\s*э\./gu, " BC")
    .replace(/\s*н\.\s*э\./gu, " AD");
  return english
    .split(OR)
    .map((answer) => answer.replace(/^[\s.,;:]+|[\s,;:]+$/g, ""))
    .filter((answer) => latinLetters(answer) >= 2);
}

/** Pronunciation in slashes ("/gɪv/", "/ə'baʊt/"): IPA marks or an apostrophe for stress. */
const IPA = /\s*\/[^\s/][^/]*?[ˈˌːəɪʊʌæɒɔɜθðŋʃʒʤʧɑɛ'][^/]*?\/(?=[\s,;.)]|$)/g;
export const withoutIpa = (text: string) => text.replace(IPA, "").trim();
export const ipaOf = (text: string) => text.match(IPA)?.[0]?.trim();

/** Parenthesised remarks in Russian ("(когда)", "(досл.: …)") removed from a target-language text. */
export function withoutRussianRemarks(text: string): string {
  let out = text;
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/\s*\([^()]*\p{Script=Cyrillic}[^()]*\)/gu, "");
  }
  return out
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/([.!?])\./g, "$1")
    .trim();
}

/**
 * The English example at the start of a line ("I do. – Я делаю.", "Always (всегда)", "Monday
 * Понедельник"): the text before the first Cyrillic letter, if it is the main part of the line or
 * the Russian part is set off as a translation. Undefined for Russian lines that merely start with
 * an English word ("Well нам уже известно…").
 */
export function englishLine(line: string): { en: string; ru?: string } | undefined {
  const text = flatText(line);
  // "back (спина), bag (сумка)": English with Russian glosses.
  const bare = withoutRussianRemarks(text);
  if (!hasCyrillic(bare) && latinLetters(bare) >= 2 && bare.length < text.length)
    return { en: withoutIpa(bare).replace(/[\s,;:]+$/, "") };
  const cut = text.search(CYRILLIC);
  const head = cut < 0 ? text : text.slice(0, cut);
  const en = withoutIpa(head)
    .replace(/[\s–—\-(:;,=«"“]+$/, "")
    .replace(/^[\s–—-]+/, "")
    .trim();
  if (latinLetters(en) < 2 || !/^[\s‘'"“(—–-]*[A-Za-z0-9]/.test(en)) return undefined;
  if (cut < 0) return { en };
  const setOff = /[–—(=:]\s*$/.test(head) || /^\(/.test(text.slice(head.trimEnd().length).trim());
  if (!setOff && head.length < text.length * 0.3) return undefined;
  const ru = text
    .slice(head.length)
    .replace(/^[\s–—(=:-]+/, "")
    .trim();
  // "Always (всегда)": the closing bracket of the gloss, not one of the translation's own.
  const unbalanced = (ru.match(/\)/g)?.length ?? 0) > (ru.match(/\(/g)?.length ?? 0);
  return { en, ...(ru ? { ru: unbalanced ? ru.replace(/\)$/, "") : ru } : {}) };
}
