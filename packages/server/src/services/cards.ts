// Cards from a lesson's words (04, "Spaced repetition"): one note per lexeme and translation language,
// reused when the word is met again in that language, made in the run the lesson shows (its origin);
// a course of the learner's own or an imported deck as a deck to take (all its words at once, in its
// order) or leave (its cards removed, those of words another of the learner's decks has moving there);
// and notes that follow their words when a course is normalised, a deck imported again or its words
// read aloud. Studying them
// is study.ts; listing them, words.ts.
import {
  CardDisplay,
  courseDeckFolder,
  type Deck,
  type DeckId,
  type DeckWord,
  deckSourceKey,
  type EditionId,
  type Lesson,
  type LessonKey,
  type LocaleLesson,
  lessonOrder,
  parseEditionId,
  parseLessonKey,
} from "@sprachanker/schema";
import { monotonicFactory } from "ulid";
import { ServiceError } from "../errors.ts";
import type { CardStore } from "./card-store.ts";
import type { Content } from "./content.ts";
import type { Decks } from "./decks.ts";
import { type RunStore, readStored } from "./run-store.ts";
import type { Settings } from "./settings.ts";

/** A word as a card shows it, and the word it is of (its source key). */
type Home = { sourceKey: string; display: CardDisplay };

export function createCards(deps: {
  cards: CardStore;
  /** The run store: a card that goes takes its answers with it (05, "Events"). */
  store: Pick<RunStore, "remove">;
  content: Content;
  decks: Pick<Decks, "deck" | "list">;
  settings: Settings;
  /** The run the lesson shows (the lessons service): the run a lesson's cards are made in. */
  session: (lessonKey: LessonKey) => Promise<{ run: { id: string } } | undefined>;
  /** The courses the learner has started (My courses, by course key): the decks offered. */
  myCourses: () => Promise<Set<string>>;
  /** A word's audio read aloud for its deck (deck-audio.ts): `<folder>/media/<file>`. */
  readAudio: (folder: string, key: string, text: string) => string | undefined;
  now: () => number;
}) {
  const { cards, content, decks, settings, now } = deps;
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
      ...readAloud(
        v.audio,
        courseDeckFolder(parseLessonKey(lesson.key).course),
        v.lexeme,
        v.target,
      ),
      series,
      lessonKey: lesson.key,
    };
  }

  /** A word's own audio, else the audio read aloud for its deck (by its key there). */
  const readAloud = (audio: string | undefined, folder: string, key: string, text: string) => {
    if (audio) return { audio };
    const read = deps.readAudio(folder, key, text);
    return read ? { readAudio: read } : {};
  };

  /** What a card of an imported deck's word shows. */
  const deckDisplay = (deck: Deck, w: DeckWord): CardDisplay => ({
    target: w.target,
    ...(w.gender && { gender: w.gender }),
    ...(w.plural && { plural: w.plural }),
    ...(w.translation && { translation: w.translation }),
    ...readAloud(w.audio, deck.id, w.key, w.target),
    ...(w.examples?.length && { examples: w.examples }),
    deck: deck.id,
  });

  /** Each word of a course in an edition, by lexeme: where it is first met, in course order. */
  async function wordsOf(course: { series: string; lessons: LessonKey[] }, edition: string) {
    const out = new Map<string, Home>();
    for (const key of course.lessons) {
      const { lesson, locale } = await content.lessonWithLocale(course.series, key, edition);
      for (const word of lesson.vocab)
        if (!out.has(word.lexeme))
          out.set(word.lexeme, {
            sourceKey: word.key,
            display: displayOf(course.series, lesson, locale?.vocab[word.key]?.translation, word),
          });
    }
    return out;
  }

  /** An imported deck's words by lexeme (the first of a lexeme). */
  function wordsOfDeck(deck: Deck) {
    const out = new Map<string, Home>();
    for (const w of deck.words)
      if (!out.has(w.lexeme))
        out.set(w.lexeme, {
          sourceKey: deckSourceKey(deck.id, w.key),
          display: deckDisplay(deck, w),
        });
    return out;
  }

  /**
   * Cards of some words in a translation language, in their order; a word met before in that language
   * keeps its card (one whose lexeme changed — a normaliser rule, a deck imported again — takes the new
   * one). Returns how many were made. Runs inside `cards.atomic`.
   */
  function make(lang: string, words: Array<{ lexeme: string } & Home>, origin: string | null) {
    const faces = settings.value("srs.faces").join(",");
    let created = 0;
    for (const w of words) {
      if (cards.byLexeme(w.lexeme, lang)) continue;
      const earlier = cards.bySource(w.sourceKey, lang);
      if (earlier) {
        cards.setNote(earlier.id, { lexemeKey: w.lexeme });
        continue;
      }
      cards.insert({
        id: id(now()),
        kind: "lexeme",
        lexemeKey: w.lexeme,
        translationLang: lang,
        sourceKey: w.sourceKey,
        originRunId: origin,
        faces,
        displayCacheJson: JSON.stringify(w.display),
        createdAt: now(),
      });
      created++;
    }
    return created;
  }

  /** The words of lessons in an edition, as `make` takes them. */
  const lessonWords = (
    series: string,
    lessons: Array<{ lesson: Lesson; locale?: LocaleLesson | null }>,
  ) =>
    lessons.flatMap(({ lesson, locale }) =>
      lesson.vocab.map((v) => ({
        lexeme: v.lexeme,
        sourceKey: v.key,
        display: displayOf(series, lesson, locale?.vocab[v.key]?.translation, v),
      })),
    );

  const deckOrFail = (deckId: string) => {
    const deck = decks.deck(deckId);
    if (!deck) throw new ServiceError("no_such_deck", 404);
    return deck;
  };

  return {
    /** Makes cards of a lesson's words, in the run the lesson shows (their origin). */
    async fromLesson(request: { series: string; lessonKey: LessonKey; edition: string }) {
      const origin = (await deps.session(request.lessonKey))?.run.id ?? null;
      const words = await content.lessonWithLocale(
        request.series,
        request.lessonKey,
        request.edition,
      );
      const lang = parseEditionId(request.edition as EditionId).source;
      return {
        created: cards.atomic(() => make(lang, lessonWords(request.series, [words]), origin)),
      };
    },

    /** A course's words — or an imported deck's — as a deck (04): all made into cards at once, in
     *  their order, as new cards (Anki: a deck taken); words with a card already keep it. */
    async takeDeck(
      request: { series: string; course: string; edition: string } | { deck: DeckId },
    ) {
      if ("deck" in request) {
        const deck = deckOrFail(request.deck);
        const words = deck.words.map((w) => ({
          lexeme: w.lexeme,
          sourceKey: deckSourceKey(deck.id, w.key),
          display: deckDisplay(deck, w),
        }));
        return { created: cards.atomic(() => make(deck.translationLang, words, null)) };
      }
      const map = await content.courseMap(request.series, request.course, request.edition);
      const words = await Promise.all(
        lessonOrder(map.index).map((key) =>
          content.lessonWithLocale(request.series, key, request.edition),
        ),
      );
      const lang = parseEditionId(request.edition as EditionId).source;
      return {
        created: cards.atomic(() => make(lang, lessonWords(request.series, words), null)),
      };
    },

    /**
     * Leaves a deck as Review lists it — a course under its words' language (`course:<key>`), or an
     * imported deck (`deck:<id>`): the cards made in it go, with their progress (their faces and every
     * answer to them, as a reset takes them) — but a card of a word another of the learner's decks has
     * (a course or an imported deck with cards, in the same translation language) moves to that deck
     * with its progress (owner, 2026-10-09). Returns how many went and how many moved.
     */
    async leaveDeck(request: { scope: string; lang: string }) {
      const notes = cards.all();
      const inLang = notes.filter((n) => n.lang === request.lang);
      const leaving = inLang.filter((n) => n.deck === request.scope);
      const others = new Set(inLang.map((n) => n.deck).filter((d) => d !== request.scope));
      const installed = (await content.courses()).filter((c) => others.has(`course:${c.key}`));
      const imported = [...others].flatMap((d) =>
        d.startsWith("deck:") ? (decks.deck(d.slice(5)) ?? []) : [],
      );
      /** Where a word lives in the other decks, per translation language (read once each). */
      const homes = new Map<string, Array<Map<string, Home>>>();
      const homesIn = async (lang: string) => {
        let found = homes.get(lang);
        if (!found) {
          found = [];
          for (const c of installed)
            for (const edition of c.editions)
              if (parseEditionId(edition as EditionId).source === lang)
                found.push(await wordsOf(c, edition));
          for (const d of imported) if (d.translationLang === lang) found.push(wordsOfDeck(d));
          homes.set(lang, found);
        }
        return found;
      };
      const moves: Array<{ id: string } & Home> = [];
      const gone: string[] = [];
      for (const n of leaving) {
        const home = n.lexemeKey
          ? (await homesIn(n.translationLang))
              .map((w) => w.get(n.lexemeKey as string))
              .find(Boolean)
          : undefined;
        if (home) moves.push({ id: n.id, ...home });
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

    /** Decks to take: the learner's courses (My courses), each course and language pair, and the
     *  imported decks — each with its words and how many of them are cards already. */
    async deckOffers() {
      const notes = cards.all();
      const mineOf = (lang: string, lexemes: Set<string>) =>
        notes.filter((n) => n.translationLang === lang && n.lexemeKey && lexemes.has(n.lexemeKey))
          .length;
      const started = await deps.myCourses();
      const courses = [];
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
          courses.push({
            scope: `course:${c.key}`,
            series: c.series,
            course: c.course,
            edition,
            title: c.titles[edition] ?? c.key,
            words: lexemes.size,
            mine: mineOf(lang, lexemes),
          });
        }
      const imported = decks.list().map((d) => {
        const deck = decks.deck(d.id) as Deck;
        return {
          scope: `deck:${d.id}`,
          deck: d.id,
          edition: `${d.translationLang}-${d.lang}`,
          title: d.title,
          words: new Set(deck.words.map((w) => w.lexeme)).size,
          withAudio: d.withAudio,
          mine: mineOf(d.translationLang, new Set(deck.words.map((w) => w.lexeme))),
        };
      });
      return { courses, imported };
    },

    /**
     * Each card follows the word it was made from (its source key, stable across normalisations and
     * imports): when the course's files or the deck give that word another lexeme now (a normaliser
     * rule changed, a deck imported again), the card takes it — unless a card of that lexeme exists
     * already; and what it shows of the word (the word, gender, plural, example, recording — its own,
     * else the one read aloud for its deck) is the word's now — a recording renamed when the series
     * was fetched again is not another word's.
     * Returns how many changed.
     */
    async relink(): Promise<number> {
      let changed = 0;
      /** Each deck's words by their cards' source key (read once per relinking). */
      const decksRead = new Map<string, { deck: Deck; words: Map<string, DeckWord> } | undefined>();
      const deckWords = (id: string) => {
        if (!decksRead.has(id)) {
          const deck = decks.deck(id);
          decksRead.set(
            id,
            deck && {
              deck,
              words: new Map(deck.words.map((w) => [deckSourceKey(deck.id, w.key), w])),
            },
          );
        }
        return decksRead.get(id);
      };
      for (const row of cards.rows()) {
        if (!row.sourceKey) continue;
        const display = readStored(row.displayCacheJson, CardDisplay, `card ${row.id}`);
        if (!display) continue;
        const current = await (async () => {
          if ("deck" in display) {
            const read = deckWords(display.deck);
            const word = read?.words.get(row.sourceKey as string);
            return read && word && { lexeme: word.lexeme, display: deckDisplay(read.deck, word) };
          }
          const lesson = await content
            .lesson(display.series, display.lessonKey as LessonKey)
            .catch(() => undefined);
          const word = lesson?.vocab.find((v) => v.key === row.sourceKey);
          return (
            lesson &&
            word && {
              lexeme: word.lexeme,
              display: displayOf(display.series, lesson, display.translation, word),
            }
          );
        })();
        if (!current) continue;
        const note: Parameters<typeof cards.setNote>[1] = {};
        if (
          current.lexeme !== row.lexemeKey &&
          !cards.byLexeme(current.lexeme, row.translationLang)
        )
          note.lexemeKey = current.lexeme;
        const shown = JSON.stringify(current.display);
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
