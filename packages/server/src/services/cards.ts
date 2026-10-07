// Cards and review as in Anki (04, "Spaced repetition"; 05). A card is a note (one per lexeme, reused
// when the word is met again) whose faces are Anki's cards; decks are the courses the words were met in,
// under the language they teach. Study follows Anki's queue (engine `studyQueue`): each rating is a
// `card_review` event in the day's `review` run written together with the face's state; undo, bury,
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
  wordState,
} from "@sprachanker/engine";
import {
  CardDisplay,
  type CardFace,
  type CardRating,
  type CardReviewPayload,
  FaceState,
  type LessonKey,
  type LexemeKey,
  parseLessonKey,
  parseLexemeKey,
  seriesOf,
} from "@sprachanker/schema";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { monotonicFactory } from "ulid";
import type { ProfileDb } from "../db/profile/db.ts";
import { cardState, cards } from "../db/profile/schema.ts";
import { ServiceError } from "../errors.ts";
import type { Content } from "./content.ts";
import type { RunStore } from "./run-store.ts";
import type { Settings } from "./settings.ts";

const DEFAULT_FACES: CardFace[] = ["recognition", "production"];

/**
 * What to study: every deck, a language (`lang:de`), a course (`course:<course key>`), or a lesson's own
 * words (`lesson:<lesson key>`: their first card type only, without the day's new limit).
 */
export type DeckScope = string;

type CardRow = typeof cards.$inferSelect;
type StateRow = typeof cardState.$inferSelect;

/** The language a card's words are in. */
const languageOf = (row: CardRow) =>
  row.lexemeKey ? parseLexemeKey(row.lexemeKey as LexemeKey).lang : "";

