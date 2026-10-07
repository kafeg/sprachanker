// Cards from a lesson's words (04, "Spaced repetition"): one note per lexeme and translation language,
// reused when the word is met again in that language, made in the run the lesson shows (its origin); and
// notes that follow their words when a course is normalised again. Studying them is study.ts; listing them, words.ts.
import {
  CardDisplay,
  type CardFace,
  type EditionId,
  type LessonKey,
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
  // Monotonic: cards made in one call keep the order of the lesson's words.
  const id = monotonicFactory();

  return {
    /** Makes cards of a lesson's words, in the run the lesson shows (their origin): one per lexeme in the
     *  edition's translation language; a word met before in that language keeps its card. */
    async fromLesson(request: { series: string; lessonKey: LessonKey; edition: string }) {
      const lang = parseEditionId(request.edition as EditionId).source;
      const origin = (await deps.session(request.lessonKey))?.run.id ?? null;
      const { lesson, locale } = await content.lessonWithLocale(
        request.series,
        request.lessonKey,
        request.edition,
      );
      const faces = (settings.get("srs.faces") ?? DEFAULT_FACES).join(",");
      let created = 0;
      cards.atomic(() => {
        for (const v of lesson.vocab) {
          if (cards.byLexeme(v.lexeme, lang)) continue;
          // The word's card from before its lexeme changed (a normaliser rule) takes the new one.
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
            lessonKey: request.lessonKey,
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
      });
      return { created };
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
