// A lesson's vocabulary: headwords → canonical entries + locale translations.
import {
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

/** The facts a headword may give, as its entry keeps them (`VocabEntry`). */
const HEAD_FACTS = ["gender", "plural", "forms", "note", "ipa"] as const;

/** What a provider reads from a headword: the lemma, its part of speech and the facts given with it. */
export type Headword = { lemma: string; pos: PartOfSpeech } & Partial<
  Pick<VocabEntry, (typeof HEAD_FACTS)[number]>
>;

// The lexeme's shaping rules are schema's (imported decks use them too); providers take them from here.
export { germanGender, shapeHeadword } from "@sprachanker/schema";

/** One word of a lesson as the source lists it. */
interface VocabSource {
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
      ...Object.fromEntries(
        HEAD_FACTS.flatMap((f) => (head[f] !== undefined ? [[f, head[f]]] : [])),
      ),
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

/** Words a lesson lists that did not become entries, as `unmapped` lines of its raw page (never
 *  drop source content silently). */
export const skippedWords = (
  path: string,
  skipped: Array<{ target: string }>,
  why = "word without a usable headword",
) => skipped.map((s) => ({ path, reason: `${why}: "${s.target}"` }));