export function createCards(deps: {
  db: ProfileDb;
  store: RunStore;
  content: Content;
  settings: Settings;
  now: () => number;
}) {
  const { db, store, content, settings, now } = deps;
  // Monotonic: cards made in one call keep the order of the lesson's words.
  const id = monotonicFactory();
  const retention = () => settings.get("srs.retention") ?? SRS_DEFAULTS.retention;
  const facesOf = (row: CardRow) => row.faces.split(",") as CardFace[];
  const displayOf = (row: CardRow) => CardDisplay.parse(JSON.parse(row.displayCacheJson ?? "{}"));
  const courseOf = (row: CardRow) => parseLessonKey(displayOf(row).lessonKey).course;
  const stateOf = (row: StateRow | undefined) =>
    row?.fsrsJson ? FaceState.parse(JSON.parse(row.fsrsJson)) : undefined;

  const stateRows = (cardIds?: string[]) => {
    const out = new Map<string, StateRow>();
    for (const r of db
      .select()
      .from(cardState)
      .where(cardIds ? inArray(cardState.cardId, cardIds) : undefined)
      .all())
      out.set(`${r.cardId}:${r.face}`, r);
    return out;
  };

  /** The notes in a scope, in the order they were made (their position in the deck). */
  async function notesIn(scope: DeckScope, all = allNotes()) {
    if (scope.startsWith("lang:")) return all.filter((r) => languageOf(r) === scope.slice(5));
    if (scope.startsWith("course:")) return all.filter((r) => r.course === scope.slice(7));
    if (scope.startsWith("lesson:")) {
      const lessonKey = scope.slice(7) as LessonKey;
      const lesson = await content.lesson(seriesOf(lessonKey), lessonKey);
      const lexemes = new Set<string>(lesson.vocab.map((v) => v.lexeme));
      return all.filter((r) => r.lexemeKey && lexemes.has(r.lexemeKey));
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

  /** Every note in the order it was made, with its course read once. */
  const allNotes = () =>
    db
      .select()
      .from(cards)
      .orderBy(asc(cards.createdAt), asc(cards.id))
      .all()
      .map((row) => Object.assign(row, { course: courseOf(row) }));

  /** What a queue is built from, read once for any number of decks. */
  const studyData = () => ({
    t: now(),
    notes: allNotes(),
    states: stateRows(),
    today: day(),
  });

  /** The study queue of a scope, with Anki's counts and what the "finished" screen says. */
  async function queueOf(scope: DeckScope, data = studyData()) {
    const t = data.t;
    const notes = await notesIn(scope, data.notes);
    const states = data.states;
    const lesson = scope.startsWith("lesson:");
    const faces: QueueFace[] = notes.flatMap((note, position) =>
      facesOf(note)
        .filter((face) => !lesson || face === "recognition")
        .map((face) => {
          const row = states.get(`${note.id}:${face}`);
          return {
            cardId: note.id,
            face,
            position,
            state: stateOf(row),
            suspended: !!note.suspended || !!row?.suspended,
            buriedUntil: row?.buriedUntil ?? null,
          };
        }),
    );
    const done = data.today.used(new Set(notes.map((n) => n.id)));
    const result = studyQueue(faces, {
      now: t,
      nextDay: studyDay(t).next,
      newPerDay: settings.get("srs.newPerDay") ?? SRS_DEFAULTS.newPerDay,
      reviewsPerDay: settings.get("srs.reviewsPerDay") ?? SRS_DEFAULTS.reviewsPerDay,
      newToday: done.fresh,
      reviewsToday: done.reviews,
      allNew: lesson,
    });
    return { ...result, notes, states, now: t, today: data.today };
  }

  /** The `review` run of the learner's day: the active one if it began today, else a new one. */
  function reviewRun() {
    const active = store.active("review", null);
    if (active && active.startedAt >= studyDay(now()).start) return active.id;
    if (active) store.end(active.id, "finished", "completed");
    return store.start("review", null).id;
  }

  const note = (cardId: string) => {
    const row = db.select().from(cards).where(eq(cards.id, cardId)).get();
    if (!row) throw new ServiceError("no_such_card", 404);
    return row;
  };
  /** Sets fields of a face's row, made when the face has none yet (a new face). */
  const setFace = (cardId: string, face: CardFace, values: Partial<StateRow>) =>
    db
      .insert(cardState)
      .values({ cardId, face, ...values })
      .onConflictDoUpdate({ target: [cardState.cardId, cardState.face], set: values })
      .run();
  const checkFace = (row: CardRow, face: CardFace) => {
    if (!facesOf(row).includes(face)) throw new ServiceError("no_such_card", 404);
  };

  return {
    /** Makes cards of a lesson's words: one per lexeme; a word met before keeps its card. */
    async fromLesson(request: { series: string; lessonKey: LessonKey; edition: string }) {
      const [lesson, locale] = await Promise.all([
        content.lesson(request.series, request.lessonKey),
        content.localeLesson(request.series, request.lessonKey, request.edition),
      ]);
      const faces = (settings.get("srs.faces") ?? DEFAULT_FACES).join(",");
      let created = 0;
      db.transaction((tx) => {
        for (const v of lesson.vocab) {
          if (tx.select().from(cards).where(eq(cards.lexemeKey, v.lexeme)).get()) continue;
          const display: CardDisplay = {
            target: v.target,
            ...(v.gender && { gender: v.gender }),
            ...(v.plural && { plural: v.plural }),
            ...(locale?.vocab[v.key]?.translation && {
              translation: locale.vocab[v.key]?.translation,
            }),
            ...(v.examples?.[0] && { example: v.examples[0] }),
            ...(v.audio && { audio: v.audio }),
            series: request.series,
            lessonKey: request.lessonKey,
          };
          tx.insert(cards)
            .values({
              id: id(now()),
              kind: "lexeme",
              lexemeKey: v.lexeme,
              sourceKey: v.key,
              faces,
              displayCacheJson: JSON.stringify(display),
              createdAt: now(),
            })
            .run();
          created++;
        }
      });
      return { created };
    },

    /** Decks: each language the cards teach, and under it each course, with Anki's three counts. */
    async decks() {
      const data = studyData();
      const languages = [...new Set(data.notes.map(languageOf))].sort();
      const out = [];
      for (const lang of languages) {
        const courses = [
          ...new Set(data.notes.filter((r) => languageOf(r) === lang).map((r) => r.course)),
        ].sort();
        const children = [];
        for (const course of courses)
          children.push({
            scope: `course:${course}`,
            course,
            counts: (await queueOf(`course:${course}`, data)).counts,
          });
        out.push({
          scope: `lang:${lang}`,
          language: lang,
          counts: (await queueOf(`lang:${lang}`, data)).counts,
          courses: children,
        });
      }
      return out;
    },

    /** What to study now in a scope: the current card with its display and due times, the counts,
     *  and when it is finished, why (Anki's congratulations screen). */
    async study(scope: DeckScope) {
      const q = await queueOf(scope);
      const today = q.today;
      const undone = today.justUndone;
      const entry =
        q.queue.find((e) => e.cardId === undone?.cardId && e.face === undone.face) ?? q.queue[0];
      const row = entry && q.notes.find((n) => n.id === entry.cardId);
      const face = entry && q.states.get(`${entry.cardId}:${entry.face}`);
      const state = stateOf(face);
      return {
        /** The server's time: the due times are relative to it. */
        now: q.now,
        counts: q.counts,
        current:
          entry && row
            ? {
                cardId: entry.cardId,
                face: entry.face,
                kind: entry.kind,
                display: displayOf(row),
                due: intervals(state, q.now, retention()),
                /** Reviews of the face so far: sent back with the rating (`rate`). */
                reps: state?.reps ?? 0,
                leech: isLeech(state),
                flag: face?.flag ?? 0,
                marked: !!row.marked,
              }
            : null,
        nextLearning: q.nextLearning ?? null,
        newWaiting: q.newWaiting,
        reviewsWaiting: q.reviewsWaiting,
        buried: q.buried,
        /** Today has an answer to take back. */
        canUndo: !!today.undoable,
      };
    },

    /**
     * Rates a face: its new state and the review event are written together. The client names the
     * event (`id`) and says how many reviews the face had when it was shown (`reps`): a rating sent
     * again is not applied twice, and a face rated meanwhile elsewhere (another device) is refused.
     */
    rate(cardId: string, face: CardFace, rating: CardRating, answer: { id: string; reps: number }) {
      checkFace(note(cardId), face);
      return store.atomic(() => {
        const sent = store.event(answer.id);
        if (sent) {
          if (sent.type !== "card_review" || sent.cardId !== cardId)
            throw new ServiceError("event_id_taken", 409);
          return (sent.payload as CardReviewPayload).stateAfter;
        }
        const t = now();
        const before = stateOf(stateRows([cardId]).get(`${cardId}:${face}`)) ?? null;
        if ((before?.reps ?? 0) !== answer.reps) throw new ServiceError("card_changed", 409);
        const after = review(before, rating, t, retention());
        store.append(reviewRun(), [
          {
            id: answer.id,
            type: "card_review",
            cardId,
            payload: { face, rating, stateBefore: before, stateAfter: after },
          },
        ]);
        setFace(cardId, face, { fsrsJson: JSON.stringify(after), dueAt: after.due });
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
        setFace(last.cardId, last.face, {
          fsrsJson: before ? JSON.stringify(before) : null,
          dueAt: before?.due ?? null,
        });
      });
      return { cardId: last.cardId, face: last.face };
    },

    /** Hides a face — or every face of the note — until the next day (Anki: bury card / note). */
    bury(cardId: string, face?: CardFace) {
      const row = note(cardId);
      const { next } = studyDay(now());
      for (const f of face ? [face] : facesOf(row)) {
        checkFace(row, f);
        setFace(cardId, f, { buriedUntil: next });
      }
    },

    /** Brings back the buried faces of a deck (Anki: Unbury on the deck's overview). */
    async unbury(scope: DeckScope) {
      const ids = (await notesIn(scope)).map((n) => n.id);
      db.update(cardState).set({ buriedUntil: null }).where(inArray(cardState.cardId, ids)).run();
    },

    /** Suspends or restores a face, or the whole note (Anki: suspend card / note). */
    suspend(cardId: string, suspended: boolean, face?: CardFace) {
      const row = note(cardId);
      if (!face) {
        db.update(cards)
          .set({ suspended: suspended ? 1 : 0 })
          .where(eq(cards.id, cardId))
          .run();
        return;
      }
      checkFace(row, face);
      setFace(cardId, face, { suspended: suspended ? 1 : 0 });
    },

    /** Sets a face's flag, 0 (none) to 7 (Anki: Ctrl+1…7). */
    flag(cardId: string, face: CardFace, flag: number) {
      checkFace(note(cardId), face);
      setFace(cardId, face, { flag });
    },

    /** Marks or unmarks the note (Anki: `*`). */
    mark(cardId: string, marked: boolean) {
      note(cardId);
      db.update(cards)
        .set({ marked: marked ? 1 : 0 })
        .where(eq(cards.id, cardId))
        .run();
    },

    /** The learner's words, newest first, with their state and when they are next due. */
    words() {
      const rows = db.select().from(cards).orderBy(desc(cards.createdAt), desc(cards.id)).all();
      const states = stateRows();
      return rows.map((r) => {
        const byFace: Partial<Record<CardFace, FaceState>> = {};
        for (const f of facesOf(r)) {
          const s = stateOf(states.get(`${r.id}:${f}`));
          if (s) byFace[f] = s;
        }
        const dues = Object.values(byFace).map((f) => f.due);
        return {
          cardId: r.id,
          lexemeKey: r.lexemeKey,
          display: displayOf(r),
          course: courseOf(r),
          suspended: !!r.suspended,
          marked: !!r.marked,
          state: wordState(byFace),
          due: dues.length ? Math.min(...dues) : null,
        };
      });
    },
  };
}
export type Cards = ReturnType<typeof createCards>;
