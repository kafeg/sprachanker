// Study as in Anki (04, "Spaced repetition"): decks are the courses the words were met in, under the
// language they teach; the queue is the engine's `studyQueue` with Anki's limits and day; each rating is
// a `card_review` event in the day's `review` run, written together with the face's state; undo, bury,
// suspend, flag and mark as in Anki's reviewer.
import {
  type CardEvent,
  cardDay,
  intervals,
  isLeech,
  type QueueFace,
  review,
  SRS_DEFAULTS,
  studyDay,
  studyQueue,
} from "@sprachanker/engine";
import {
  type CardFace,
  type CardRating,
  type CardReviewPayload,
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
 * first card type only, without the day's new limit; a word answered Good or Easy today is done there).
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
  const retention = () => settings.get("srs.retention") ?? SRS_DEFAULTS.retention;

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
      since: studyDay(now()).start,
    });
    return cardDay(events as CardEvent[]);
  }

  /** What a queue is built from, read once for any number of decks. */
  const studyData = () => ({ t: now(), notes: cards.all(), states: cards.states(), today: day() });

  /** The study queue of a scope, with Anki's counts and what the "finished" screen says. */
  async function queueOf(scope: DeckScope, data = studyData()) {
    const notes = await notesIn(scope, data.notes);
    const lesson = scope.startsWith("lesson:");
    const faces: QueueFace[] = notes.flatMap((note, position) =>
      cards
        .facesOf(note)
        .filter((face) => !lesson || face === "recognition")
        .map((face) => {
          const row = data.states.get(`${note.id}:${face}`);
          return {
            cardId: note.id,
            face,
            position,
            state: cards.stateOf(row),
            suspended: !!note.suspended || !!row?.suspended,
            buriedUntil: row?.buriedUntil ?? null,
            passedToday: lesson && data.today.passed(note.id, face),
          };
        }),
    );
    const done = data.today.used(new Set(notes.map((n) => n.id)));
    const result = studyQueue(faces, {
      now: data.t,
      nextDay: studyDay(data.t).next,
      newPerDay: settings.get("srs.newPerDay") ?? SRS_DEFAULTS.newPerDay,
      reviewsPerDay: settings.get("srs.reviewsPerDay") ?? SRS_DEFAULTS.reviewsPerDay,
      newToday: done.fresh,
      reviewsToday: done.reviews,
      lessonWords: lesson,
    });
    return { ...result, notes, states: data.states, now: data.t, today: data.today };
  }

  /** The `review` run of the learner's day: the active one if it began today, else a new one. */
  function reviewRun() {
    const active = store.active("review", null);
    if (active && active.startedAt >= studyDay(now()).start) return active.id;
    return store.replace("review", null, { status: "finished", reason: "completed" }).id;
  }

  return {
    /** Decks: each language the cards teach, and under it each course, with Anki's three counts. */
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
      return {
        /** The server's time: the due times are relative to it. */
        now: q.now,
        counts: q.counts,
        current:
          entry && note
            ? {
                cardId: entry.cardId,
                face: entry.face,
                kind: entry.kind,
                display: note.display,
                due: intervals(state, q.now, `${entry.cardId}:${entry.face}`, retention()),
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
        /** Today has an answer to take back. */
        canUndo: !!q.today.undoable,
      };
    },

    /**
     * Rates a face: its new state and the review event are written together. The client names the
     * event (`id`) and says how many reviews the face had when it was shown (`reps`): a rating sent
     * again is not applied twice, and a face rated meanwhile elsewhere (another device) is refused.
     */
    rate(cardId: string, face: CardFace, rating: CardRating, answer: { id: string; reps: number }) {
      cards.checkFace(cards.note(cardId), face);
      return store.atomic(() => {
        const sent = store.event(answer.id);
        if (sent) {
          if (sent.type !== "card_review" || sent.cardId !== cardId)
            throw new ServiceError("event_id_taken", 409);
          return (sent.payload as CardReviewPayload).stateAfter;
        }
        const before = cards.stateOf(cards.states([cardId]).get(`${cardId}:${face}`)) ?? null;
        if ((before?.reps ?? 0) !== answer.reps) throw new ServiceError("card_changed", 409);
        const after = review(before, rating, now(), `${cardId}:${face}`, retention());
        store.append(reviewRun(), [
          {
            id: answer.id,
            type: "card_review",
            cardId,
            payload: { face, rating, stateBefore: before, stateAfter: after },
          },
        ]);
        cards.setFace(cardId, face, { fsrsJson: JSON.stringify(after), dueAt: after.due });
        return after;
      });
    },

    /** Takes back today's latest review not taken back yet: the face is as before it and is shown next
     *  (Anki: undo). */
    undo() {
      const last = day().undoable;
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
      const { next } = studyDay(now());
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
