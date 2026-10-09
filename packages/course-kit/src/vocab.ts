// A lesson's vocabulary (02, "Keys and identity"): headwords → canonical entries + locale translations.
import {
  type Gender,
  type Lang,
  type LessonKey,
  type LocaleLesson,
  lemmaSlug,
  lexemeKey,
  type MediaPath,
  type PartOfSpeech,
  type VocabEntry,
  vocabKey,
} from "@sprachanker/schema";

/** What a provider reads from a headword: the lemma, its part of speech and the facts given with it. */
export interface Headword {
  lemma: string;
  pos: PartOfSpeech;
  gender?: Gender;
  /** Plural form with article, when the source gives one. */
  plural?: string;
  forms?: string;
  note?: string;
  /** Pronunciation as the source writes it (IPA). */
  ipa?: string;
}

/**
 * A headword the source states nothing more about, by its shape (02): a sentence or three words or
 * more is a phrase; English "to X" is a verb with lemma X; anything else is a word. Every provider
 * uses this, so the same entry gets the same lexeme in every course.
 */
export function shapeHeadword(lang: Lang, text: string): Headword {
  const lemma = text.trim().replace(/\s+/g, " ");
  const words = lemma.split(" ");
  if (/[.!?]$/.test(lemma) || words.length > 2) return { lemma, pos: "phrase" };
  if (lang === "en" && words.length === 2 && words[0]?.toLowerCase() === "to")
    return { lemma: words[1] as string, pos: "verb" };
  return { lemma, pos: "word" };
}

/** One word of a lesson as the source lists it. */
export interface VocabSource {
  head: Headword;
  /** Headword as the source shows it. */
  target: string;
  examples?: string[];
  audio?: MediaPath;
  image?: MediaPath;
  /** In the edition's language; without it the word has no locale entry. */
  translation?: string;
  /** Translations of `examples`, same order. */
  exampleTranslations?: string[];
}

/**
 * Vocabulary entries of a lesson in source order. The same lemma twice gets numbered keys
 * (`v-bank`, `v-bank.2`); a headword without a lemma slug is skipped and returned as such. Optional
 * facts are copied as the provider gives them.
 */
export function vocabEntries<S extends VocabSource>(
  lesson: LessonKey,
  lang: Lang,
  sources: S[],
): { vocab: VocabEntry[]; translations: LocaleLesson["vocab"]; skipped: S[] } {
  const seen = new Map<string, number>();
  const vocab: VocabEntry[] = [];
  const translations: LocaleLesson["vocab"] = {};
  const skipped: S[] = [];
  for (const source of sources) {
    const { head } = source;
    const slug = lemmaSlug(head.lemma);
    if (!slug) {
      skipped.push(source);
      continue;
    }
    const n = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, n);
    const key = vocabKey(lesson, head.lemma, n);
    vocab.push({
      key,
      lexeme: lexemeKey(lang, head.lemma, head.pos, head.gender),
      target: source.target,
      ...(head.gender !== undefined ? { gender: head.gender } : {}),
      ...(head.plural !== undefined ? { plural: head.plural } : {}),
      ...(head.forms !== undefined ? { forms: head.forms } : {}),
      ...(head.note !== undefined ? { note: head.note } : {}),
      ...(head.ipa !== undefined ? { ipa: head.ipa } : {}),
      ...(source.examples?.length ? { examples: source.examples } : {}),
      ...(source.audio ? { audio: source.audio } : {}),
      ...(source.image ? { image: source.image } : {}),
    });
    if (source.translation !== undefined) {
      translations[key] = {
        translation: source.translation,
        ...(source.exampleTranslations ? { examples: source.exampleTranslations } : {}),
      };
    }
  }
  return { vocab, translations, skipped };
}

/** Words a lesson lists that did not become entries, as `unmapped` lines of its raw page (02: never
 *  drop source content silently). */
export const skippedWords = (
  path: string,
  skipped: Array<{ target: string }>,
  why = "word without a usable headword",
) => skipped.map((s) => ({ path, reason: `${why}: "${s.target}"` }));
