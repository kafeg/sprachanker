// Cards and review (04, "Spaced repetition"; 05): cards made from a lesson's words — one per lexeme,
// reused when the word is met again — the review queue by FSRS, each rating stored as a `card_review`
// event in the day's `review` run together with the face's state, and the learner's words.
import {
  DEFAULT_NEW_PER_DAY,
  DEFAULT_RETENTION,
  intervals,
  type QueueCard,
  review,
  reviewQueue,
  wordState,
} from "@sprachanker/engine";
import {
  CardDisplay,
  type CardFace,
  type CardRating,
  type CardReviewPayload,
  FaceState,
  type LessonKey,
  parseLessonKey,
} from "@sprachanker/schema";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { monotonicFactory } from "ulid";
import type { ProfileDb } from "../db/profile/db.ts";
import { cardState, cards, events, runs } from "../db/profile/schema.ts";
import type { Content } from "./content.ts";
import type { Settings } from "./settings.ts";

/** Profile settings of the review (04): new faces a day, desired retention, faces of a new card. */
export const SRS_SETTINGS = {
  newPerDay: "srs.newPerDay",
  retention: "srs.retention",
  faces: "srs.faces",
} as const;
const DEFAULT_FACES: CardFace[] = ["recognition", "production"];

/** The start of the learner's day: local midnight on this machine. */
const localDayStart = (now: number) => new Date(now).setHours(0, 0, 0, 0);

export class CardError extends Error {}

