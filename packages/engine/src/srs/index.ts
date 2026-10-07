// Spaced repetition as in Anki (04, "Spaced repetition"): FSRS scheduling of each card face via
// ts-fsrs (learning steps 1m 10m, relearning 10m, fuzz), and Anki's study queue — learning cards first,
// then reviews mixed with new cards within the day's limits, learning cards up to 20 minutes early when
// nothing else is left. Pure: the caller passes the time and the day's boundaries.
import type { CardFace, CardRating, FaceState } from "@sprachanker/schema";
import { type Card, createEmptyCard, fsrs, type Grade } from "ts-fsrs";

/** Anki's defaults (deck options; desired retention for FSRS). */
export const SRS_DEFAULTS = {
  newPerDay: 20,
  reviewsPerDay: 200,
  retention: 0.9,
  /** The learner's day starts at 4 AM (Anki's "next day starts at"). */
  dayStartHour: 4,
  /** Learning cards are shown this early when nothing else is due. */
  learnAheadMs: 20 * 60_000,
  /** A card forgotten this many times is a leech. */
  leechLapses: 8,
} as const;
/** Stability from which a word counts as in long-term memory (04, "Lexeme state"). */
export const LONG_TERM_DAYS = 21;
/** A note's card types in order: recognition is card 1, production card 2, listening card 3. */
export const FACE_ORDER: CardFace[] = ["recognition", "production", "listening"];

const scheduler = (retention: number) => fsrs({ request_retention: retention, enable_fuzz: true });

const toCard = (s: FaceState): Card => ({
  due: new Date(s.due),
  stability: s.stability,
  difficulty: s.difficulty,
  elapsed_days: 0,
  scheduled_days: s.scheduledDays,
  learning_steps: s.learningSteps,
  reps: s.reps,
  lapses: s.lapses,
  state: s.state,
  last_review: s.lastReview === undefined ? undefined : new Date(s.lastReview),
});

const fromCard = (c: Card): FaceState => ({
  due: c.due.getTime(),
  stability: c.stability,
  difficulty: c.difficulty,
  scheduledDays: c.scheduled_days,
  learningSteps: c.learning_steps,
  reps: c.reps,
  lapses: c.lapses,
  state: c.state,
  ...(c.last_review ? { lastReview: c.last_review.getTime() } : {}),
});

/** A face's state after a rating; a face never reviewed starts new. */
export function review(
  state: FaceState | undefined | null,
  rating: CardRating,
  now: number,
  retention: number = SRS_DEFAULTS.retention,
): FaceState {
  const card = state ? toCard(state) : createEmptyCard(new Date(now));
  return fromCard(scheduler(retention).next(card, new Date(now), rating as Grade).card);
}

/** Due times by rating: again, hard, good, easy. */
export type Intervals = Record<1 | 2 | 3 | 4, number>;

/** When the face would be due after each rating (shown above the answer buttons). */
export function intervals(
  state: FaceState | undefined | null,
  now: number,
  retention: number = SRS_DEFAULTS.retention,
): Intervals {
  const at = (rating: CardRating) => review(state, rating, now, retention).due;
  return { 1: at(1), 2: at(2), 3: at(3), 4: at(4) };
}

/**
 * An interval as Anki writes it above the answer buttons: seconds, minutes and days whole, hours,
 * months and years with one decimal; "<" before an interval under the 20-minute learn-ahead limit
 * ("<1m", "<10m", "4d", "1.2mo"). `units` are the localised unit letters.
 */
export function intervalText(
  ms: number,
  units: Record<"s" | "m" | "h" | "d" | "mo" | "y", string>,
) {
  const s = Math.max(0, ms / 1000);
  const less = ms < SRS_DEFAULTS.learnAheadMs ? "<" : "";
  const one = (n: number) => (Math.round(n * 10) / 10).toString();
  if (s < 60) return `${less}${Math.round(s)}${units.s}`;
  if (s < 3600) return `${less}${Math.round(s / 60)}${units.m}`;
  if (s < 86_400) return `${one(s / 3600)}${units.h}`;
  const days = s / 86_400;
  if (days < 365 / 12) return `${Math.round(days)}${units.d}`;
  if (days < 365) return `${one(days / (365 / 12))}${units.mo}`;
  return `${one(days / 365)}${units.y}`;
}

/** The start of the learner's day for a moment, and of the next one (local time, 4 AM). */
export function studyDay(now: number, hour: number = SRS_DEFAULTS.dayStartHour) {
  const start = new Date(now);
  if (start.getHours() < hour) start.setDate(start.getDate() - 1);
  start.setHours(hour, 0, 0, 0);
  const next = new Date(start);
  next.setDate(next.getDate() + 1);
  return { start: start.getTime(), next: next.getTime() };
}

/** One face of a note (an Anki card) as the queue needs it. */
export interface QueueFace {
  cardId: string;
  face: CardFace;
  /** The note's place in its deck (the order new cards come in). */
  position: number;
  /** Never reviewed: undefined. */
  state?: FaceState | null;
  /** Suspended (this face or the whole note), or buried until a later day. */
  suspended?: boolean;
  buriedUntil?: number | null;
}

