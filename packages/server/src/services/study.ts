// Study as in Anki (04, "Spaced repetition"): decks are the courses the words were met in, under the
// language they teach; the queue is the engine's `studyQueue` with Anki's limits and day; each rating is
// a `card_review` event in the day's `review` run, written together with the face's state; undo, bury,
// suspend, flag and mark as in Anki's reviewer.
import {
  type CardEvent,
  cardDay,
  intervals,
  isLeech,
  lessonFace,
  type QueueFace,
  review,
  SRS_DEFAULTS,
  type SrsParams,
  studyDay,
  studyQueue,
} from "@sprachanker/engine";
import {
  type CardFace,
  type CardRating,
  type EditionId,
  type LessonKey,
  parseEditionId,
  seriesOf,
} from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";
import type { CardStore, Note } from "./card-store.ts";
import type { Content } from "./content.ts";
import type { RunStore } from "./run-store.ts";
import type { Settings } from "./settings.ts";

/**
 * What to study: every deck, a language (`lang:de`), a course (`course:<course key>`), or a lesson's own
 * words in an edition (`lesson:<edition>:<lesson key>`: their cards in its translation language, the
 * first card type only, without the day's new limit).
 */
export type DeckScope = string;

export function createStudy(deps: {
  cards: CardStore;
  store: RunStore;
  content: Content;
  settings: Settings;
  now: () => number;
}) {
  const { cards, store, content, settings, now } = deps;
  /** The profile's scheduling options (its Review settings). */
  const params = (): SrsParams => ({
    retention: settings.get("srs.retention") ?? SRS_DEFAULTS.retention,
    learningSteps: settings.get("srs.learningSteps") ?? SRS_DEFAULTS.learningSteps,
    relearningSteps: settings.get("srs.relearningSteps") ?? SRS_DEFAULTS.relearningSteps,
  });
  /** The learner's day (Anki: next day starts at the profile's hour). */
  const dayOf = (t: number) =>
    studyDay(t, settings.get("srs.dayStartHour") ?? SRS_DEFAULTS.dayStartHour);

  /** The notes of a scope, in the order they were made (their position in the deck). */
  async function notesIn(scope: DeckScope, all = cards.all()) {
    if (scope.startsWith("lang:")) return all.filter((n) => n.lang === scope.slice(5));
    if (scope.startsWith("course:")) return all.filter((n) => n.course === scope.slice(7));
    if (scope.startsWith("lesson:")) {
      const [, edition = "", lessonKey = ""] = scope.split(":") as [string, EditionId, LessonKey];
      const lesson = await content.lesson(seriesOf(lessonKey as LessonKey), lessonKey as LessonKey);
      const lexemes = new Set<string>(lesson.vocab.map((v) => v.lexeme));
      const lang = parseEditionId(edition as EditionId).source;
      return all.filter(
        (n) => n.lexemeKey && lexemes.has(n.lexemeKey) && n.translationLang === lang,
      );
    }
    return all;
  }

  /** The learner's day of card answers (engine `cardDay`). */
  function day() {
    const events = store.eventsWhere({
      types: ["card_review", "card_undo"],
      since: dayOf(now()).start,
    });
    return cardDay(events as CardEvent[]);
  }

  /** What a queue is built from, read once for any number of decks. */
  const studyData = () => ({ t: now(), notes: cards.all(), states: cards.states(), today: day() });

  /** New cards added to today's limit of a scope (Anki's custom study): its own, and for a language
   *  those of its courses. */
  function extraNew(scope: DeckScope, notes: Note[]) {
    const extra = settings.get("srs.extraNew");
    if (!extra || extra.day !== dayOf(now()).start) return 0;
    const own = extra.scopes[scope] ?? 0;
    if (!scope.startsWith("lang:")) return own;
    const courses = new Set(
      notes.filter((n) => n.lang === scope.slice(5)).map((n) => `course:${n.course}`),
    );
    return own + [...courses].reduce((sum, c) => sum + (extra.scopes[c] ?? 0), 0);
  }

  /** The study queue of a scope, with Anki's counts and what the "finished" screen says. */
  async function queueOf(scope: DeckScope, data = studyData()) {
    const notes = await notesIn(scope, data.notes);
    const lesson = scope.startsWith("lesson:");
    const faces: QueueFace[] = notes.flatMap((note, position) =>
      cards
        .facesOf(note)
        .filter((face, _, all) => !lesson || face === lessonFace(all))
        .map((face) => {
          const row = data.states.get(`${note.id}:${face}`);
          return {
            cardId: note.id,
            face,
            position,
            state: cards.stateOf(row),
            suspended: !!note.suspended || !!row?.suspended,
            buriedUntil: row?.buriedUntil ?? null,
          };
        }),
    );
    const done = data.today.used(new Set(notes.map((n) => n.id)));
    // More new cards today raise the review limit as much, so they are not held back by it.
    const extra = extraNew(scope, data.notes);
    const result = studyQueue(faces, {
      now: data.t,
      nextDay: dayOf(data.t).next,
      newIgnoresReviewLimit: settings.value("srs.newIgnoresReviewLimit"),
      learningSteps: params().learningSteps,
      relearningSteps: params().relearningSteps,
      newPerDay: (settings.get("srs.newPerDay") ?? SRS_DEFAULTS.newPerDay) + extra,
      reviewsPerDay: (settings.get("srs.reviewsPerDay") ?? SRS_DEFAULTS.reviewsPerDay) + extra,
      newToday: done.fresh,
      reviewsToday: done.reviews,
      allNew: lesson,
    });
    return { ...result, notes, states: data.states, now: data.t, today: data.today };
  }

  /** The `review` run of the learner's day: the active one if it began today, else a new one. */
  function reviewRun() {
    const active = store.active("review", null);
    if (active && active.startedAt >= dayOf(now()).start) return active.id;
    return store.replace("review", null, { status: "finished", reason: "completed" }).id;
  }

  return {
    reviewRun,

    /** Adds `count` new cards to today's limit of a deck (Anki: Custom Study → increase today's new
     *  card limit). */
    learnMore(scope: DeckScope, count: number) {
      const today = dayOf(now()).start;
      const stored = settings.get("srs.extraNew");
      const scopes = stored?.day === today ? { ...stored.scopes } : {};
      scopes[scope] = Math.min((scopes[scope] ?? 0) + count, 9999);
      settings.set("srs.extraNew", { day: today, scopes });
    },

    /** Decks: each language the cards teach, and under it each course with its language pairs (the
     *  editions its cards translate into: `ru-de`), with Anki's three counts. */
    async decks() {
      const data = studyData();
      const out = [];
      for (const lang of [...new Set(data.notes.map((n) => n.lang))].sort()) {
        const own: Note[] = data.notes.filter((n) => n.lang === lang);
        const courses = [];
        for (const course of [...new Set(own.map((n) => n.course))].sort())
          courses.push({
            scope: `course:${course}`,
            course,
            editions: [
              ...new Set(own.filter((n) => n.course === course).map((n) => n.translationLang)),
            ]
              .sort()
              .map((from) => `${from}-${lang}`),
            counts: (await queueOf(`course:${course}`, data)).counts,
          });
        out.push({
          scope: `lang:${lang}`,
          language: lang,
          counts: (await queueOf(`lang:${lang}`, data)).counts,
          courses,
        });
      }
      return out;
    },

    /** What to study now in a scope: the current card with its display and due times, the counts,
     *  and when it is finished, why (Anki's congratulations screen). */
    async study(scope: DeckScope) {
      const q = await queueOf(scope);
      const undone = q.today.justUndone;
      const entry =
        q.queue.find((e) => e.cardId === undone?.cardId && e.face === undone.face) ?? q.queue[0];
      const note = entry && q.notes.find((n) => n.id === entry.cardId);
      const face = entry && q.states.get(`${entry.cardId}:${entry.face}`);
      const state = cards.stateOf(face);
      const inScope = new Set(q.notes.map((n) => n.id));
      return {
        /** The server's time: the due times are relative to it. */
        now: q.now,
        counts: q.counts,
        /** About how many answers finish the scope today if each is Good (changes with each answer),
         *  and how many were given today: the session's progress. */
        answersLeft: q.answersLeft,
        answeredToday: q.today.answers.filter((a) => inScope.has(a.cardId)).length,
        current:
          entry && note
            ? {
                cardId: entry.cardId,
                face: entry.face,
                kind: entry.kind,
                display: note.display,
                /** The language the word is in (its lexeme's). */
                lang: note.lang,
                due: intervals(state, q.now, `${entry.cardId}:${entry.face}`, params()),
                /** Reviews of the face so far: sent back with the rating (`rate`). */
                reps: state?.reps ?? 0,
                leech: isLeech(state),
                flag: face?.flag ?? 0,
                marked: !!note.marked,
              }
            : null,
        nextLearning: q.nextLearning ?? null,
        newWaiting: q.newWaiting,
        reviewsWaiting: q.reviewsWaiting,
        buried: q.buried,
        /** Today has an answer in this deck to take back. */
        canUndo: q.today.answers.some((a) => inScope.has(a.cardId)),
      };
    },

    /**
     * Rates a face: its new state and the review event are written together. The client names the
     * event (`id`) and says how many reviews the face had when it was shown (`reps`): a rating sent
     * again is not applied twice, and a face rated meanwhile elsewhere (another device) is refused.
     */
    rate(
      cardId: string,
      face: CardFace,
      rating: CardRating,
      answer: { id: string; reps: number },
      deviceId?: string,
    ) {
      cards.checkFace(cards.note(cardId), face);
      return store.atomic(() => {
        const sent = store.event(answer.id);
        if (sent) {
          if (sent.type !== "card_review" || sent.cardId !== cardId)
            throw new ServiceError("event_id_taken", 409);
          return sent.payload.stateAfter;
        }
        const before = cards.stateOf(cards.states([cardId]).get(`${cardId}:${face}`)) ?? null;
        if ((before?.reps ?? 0) !== answer.reps) throw new ServiceError("card_changed", 409);
        const after = review(before, rating, now(), `${cardId}:${face}`, params());
        store.append(
          reviewRun(),
          [
            {
              id: answer.id,
              type: "card_review",
              cardId,
              payload: { face, rating, stateBefore: before, stateAfter: after },
            },
          ],
          { deviceId },
        );
        cards.setFace(cardId, face, { fsrsJson: JSON.stringify(after), dueAt: after.due });
        return after;
      });
    },

    /** Takes back today's latest review in the deck being studied not taken back yet (one of another
     *  deck is not this one's to take back, nor shown here): the face is as before it and is shown next
     *  (Anki: undo). It is its face's latest review too — a face is in the decks its note is in. */
    async undo(scope: DeckScope) {
      const inScope = new Set((await notesIn(scope)).map((n) => n.id));
      const last = day().answers.find((a) => inScope.has(a.cardId));
      if (!last) throw new ServiceError("nothing_to_undo", 409);
      const before = last.review.stateBefore;
      store.atomic(() => {
        store.append(reviewRun(), [
          { type: "card_undo", cardId: last.cardId, payload: { review: last.id } },
        ]);
        cards.setFace(last.cardId, last.face, {
          fsrsJson: before ? JSON.stringify(before) : null,
          dueAt: before?.due ?? null,
        });
      });
      return { cardId: last.cardId, face: last.face };
    },

    /** Hides a face — or every face of the note — until the next day (Anki: bury card / note). */
    bury(cardId: string, face?: CardFace) {
      const note = cards.note(cardId);
      const { next } = dayOf(now());
      for (const f of face ? [face] : cards.facesOf(note)) {
        cards.checkFace(note, f);
        cards.setFace(cardId, f, { buriedUntil: next });
      }
    },

    /** Brings back the buried faces of a deck (Anki: Unbury on the deck's overview). */
    async unbury(scope: DeckScope) {
      cards.unbury((await notesIn(scope)).map((n) => n.id));
    },

    /** Suspends or restores a face, or the whole note (Anki: suspend card / note). */
    suspend(cardId: string, suspended: boolean, face?: CardFace) {
      const note = cards.note(cardId);
      if (!face) return void cards.setNote(cardId, { suspended: suspended ? 1 : 0 });
      cards.checkFace(note, face);
      cards.setFace(cardId, face, { suspended: suspended ? 1 : 0 });
    },

    /** Sets a face's flag, 0 (none) to 7 (Anki: Ctrl+1…7). */
    flag(cardId: string, face: CardFace, flag: number) {
      cards.checkFace(cards.note(cardId), face);
      cards.setFace(cardId, face, { flag });
    },

    /** Marks or unmarks the note (Anki: `*`). */
    mark(cardId: string, marked: boolean) {
      cards.note(cardId);
      cards.setNote(cardId, { marked: marked ? 1 : 0 });
    },
  };
}
export type Study = ReturnType<typeof createStudy>;