export function createCards(deps: {
  db: ProfileDb;
  content: Content;
  settings: Settings;
  now: () => number;
  dayStart?: (now: number) => number;
  appVersion: string;
}) {
  const { db, content, settings, now } = deps;
  const dayStart = deps.dayStart ?? localDayStart;
  // Monotonic: cards made in one call keep the order of the lesson's words.
  const id = monotonicFactory();
  const newPerDay = () => settings.get<number>(SRS_SETTINGS.newPerDay) ?? DEFAULT_NEW_PER_DAY;
  const retention = () => settings.get<number>(SRS_SETTINGS.retention) ?? DEFAULT_RETENTION;

  const facesOf = (row: { faces: string }) => row.faces.split(",") as CardFace[];
  const displayOf = (row: { displayCacheJson: string | null }) =>
    CardDisplay.parse(JSON.parse(row.displayCacheJson ?? "{}"));

  /** Stored face states, by card. */
  function states(cardIds?: string[]) {
    const out = new Map<string, Partial<Record<CardFace, FaceState>>>();
    const rows = db
      .select()
      .from(cardState)
      .where(cardIds ? inArray(cardState.cardId, cardIds) : undefined)
      .all();
    for (const r of rows) {
      const byFace = out.get(r.cardId) ?? {};
      byFace[r.face as CardFace] = FaceState.parse(JSON.parse(r.fsrsJson));
      out.set(r.cardId, byFace);
    }
    return out;
  }

  /** Today's reviews: the face each card showed (the latest), and how many faces were new. */
  function today() {
    const since = dayStart(now());
    const rows = db
      .select({ cardId: events.cardId, payload: events.payloadJson })
      .from(events)
      .where(and(eq(events.type, "card_review"), gte(events.ts, since)))
      .orderBy(events.ts, events.id)
      .all();
    const faces = new Map<string, CardFace>();
    let fresh = 0;
    for (const r of rows) {
      const p = JSON.parse(r.payload) as CardReviewPayload;
      if (r.cardId) faces.set(r.cardId, p.face);
      if (p.stateBefore === null) fresh++;
    }
    return { faces, fresh };
  }

  /** The `review` run of today: the active one if it began today, else a new one (the old ends). */
  function reviewRun() {
    const active = db
      .select()
      .from(runs)
      .where(and(eq(runs.kind, "review"), eq(runs.status, "active")))
      .orderBy(desc(runs.startedAt))
      .get();
    if (active && active.startedAt >= dayStart(now())) return active.id;
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

  return {
    /**
     * Makes cards of a lesson's words (the lesson's "Words" step): one per lexeme, a word met before
     * keeps its card. Words the learner marks as known are suspended ("already known", 04).
     */
    async fromLesson(request: {
      series: string;
      lessonKey: LessonKey;
      edition: string;
      known: string[];
    }) {
      const [lesson, locale] = await Promise.all([
        content.lesson(request.series, request.lessonKey),
        content.localeLesson(request.series, request.lessonKey, request.edition),
      ]);
      const known = new Set(request.known);
      const faces = (settings.get<CardFace[]>(SRS_SETTINGS.faces) ?? DEFAULT_FACES).join(",");
      let created = 0;
      db.transaction((tx) => {
        for (const v of lesson.vocab) {
          const existing = tx.select().from(cards).where(eq(cards.lexemeKey, v.lexeme)).get();
          if (existing) {
            if (known.has(v.lexeme) && !existing.suspended)
              tx.update(cards).set({ suspended: 1 }).where(eq(cards.id, existing.id)).run();
            continue;
          }
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
              suspended: known.has(v.lexeme) ? 1 : 0,
              createdAt: now(),
            })
            .run();
          created++;
        }
      });
      return { created };
    },

    /** The lesson's words that have cards (made here or in an earlier lesson), by lexeme: suspended or
     *  not, and their state. */
    async lesson(series: string, lessonKey: LessonKey) {
      const lexemes = (await content.lesson(series, lessonKey)).vocab.map((v) => v.lexeme);
      const rows = lexemes.length
        ? db.select().from(cards).where(inArray(cards.lexemeKey, lexemes)).all()
        : [];
      const byCard = states(rows.map((r) => r.id));
      return Object.fromEntries(
        rows.map((r) => [
          r.lexemeKey,
          { cardId: r.id, suspended: !!r.suspended, state: wordState(byCard.get(r.id) ?? {}) },
        ]),
      );
    },

    /** What to review now: the faces in order, with what the card shows and the next due times. */
    queue() {
      const t = now();
      const rows = db.select().from(cards).where(eq(cards.suspended, 0)).all();
      const byCard = states(rows.map((r) => r.id));
      const { faces: shownToday, fresh } = today();
      const queueCards: QueueCard[] = rows.map((r) => ({
        id: r.id,
        faces: facesOf(r),
        suspended: false,
        createdAt: r.createdAt,
        states: byCard.get(r.id) ?? {},
        reviewedToday: shownToday.get(r.id),
      }));
      const limit = newPerDay();
      const entries = reviewQueue(queueCards, { now: t, newPerDay: limit, newToday: fresh });
      const rowById = new Map(rows.map((r) => [r.id, r]));
      return {
        newPerDay: limit,
        newToday: fresh,
        items: entries.map((e) => {
          const row = rowById.get(e.cardId) as (typeof rows)[number];
          const state = byCard.get(e.cardId)?.[e.face];
          return {
            cardId: e.cardId,
            face: e.face,
            isNew: e.isNew,
            display: displayOf(row),
            due: intervals(state, t, retention()),
          };
        }),
      };
    },

    /** Rates a face: its new state and the review event are written together. */
    rate(cardId: string, face: CardFace, rating: CardRating) {
      const row = db.select().from(cards).where(eq(cards.id, cardId)).get();
      if (!row || !facesOf(row).includes(face)) throw new CardError("no_such_card");
      const t = now();
      const before = states([cardId]).get(cardId)?.[face] ?? null;
      const after = review(before ?? undefined, rating, t, retention());
      const payload: CardReviewPayload = { face, rating, stateBefore: before, stateAfter: after };
      const runId = reviewRun();
      db.transaction((tx) => {
        tx.insert(events)
          .values({
            id: id(t),
            runId,
            ts: t,
            type: "card_review",
            cardId,
            payloadJson: JSON.stringify(payload),
          })
          .run();
        const fsrsJson = JSON.stringify(after);
        tx.insert(cardState)
          .values({ cardId, face, fsrsJson, dueAt: after.due })
          .onConflictDoUpdate({
            target: [cardState.cardId, cardState.face],
            set: { fsrsJson, dueAt: after.due },
          })
          .run();
      });
      return after;
    },

    /** The learner's words, newest first, with their state and when they are next due. */
    words() {
      const rows = db.select().from(cards).orderBy(desc(cards.createdAt), desc(cards.id)).all();
      const byCard = states();
      return rows.map((r) => {
        const s = byCard.get(r.id) ?? {};
        const dues = Object.values(s).map((f) => f.due);
        return {
          cardId: r.id,
          lexemeKey: r.lexemeKey,
          display: displayOf(r),
          course: parseLessonKey(displayOf(r).lessonKey).course,
          suspended: !!r.suspended,
          state: wordState(s),
          due: dues.length ? Math.min(...dues) : null,
        };
      });
    },

    /** "Already known" on or off. */
    setSuspended(cardId: string, suspended: boolean) {
      if (!db.select({ id: cards.id }).from(cards).where(eq(cards.id, cardId)).get())
        throw new CardError("no_such_card");
      db.update(cards)
        .set({ suspended: suspended ? 1 : 0 })
        .where(eq(cards.id, cardId))
        .run();
    },
  };
}
export type Cards = ReturnType<typeof createCards>;