export interface QueueEntry {
  cardId: string;
  face: CardFace;
  kind: "new" | "learning" | "review";
  due: number;
}

export interface QueueLimits {
  now: number;
  /** When the learner's next day starts (reviews due before it are due today). */
  nextDay: number;
  newPerDay?: number;
  reviewsPerDay?: number;
  /** New faces introduced and review faces answered today. */
  newToday?: number;
  reviewsToday?: number;
  /** No daily limit on new faces (a lesson's own words). */
  allNew?: boolean;
}

const isLearning = (s: FaceState) => s.state === 1 || s.state === 3;
/** A stable order among cards due at the same time (Anki: "then random"). */
const shuffleKey = (id: string) => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
};

/**
 * The study queue and Anki's three counts. Learning cards due now come first; then reviews due today
 * (by due date, then a stable shuffle) mixed evenly with new cards (gathered by position and card type,
 * shown by card type: every card 1 before any card 2); when nothing else is left, learning cards due
 * within 20 minutes. New cards count against both daily limits (Anki: new cards do not ignore the
 * review limit).
 */
export function studyQueue(faces: QueueFace[], limits: QueueLimits) {
  const { now, nextDay } = limits;
  const active = faces.filter((f) => !f.suspended && !(f.buriedUntil && f.buriedUntil > now));
  const learningAll = active
    .filter((f) => f.state && isLearning(f.state))
    .map(
      (f): QueueEntry => ({
        cardId: f.cardId,
        face: f.face,
        kind: "learning",
        due: f.state?.due ?? now,
      }),
    )
    .sort((a, b) => a.due - b.due);
  const learningNow = learningAll.filter((e) => e.due <= now);
  const learningAhead = learningAll.filter(
    (e) => e.due > now && e.due <= now + SRS_DEFAULTS.learnAheadMs,
  );

  // New faces introduced today used the review limit too.
  const reviewsLeft = Math.max(
    0,
    (limits.reviewsPerDay ?? SRS_DEFAULTS.reviewsPerDay) -
      (limits.reviewsToday ?? 0) -
      (limits.newToday ?? 0),
  );
  const reviews = active
    .filter((f) => f.state?.state === 2 && f.state.due < nextDay)
    .map(
      (f): QueueEntry => ({
        cardId: f.cardId,
        face: f.face,
        kind: "review",
        due: f.state?.due ?? now,
      }),
    )
    .sort((a, b) => a.due - b.due || shuffleKey(a.cardId + a.face) - shuffleKey(b.cardId + b.face))
    .slice(0, reviewsLeft);

  const newLeft = limits.allNew
    ? Number.POSITIVE_INFINITY
    : Math.max(
        0,
        Math.min(
          (limits.newPerDay ?? SRS_DEFAULTS.newPerDay) - (limits.newToday ?? 0),
          reviewsLeft - reviews.length,
        ),
      );
  const order = (f: CardFace) => FACE_ORDER.indexOf(f);
  const fresh = active
    .filter((f) => !f.state)
    .sort((a, b) => a.position - b.position || order(a.face) - order(b.face))
    .slice(0, newLeft)
    .sort((a, b) => order(a.face) - order(b.face) || a.position - b.position)
    .map((f): QueueEntry => ({ cardId: f.cardId, face: f.face, kind: "new", due: now }));

  // Anki's "mix with reviews": new cards spread evenly among the reviews.
  const mixed: QueueEntry[] = [];
  const step = fresh.length ? (reviews.length + fresh.length) / fresh.length : 0;
  let r = 0;
  let n = 0;
  for (let i = 0; i < reviews.length + fresh.length; i++) {
    const takeNew = n < fresh.length && (r >= reviews.length || i + 1 >= (n + 1) * step);
    mixed.push(takeNew ? (fresh[n++] as QueueEntry) : (reviews[r++] as QueueEntry));
  }

  const queue = [...learningNow, ...mixed];
  return {
    queue: queue.length ? queue : learningAhead,
    counts: {
      new: fresh.length,
      learning: learningNow.length + learningAhead.length,
      review: reviews.length,
    },
    /** When the next learning card is due, if later today (the "finished for now" screen). */
    nextLearning: learningAll.find((e) => e.due > now)?.due,
    /** New faces left but held back by the day's limit. */
    newWaiting: active.filter((f) => !f.state).length > fresh.length,
    /** Reviews due today held back by the review limit. */
    reviewsWaiting:
      active.filter((f) => f.state?.state === 2 && f.state.due < nextDay).length > reviews.length,
    buried: faces.filter((f) => f.buriedUntil && f.buriedUntil > now).length,
  };
}

/** How far a word is: never reviewed, learning, or in long-term memory (stability ≥ 21 days on a face). */
export function wordState(
  states: Partial<Record<CardFace, FaceState>>,
): "new" | "learning" | "long_term" {
  const list = Object.values(states);
  if (!list.length) return "new";
  return list.some((s) => s.stability >= LONG_TERM_DAYS) ? "long_term" : "learning";
}

/** A leech: a face forgotten 8 times (Anki tags it; the learner decides what to do). */
export const isLeech = (state: FaceState | null | undefined) =>
  (state?.lapses ?? 0) >= SRS_DEFAULTS.leechLapses;
