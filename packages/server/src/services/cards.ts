// Cards from a lesson's words (04, "Spaced repetition"): one note per lexeme and translation language,
// reused when the word is met again in that language, made in the run the lesson shows (its origin);
// a course of the learner's own as a deck to take (every lesson's words at once, in course order) or
// leave (its cards removed, those of words another of the learner's decks has moving there); and notes
// that follow their words when a course is normalised again. Studying them is study.ts; listing them,
// words.ts.
import {
  CardDisplay,
  type EditionId,
  type Lesson,
  type LessonKey,
  type LocaleLesson,
  lessonOrder,
  parseEditionId,
} from "@sprachanker/schema";
import { monotonicFactory } from "ulid";
import type { CardStore } from "./card-store.ts";
import type { Content } from "./content.ts";
import { type RunStore, readStored } from "./run-store.ts";
import type { Settings } from "./settings.ts";

export function createCards(deps: {
  cards: CardStore;
  /** The run store: a card that goes takes its answers with it (05, "Events"). */
  store: Pick<RunStore, "remove">;
  content: Content;
  settings: Settings;
  /** The run the lesson shows (the lessons service): the run a lesson's cards are made in. */
  session: (lessonKey: LessonKey) => Promise<{ run: { id: string } } | undefined>;
  /** The courses the learner has started (My courses, by course key): the decks offered. */
  myCourses: () => Promise<Set<string>>;
  now: () => number;
}) {
  const { cards, content, settings, now } = deps;
  // Monotonic: cards made in one call keep the order of the words.
  const id = monotonicFactory();

  /** What a card of a lesson's word shows: the word, its translation in the edition, its recording. */
  function displayOf(
    series: string,
    lesson: Lesson,
    translation: string | undefined,
    v: Lesson["vocab"][number],
  ): CardDisplay {
    return {
      target: v.target,
      ...(v.gender && { gender: v.gender }),
      ...(v.plural && { plural: v.plural }),
      ...(translation && { translation }),
      ...(v.examples?.[0] && { example: v.examples[0] }),
      ...(v.audio && { audio: v.audio }),
      series,
      lessonKey: lesson.key,
    };
  }

  /** Each word of a course in an edition, by lexeme: where it is first met, in course order. */
  async function wordsOf(course: { series: string; lessons: LessonKey[] }, edition: string) {
    const out = new Map<
      string,
      {
        series: string;
        lesson: Lesson;
        locale: LocaleLesson | null | undefined;
        word: Lesson["vocab"][number];
      }
    >();
    for (const key of course.lessons) {
      const { lesson, locale } = await content.lessonWithLocale(course.series, key, edition);
      for (const word of lesson.vocab)
        if (!out.has(word.lexeme))
          out.set(word.lexeme, { series: course.series, lesson, locale, word });
    }
    return out;
  }

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
    const faces = settings.value("srs.faces").join(",");
    let created = 0;
    for (const { lesson, locale } of lessons)
      for (const v of lesson.vocab) {
        if (cards.byLexeme(v.lexeme, lang)) continue;
        const earlier = cards.bySource(v.key, lang);
        if (earlier) {
          cards.setNote(earlier.id, { lexemeKey: v.lexeme });
          continue;
        }
        const display = displayOf(request.series, lesson, locale?.vocab[v.key]?.translation, v);
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
      const lessons = lessonOrder(map.index);
      const words = await Promise.all(
        lessons.map((key) => content.lessonWithLocale(request.series, key, request.edition)),
      );
      return { created: cards.atomic(() => make(request, words, null)) };
    },

    /**
     * Leaves a course's deck (as Review lists it: the course under its words' language): its cards go,
     * with their progress (their faces and every answer to them, as a reset takes them) — but a card of a word another of the learner's decks has (a course with
     * cards, in the same translation language) moves to that deck with its progress (owner,
     * 2026-10-09). Returns how many went and how many moved.
     */
    async leaveDeck(request: { course: string; lang: string }) {
      const notes = cards.all();
      const leaving = notes.filter((n) => n.course === request.course && n.lang === request.lang);
      const others = new Set(
        notes
          .filter((n) => n.course !== request.course && n.lang === request.lang)
          .map((n) => n.course),
      );
      const installed = (await content.courses()).filter((c) => others.has(c.key));
      /** Where a word lives in the other decks, per translation language (read once each). */
      const homes = new Map<string, Array<Awaited<ReturnType<typeof wordsOf>>>>();
      const homesIn = async (lang: string) => {
        let found = homes.get(lang);
        if (!found) {
          found = [];
          for (const c of installed)
            for (const edition of c.editions)
              if (parseEditionId(edition as EditionId).source === lang)
                found.push(await wordsOf(c, edition));
          homes.set(lang, found);
        }
        return found;
      };
      const moves: Array<{ id: string; sourceKey: string; display: CardDisplay }> = [];
      const gone: string[] = [];
      for (const n of leaving) {
        const home = n.lexemeKey
          ? (await homesIn(n.translationLang))
              .map((w) => w.get(n.lexemeKey as string))
              .find(Boolean)
          : undefined;
        if (home)
          moves.push({
            id: n.id,
            sourceKey: home.word.key,
            display: displayOf(
              home.series,
              home.lesson,
              home.locale?.vocab[home.word.key]?.translation,
              home.word,
            ),
          });
        else gone.push(n.id);
      }
      cards.atomic(() => {
        for (const m of moves)
          cards.setNote(m.id, {
            sourceKey: m.sourceKey,
            displayCacheJson: JSON.stringify(m.display),
          });
        deps.store.remove([], gone);
        cards.remove(gone);
      });
      return { removed: gone.length, moved: moves.length };
    },

    /** The learner's courses (My courses) as decks to take: each course and language pair with its
     *  words and how many of them are cards already. */
    async deckOffers() {
      const notes = cards.all();
      const started = await deps.myCourses();
      const offers = [];
      for (const c of (await content.courses()).filter((c) => started.has(c.key)))
        for (const edition of c.editions) {
          const lang = parseEditionId(edition as EditionId).source;
          const lexemes = new Set<string>();
          try {
            for (const key of c.lessons)
              for (const v of (await content.lesson(c.series, key)).vocab) lexemes.add(v.lexeme);
          } catch (error) {
            // A lesson that does not read leaves its course out of the offers, not the others.
            console.error(`${c.key} does not read; not offered: ${String(error)}`);
            continue;
          }
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
     * takes it — unless a card of that lexeme exists already; and what it shows of the word (the word,
     * gender, plural, example, recording) is the word's now — a recording renamed when the series was
     * fetched again is not another word's. Returns how many changed.
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
        if (!lesson || !word) continue;
        const note: Parameters<typeof cards.setNote>[1] = {};
        if (word.lexeme !== row.lexemeKey && !cards.byLexeme(word.lexeme, row.translationLang))
          note.lexemeKey = word.lexeme;
        const shown = JSON.stringify(displayOf(display.series, lesson, display.translation, word));
        if (shown !== row.displayCacheJson) note.displayCacheJson = shown;
        if (!Object.keys(note).length) continue;
        cards.setNote(row.id, note);
        changed++;
      }
      return changed;
    },
  };
}
export type Cards = ReturnType<typeof createCards>;
