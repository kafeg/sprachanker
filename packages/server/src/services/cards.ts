// Cards from a lesson's words (04, "Spaced repetition"): one note per lexeme and translation language,
// reused when the word is met again in that language, made in the run the lesson shows (its origin);
// a course of the learner's own or an imported deck as a deck to take (all its words at once, in its
// order) or leave (its cards removed, those of words another of the learner's decks has moving there);
// and notes that follow their words when a course is normalised, a deck imported again or its words
// read aloud; what a card shows where it is studied (a deck's own entry of its word). Studying them
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
  type LexemeKey,
  type LocaleLesson,
  lessonOrder,
  parseEditionId,
  parseLessonKey,
  parseLexemeKey,
  seriesOf,
} from "@sprachanker/schema";
import { monotonicFactory } from "ulid";
import { ServiceError } from "../errors.ts";
import type { CardStore, Note } from "./card-store.ts";
import type { Content } from "./content.ts";
import type { DeckNote } from "./deck-extras.ts";
import type { Decks } from "./decks.ts";
import { type RunStore, readStored } from "./run-store.ts";
import type { Settings } from "./settings.ts";

/** A word as a card shows it, and the word it is of (its source key). */
type Home = { sourceKey: string; display: CardDisplay };
/** An installed course as the content lists it. */
type Course = Awaited<ReturnType<Content["courses"]>>[number];
/** A course's word where it is first met in an edition: its lesson and its translation there. */
type Entry = {
  series: string;
  lesson: Lesson;
  translation: string | undefined;
  word: Lesson["vocab"][number];
};

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
  /** A word's audio read aloud for its deck (deck-audio.ts) by its lexeme, while it is of the word
   *  as shown: `<folder>/media/<file>`. */
  readAudio: (folder: string, lexeme: string, target: string) => string | undefined;
  /** The profiles studying an imported deck (it is deleted only when none does). */
  studiedBy: (deck: DeckId) => string[];
  now: () => number;
}) {
  const { cards, content, decks, settings, now } = deps;
  // Monotonic: cards made in one call keep the order of the words.
  const id = monotonicFactory();

  /** What a card of a lesson's word shows: the word, its translation in the edition, its recording
   *  (`read`: else the audio read aloud for its deck). */
  function displayOf(
    series: string,
    lesson: Lesson,
    translation: string | undefined,
    v: Lesson["vocab"][number],
    read = true,
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
        read,
      ),
      series,
      lessonKey: lesson.key,
    };
  }

  /** A word's own audio, else (`read`) the audio read aloud for its deck (by its lexeme there). */
  const readAloud = (
    audio: string | undefined,
    folder: string,
    lexeme: string,
    target: string,
    read: boolean,
  ) => {
    if (audio) return { audio };
    const made = read ? deps.readAudio(folder, lexeme, target) : undefined;
    return made ? { readAudio: made } : {};
  };

  /** What a card of an imported deck's word shows. */
  const deckDisplay = (deck: Deck, w: DeckWord, read = true): CardDisplay => ({
    target: w.target,
    ...(w.gender && { gender: w.gender }),
    ...(w.plural && { plural: w.plural }),
    ...(w.translation && { translation: w.translation }),
    ...readAloud(w.audio, deck.id, w.lexeme, w.target, read),
    ...(w.examples?.length && { examples: w.examples }),
    deck: deck.id,
  });

  /** The installed courses by deck (`course:<key>`): listed once — one listing for every card
   *  asking at once — and anew when cards are relinked (a course installed or normalised again). */
  let installed: Promise<Map<string, Course>> | undefined;
  function installedCourses() {
    if (!installed) {
      const listing = content
        .courses()
        .then((list) => new Map(list.map((c) => [`course:${c.key}`, c])));
      installed = listing;
      // A listing that fails is asked again next time.
      listing.catch(() => {
        if (installed === listing) installed = undefined;
      });
    }
    return installed;
  }

  /** Each course's words in an edition by lexeme, where each is first met, in course order: read
   *  once, and anew when cards are relinked — a course that does not read too. */
  const entries = new Map<string, Promise<Map<string, Entry>>>();
  function entriesOf(course: Course, edition: string) {
    const key = `${course.key} ${edition}`;
    let found = entries.get(key);
    if (!found) {
      found = (async () => {
        const out = new Map<string, Entry>();
        for (const lessonKey of course.lessons) {
          const { lesson, locale } = await content.lessonWithLocale(
            course.series,
            lessonKey,
            edition,
          );
          for (const word of lesson.vocab)
            if (!out.has(word.lexeme))
              out.set(word.lexeme, {
                series: course.series,
                lesson,
                translation: locale?.vocab[word.key]?.translation,
                word,
              });
        }
        return out;
      })();
      entries.set(key, found);
      // Its failure is its readers' (kept until relinking).
      found.catch(() => {});
    }
    return found;
  }

  /** A course's entry of a word in an edition (the course by its deck, `course:<key>`); none when the
   *  course is not here, not in that edition, does not read, or is without the word. */
  async function courseEntry(scope: string, edition: string, lexeme: string) {
    const course = (await installedCourses()).get(scope);
    if (!course?.editions.includes(edition)) return undefined;
    const entry = (await entriesOf(course, edition).catch(() => undefined))?.get(lexeme);
    return entry && displayOf(entry.series, entry.lesson, entry.translation, entry.word);
  }

  /** The learner's course decks by language pair (`<translation>-<lang>`), in deck order: worked out
   *  once per list of cards — the context a list (My words, a queue) hands to `shown` for each. */
  const pairsOf = new WeakMap<Note[], Map<string, string[]>>();
  function coursesIn(notes: Note[], pair: string) {
    let pairs = pairsOf.get(notes);
    if (!pairs) {
      const sets = new Map<string, Set<string>>();
      for (const n of notes) {
        if (!n.deck.startsWith("course:")) continue;
        const key = `${n.translationLang}-${n.lang}`;
        sets.set(key, (sets.get(key) ?? new Set()).add(n.deck));
      }
      pairs = new Map([...sets].map(([key, decks]) => [key, [...decks].sort()]));
      pairsOf.set(notes, pairs);
    }
    return pairs.get(pair) ?? [];
  }

  /** Each word of a course in an edition, by lexeme: where it is first met, in course order. */
  async function wordsOf(course: Course, edition: string) {
    const out = new Map<string, Home>();
    for (const [lexeme, e] of await entriesOf(course, edition))
      out.set(lexeme, {
        sourceKey: e.word.key,
        display: displayOf(e.series, e.lesson, e.translation, e.word),
      });
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
      const courses = [...(await installedCourses())].flatMap(([scope, c]) =>
        others.has(scope) ? [c] : [],
      );
      const imported = [...others].flatMap((d) =>
        d.startsWith("deck:") ? (decks.deck(d.slice(5)) ?? []) : [],
      );
      /** Where a word lives in the other decks, per translation language (read once each). */
      const homes = new Map<string, Array<Map<string, Home>>>();
      const homesIn = async (lang: string) => {
        let found = homes.get(lang);
        if (!found) {
          found = [];
          for (const c of courses)
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

    /**
     * A deck's words, taken or not, as what is made for them takes them (04: audio read aloud,
     * examples): an imported deck's notes, or a course's words across its lessons in an edition (its
     * first when none is named) — one per lexeme, where each is first met, in the deck's order, as a
     * card would show it without the audio read for it. 404 when the deck or edition is not here.
     */
    async sourceNotes(scope: string, edition?: string): Promise<DeckNote[]> {
      const note = (lexeme: string, translationLang: string, display: CardDisplay): DeckNote => ({
        lexeme,
        lang: parseLexemeKey(lexeme as LexemeKey).lang,
        translationLang,
        display,
      });
      if (scope.startsWith("deck:")) {
        const deck = deckOrFail(scope.slice("deck:".length));
        if (edition && edition !== `${deck.translationLang}-${deck.lang}`)
          throw new ServiceError("no_such_deck", 404);
        const seen = new Set<string>();
        return deck.words.flatMap((w) => {
          if (seen.has(w.lexeme)) return [];
          seen.add(w.lexeme);
          return [note(w.lexeme, deck.translationLang, deckDisplay(deck, w, false))];
        });
      }
      const course = (await installedCourses()).get(scope);
      const chosen = edition ?? course?.editions[0];
      if (!course || !chosen || !course.editions.includes(chosen))
        throw new ServiceError("no_such_deck", 404);
      const translationLang = parseEditionId(chosen as EditionId).source;
      return [...(await entriesOf(course, chosen))].map(([lexeme, e]) =>
        note(lexeme, translationLang, displayOf(e.series, e.lesson, e.translation, e.word, false)),
      );
    },

    /**
     * What a card shows where it is studied (04, "Decks"): in a deck — an imported deck's, a course's,
     * a lesson's Words step — that deck's own entry of its word (its recording, else the audio read
     * aloud for that deck), else what the card was made with; in a language's queue, every deck's,
     * My words and the word sheet, a course's entry over an imported deck's — the card's own course,
     * else the first of the learner's courses (by deck, in its language pair) that has the word —,
     * else the card's own. `notes`: the learner's cards, when they are read already — a list's context:
     * the learner's courses per language pair are worked out once for it.
     */
    async shown(note: Note, scope: string, notes?: Note[]): Promise<CardDisplay> {
      const lexeme = note.lexemeKey;
      if (!lexeme) return note.display;
      const edition = `${note.translationLang}-${note.lang}`;
      if (scope.startsWith("deck:")) {
        const deck = decks.deck(scope.slice("deck:".length));
        const word =
          deck?.translationLang === note.translationLang
            ? deck.words.find((w) => w.lexeme === lexeme)
            : undefined;
        return deck && word ? deckDisplay(deck, word) : note.display;
      }
      if (scope.startsWith("lesson:")) {
        const [, lessonEdition = "", key = ""] = scope.split(":");
        const series = seriesOf(key as LessonKey);
        const read = await content
          .lessonWithLocale(series, key as LessonKey, lessonEdition)
          .catch(() => undefined);
        const word = read?.lesson.vocab.find((v) => v.lexeme === lexeme);
        return read && word
          ? displayOf(series, read.lesson, read.locale?.vocab[word.key]?.translation, word)
          : note.display;
      }
      if (scope.startsWith("course:"))
        return note.deck === scope
          ? note.display
          : ((await courseEntry(scope, edition, lexeme)) ?? note.display);
      if (note.deck.startsWith("course:")) return note.display;
      for (const course of coursesIn(notes ?? cards.all(), edition)) {
        const entry = await courseEntry(course, edition, lexeme);
        if (entry) return entry;
      }
      return note.display;
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
          studiedBy: deps.studiedBy(d.id),
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
      // The courses as installed now.
      installed = undefined;
      entries.clear();
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
