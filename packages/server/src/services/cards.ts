// Cards and review as in Anki (04, "Spaced repetition"; 05). A card is a note (one per lexeme, reused
// when the word is met again) whose faces are Anki's cards; decks are the courses the words were met in,
// under the language they teach. Study follows Anki's queue (engine `studyQueue`): each rating is a
// `card_review` event in the day's `review` run written together with the face's state; undo, bury,
// suspend, flag and mark as in Anki's reviewer.
import {
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
  CardReviewPayload,
  type CardUndoPayload,
  FaceState,
  type LessonKey,
  parseLessonKey,
  seriesOf,
} from "@sprachanker/schema";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { monotonicFactory } from "ulid";
import type { ProfileDb } from "../db/profile/db.ts";
import { cardState, cards, events, runs } from "../db/profile/schema.ts";
import { ServiceError } from "../errors.ts";
import type { Content } from "./content.ts";
import type { Settings } from "./settings.ts";

const DEFAULT_FACES: CardFace[] = ["recognition", "production"];

/**
 * What to study: every deck, a language (`lang:de`), a course (`course:<course key>`), or a lesson's own
 * words (`lesson:<lesson key>`: their first card type only, without the day's new limit).
 */
export type DeckScope = string;

type CardRow = typeof cards.$inferSelect;
type StateRow = typeof cardState.$inferSelect;

/** The language a card's words are in ("lex:de:…" → de). */
const languageOf = (row: CardRow) => row.lexemeKey?.split(":")[1] ?? "";

