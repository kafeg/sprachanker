// Cards from a lesson's words (04, "Spaced repetition"): one note per lexeme and translation language,
// reused when the word is met again in that language, made in the run the lesson shows (its origin);
// a course's words as a deck to take (every lesson's words at once, in course order) or leave (its cards
// never studied removed); and notes that follow their words when a course is normalised again. Studying
// them is study.ts; listing them, words.ts.
import {
  CardDisplay,
  type CardFace,
  type EditionId,
  type Lesson,
  type LessonKey,
  type LocaleLesson,
  parseEditionId,
} from "@sprachanker/schema";
import { monotonicFactory } from "ulid";
import type { CardStore } from "./card-store.ts";
import type { Content } from "./content.ts";
import { readStored } from "./run-store.ts";
import type { Settings } from "./settings.ts";

const DEFAULT_FACES: CardFace[] = ["recognition", "production"];

export function createCards(deps: {
  cards: CardStore;
  content: Content;
  settings: Settings;
  /** The run the lesson shows (the runs service): the run a lesson's cards are made in. */
  session: (lessonKey: LessonKey) => Promise<{ run: { id: string } } | undefined>;
  now: () => number;
}) {
  const { cards, content, settings, now } = deps;
  // Monotonic: cards made in one call keep the order of the words.
  const id = monotonicFactory();

  /**
   * Cards of the given lessons' words in the edition's translation language, in their order; a word met
   * before in that language keeps its card (one whose lexeme changed — a normaliser rule — takes the new
   * one). Returns how many were made. Runs inside `cards.atomic`.
   */
  function make(
    request: { series: string; edition: string },
    lessons: Array<{ lesson: Lesson; locale?: LocaleLesson | null }>,
    origin: string | null,
  ) {
    const lang = parseEditionId(request.edition as EditionId).source;
    const faces = (settings.get("srs.faces") ?? DEFAULT_FACES).join(",");
    let created = 0;
    for (const { lesson, locale } of lessons)
      for (const v of lesson.vocab) {
        if (cards.byLexeme(v.lexeme, lang)) continue;
        const earlier = cards.bySource(v.key, lang);
        if (earlier) {
          cards.setNote(earlier.id, { lexemeKey: v.lexeme });
          continue;
        }
        const translation = locale?.vocab[v.key]?.translation;
        const display: CardDisplay = {
          target: v.target,
          ...(v.gender && { gender: v.gender }),
          ...(v.plural && { plural: v.plural }),
          ...(translation && { translation }),
          ...(v.examples?.[0] && { example: v.examples[0] }),
          ...(v.audio && { audio: v.audio }),
          series: request.series,
          lessonKey: lesson.key,
        };
        cards.insert({
          id: id(now()),
          kind: "lexeme",
          lexemeKey: v.lexeme,
          translationLang: lang,
          sourceKey: v.key,
          originRunId: origin,
          faces,
          displayCacheJson: JSON.stringify(display),
          createdAt: now(),
        });
        created++;
      }
    return created;
  }

  return {
    /** Makes cards of a lesson's words, in the run the lesson shows (their origin). */
    async fromLesson(request: { series: string; lessonKey: LessonKey; edition: string }) {
      const origin = (await deps.session(request.lessonKey))?.run.id ?? null;
      const words = await content.lessonWithLocale(
        request.series,
        request.lessonKey,
        request.edition,
      );
      return { created: cards.atomic(() => make(request, [words], origin)) };
    },

    /** A course's words as a deck (04): every lesson's words made into cards at once, in course order,
     *  as new cards (Anki: a deck taken); words with a card already keep it. */
    async takeDeck(request: { series: string; course: string; edition: string }) {
      const map = await content.courseMap(request.series, request.course, request.edition);
      const lessons = map.index.units.flatMap((u) => u.lessons) as LessonKey[];
      const words = await Promise.all(
        lessons.map((key) => content.lessonWithLocale(request.series, key, request.edition)),
      );
      return { created: cards.atomic(() => make(request, words, null)) };
    },

    /** Leaves a course's deck in a language: its cards never studied are removed; those studied stay,
     *  with their progress. */
    leaveDeck(request: { course: string; lang: string }) {
      const states = cards.states();
      const unstudied = cards
        .all()
        .filter(
          (n) =>
            n.course === request.course &&
            n.translationLang === request.lang &&
            !cards.facesOf(n).some((f) => states.has(`${n.id}:${f}`)),
        )
        .map((n) => n.id);
      cards.atomic(() => cards.remove(unstudied));
      return { removed: unstudied.length };
    },

    /** The courses here as decks to take: each installed course and language pair with its words and
     *  how many of them are cards already. */
    async deckOffers() {
      const notes = cards.all();
      const offers = [];
      for (const c of await content.courses())
        for (const edition of c.editions) {
          const lang = parseEditionId(edition as EditionId).source;
          const lexemes = new Set<string>();
          for (const key of c.lessons as LessonKey[])
            for (const v of (await content.lesson(c.series, key)).vocab) lexemes.add(v.lexeme);
          if (!lexemes.size) continue;
          const mine = notes.filter(
            (n) => n.translationLang === lang && n.lexemeKey && lexemes.has(n.lexemeKey),
          ).length;
          offers.push({
            series: c.series,
            course: c.course,
            key: c.key,
            edition,
            lang,
            title: c.titles[edition] ?? c.key,
            words: lexemes.size,
            mine,
          });
        }
      return offers;
    },

    /**
     * Each card follows the word it was made from (its source key, stable across normalisations):
     * when the course's files give that word another lexeme now (a normaliser rule changed), the card
     * takes it — unless a card of that lexeme exists already. Returns how many changed.
     */
    async relink(): Promise<number> {
      let changed = 0;
      for (const row of cards.rows()) {
        if (!row.sourceKey) continue;
        const display = readStored(row.displayCacheJson, CardDisplay, `card ${row.id}`);
        if (!display) continue;
        const lesson = await content
          .lesson(display.series, display.lessonKey as LessonKey)
          .catch(() => undefined);
        const word = lesson?.vocab.find((v) => v.key === row.sourceKey);
        if (
          !word ||
          word.lexeme === row.lexemeKey ||
          cards.byLexeme(word.lexeme, row.translationLang)
        )
          continue;
        cards.setNote(row.id, { lexemeKey: word.lexeme });
        changed++;
      }
      return changed;
    },
  };
}
export type Cards = ReturnType<typeof createCards>;