export function createCards(deps: {
  db: ProfileDb;
  content: Content;
  settings: Settings;
  now: () => number;
  appVersion: string;
}) {
  const { db, content, settings, now } = deps;
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
  async function notesIn(scope: DeckScope) {
    const all = db.select().from(cards).orderBy(asc(cards.createdAt), asc(cards.id)).all();
    if (scope.startsWith("lang:")) return all.filter((r) => languageOf(r) === scope.slice(5));
    if (scope.startsWith("course:")) return all.filter((r) => courseOf(r) === scope.slice(7));
    if (scope.startsWith("lesson:")) {
      const lessonKey = scope.slice(7) as LessonKey;
      const lesson = await content.lesson(seriesOf(lessonKey), lessonKey);
      const lexemes = new Set<string>(lesson.vocab.map((v) => v.lexeme));
      return all.filter((r) => r.lexemeKey && lexemes.has(r.lexemeKey));
    }
    return all;
  }

  /** Today's card events, newest first, and the reviews taken back among them. */
  function todaysEvents() {
    const { start } = studyDay(now());
    const rows = db
      .select()
      .from(events)
      .where(and(inArray(events.type, ["card_review", "card_undo"]), gte(events.ts, start)))
      .orderBy(desc(events.ts), desc(events.id))
      .all();
    const undone = new Set(
      rows
        .filter((r) => r.type === "card_undo")
        .map((r) => (JSON.parse(r.payloadJson) as CardUndoPayload).review),
    );
    return { rows, undone };
  }

  /** Today's answers in a deck (undone ones left out): new faces introduced and review faces answered.
   *  Each deck counts its own, as Anki's limits are the deck's: German does not use up English. */
  function today(cardIds: Set<string>) {
    const { rows, undone } = todaysEvents();
    let fresh = 0;
    let reviews = 0;
    for (const r of rows) {
      if (r.type !== "card_review" || undone.has(r.id) || !cardIds.has(r.cardId ?? "")) continue;
      const p = CardReviewPayload.parse(JSON.parse(r.payloadJson));
      if (!p.stateBefore) fresh++;
      else if (p.stateBefore.state === 2) reviews++;
    }
    return { fresh, reviews };
  }

  /** The face whose answer was just taken back, when nothing was answered since (Anki shows it next). */
  function justUndone({ rows }: ReturnType<typeof todaysEvents>) {
    const latest = rows[0];
    if (latest?.type !== "card_undo") return undefined;
    const review = (JSON.parse(latest.payloadJson) as CardUndoPayload).review;
    const row = rows.find((r) => r.id === review);
    return row && `${row.cardId}:${CardReviewPayload.parse(JSON.parse(row.payloadJson)).face}`;
  }

  /** The study queue of a scope, with Anki's counts and what the "finished" screen says. */
  async function queueOf(scope: DeckScope) {
    const t = now();
    const notes = await notesIn(scope);
    const states = stateRows(notes.map((n) => n.id));
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
    const done = today(new Set(notes.map((n) => n.id)));
    const result = studyQueue(faces, {
      now: t,
      nextDay: studyDay(t).next,
      newPerDay: settings.get("srs.newPerDay") ?? SRS_DEFAULTS.newPerDay,
      reviewsPerDay: settings.get("srs.reviewsPerDay") ?? SRS_DEFAULTS.reviewsPerDay,
      newToday: done.fresh,
      reviewsToday: done.reviews,
      allNew: lesson,
    });
    return { ...result, notes, states, now: t };
  }

  /** The `review` run of the learner's day: the active one if it began today, else a new one. */
  function reviewRun() {
    const { start } = studyDay(now());
    const active = db
      .select()
      .from(runs)
      .where(and(eq(runs.kind, "review"), eq(runs.status, "active")))
      .orderBy(desc(runs.startedAt))
      .get();
    if (active && active.startedAt >= start) return active.id;
    if (active)
      db.update(runs)
        .set({ status: "finished", endReason: "completed", finishedAt: now() })
        .where(eq(runs.id, active.id))
        .run();
    const runId = id(now());
    db.insert(runs)
      .values({
        id: runId,
        kind: "review",
        appVersion: deps.appVersion,
        status: "active",
        startedAt: now(),
      })
      .run();
    return runId;
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
      const all = db.select().from(cards).all();
      const languages = [...new Set(all.map(languageOf))].sort();
      const out = [];
      for (const lang of languages) {
        const courses = [
          ...new Set(all.filter((r) => languageOf(r) === lang).map(courseOf)),
        ].sort();
        const children = [];
        for (const course of courses)
          children.push({
            scope: `course:${course}`,
            course,
            counts: (await queueOf(`course:${course}`)).counts,
          });
        out.push({
          scope: `lang:${lang}`,
          language: lang,
          counts: (await queueOf(`lang:${lang}`)).counts,
          courses: children,
        });
      }
      return out;
    },

    /** What to study now in a scope: the current card with its display and due times, the counts,
     *  and when it is finished, why (Anki's congratulations screen). */
    async study(scope: DeckScope) {
      const q = await queueOf(scope);
      const day = todaysEvents();
      const undone = justUndone(day);
      const entry = q.queue.find((e) => `${e.cardId}:${e.face}` === undone) ?? q.queue[0];
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
        canUndo: day.rows.some((r) => r.type === "card_review" && !day.undone.has(r.id)),
      };
    },

    /**
     * Rates a face: its new state and the review event are written together. The client names the
     * event (`id`) and says how many reviews the face had when it was shown (`reps`): a rating sent
     * again is not applied twice, and a face rated meanwhile elsewhere (another device) is refused.
     */
    rate(cardId: string, face: CardFace, rating: CardRating, answer: { id: string; reps: number }) {
      checkFace(note(cardId), face);
      return db.transaction((tx) => {
        const sent = tx.select().from(events).where(eq(events.id, answer.id)).get();
        if (sent) {
          if (sent.type !== "card_review" || sent.cardId !== cardId)
            throw new ServiceError("event_id_taken", 409);
          return CardReviewPayload.parse(JSON.parse(sent.payloadJson)).stateAfter;
        }
        const t = now();
        const before = stateOf(stateRows([cardId]).get(`${cardId}:${face}`)) ?? null;
        if ((before?.reps ?? 0) !== answer.reps) throw new ServiceError("card_changed", 409);
        const after = review(before, rating, t, retention());
        const payload: CardReviewPayload = { face, rating, stateBefore: before, stateAfter: after };
        tx.insert(events)
          .values({
            id: answer.id,
            runId: reviewRun(),
            ts: t,
            type: "card_review",
            cardId,
            payloadJson: JSON.stringify(payload),
          })
          .run();
        tx.insert(cardState)
          .values({ cardId, face, fsrsJson: JSON.stringify(after), dueAt: after.due })
          .onConflictDoUpdate({
            target: [cardState.cardId, cardState.face],
            set: { fsrsJson: JSON.stringify(after), dueAt: after.due },
          })
          .run();
        return after;
      });
    },

    /** Takes back today's latest review not taken back yet: the face is as before it and is shown next
     *  (Anki: undo). */
    undo() {
      const { rows, undone } = todaysEvents();
      const last = rows.find((r) => r.type === "card_review" && !undone.has(r.id));
      if (!last?.cardId) throw new ServiceError("nothing_to_undo", 409);
      const p = CardReviewPayload.parse(JSON.parse(last.payloadJson));
      const t = now();
      db.transaction((tx) => {
        tx.insert(events)
          .values({
            id: id(t),
            runId: last.runId,
            ts: t,
            type: "card_undo",
            cardId: last.cardId,
            payloadJson: JSON.stringify({ review: last.id } satisfies CardUndoPayload),
          })
          .run();
        tx.update(cardState)
          .set({
            fsrsJson: p.stateBefore ? JSON.stringify(p.stateBefore) : null,
            dueAt: p.stateBefore?.due ?? null,
          })
          .where(and(eq(cardState.cardId, last.cardId as string), eq(cardState.face, p.face)))
          .run();
      });
      return { cardId: last.cardId, face: p.face };
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
