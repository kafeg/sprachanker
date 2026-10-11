// Spaced repetition as in Anki (04, "Spaced repetition"): FSRS scheduling of each card face via
// ts-fsrs (learning steps 1m 10m, relearning 10m, fuzz), and Anki's study queue — learning cards first,
// then reviews mixed with new cards within the day's limits, learning cards up to 20 minutes early when
// nothing else is left. Pure: the caller passes the time and the day's boundaries.
import { CardFace, type CardRating, type FaceState, SETTING_DEFAULTS } from "@sprachanker/schema";
import {
  type AbstractScheduler,
  type Card,
  createEmptyCard,
  fsrs,
  type Grade,
  type StepUnit,
  StrategyMode,
} from "ts-fsrs";
import { inReview, isFirstLearning, isLearning, isNew } from "./state.ts";

/** The defaults: the Review settings as a profile reads them unset (schema `SETTING_DEFAULTS`), and
 *  the scheduler's own. */
export const SRS_DEFAULTS = {
  newPerDay: SETTING_DEFAULTS["srs.newPerDay"],
  reviewsPerDay: SETTING_DEFAULTS["srs.reviewsPerDay"],
  retention: SETTING_DEFAULTS["srs.retention"],
  /** Learning steps of a new face and relearning steps of a forgotten one (not set by the learner). */
  learningSteps: ["1m", "10m"] as readonly StepUnit[],
  relearningSteps: ["10m"] as readonly StepUnit[],
  /** The hour the learner's day starts. */
  dayStartHour: 4,
  /** Learning cards are shown this early when nothing else is due. */
  learnAheadMs: 20 * 60_000,
  /** A card forgotten this many times is a leech. */
  leechLapses: 8,
  /** The longest an answer counts as taking (Anki's "maximum answer seconds"). */
  maxAnswerMs: 60_000,
} as const;

/** How long a face was on screen before it was rated, as kept: at most a minute, so a card left open
 *  in an idle tab counts a minute, not hours (Anki's cap). */
export const answerMs = (ms: number) =>
  Math.min(Math.max(0, Math.round(ms)), SRS_DEFAULTS.maxAnswerMs);
/** A face's place among a note's card types (schema `CardFace`: recognition is card 1). */
const faceOrder = (face: CardFace) => CardFace.options.indexOf(face);

/** The face a lesson's "Words" step studies a card by: recognition, or the card's first face in
 *  order when the learner's cards have none (04). */
export const lessonFace = (faces: CardFace[]): CardFace | undefined =>
  [...faces].sort((a, b) => faceOrder(a) - faceOrder(b))[0];

/** The profile's scheduling options (its Review settings), the defaults where unset. */
export interface SrsParams {
  retention?: number;
}

/**
 * The scheduler for one face. Its fuzz is seeded by the face (`seed`, e.g. "<card id>:<face>") and
 * its review count, as Anki seeds it by card: the interval a button shows is the one the answer gets,
 * whenever the learner answers.
 */
const scheduler = (params: SrsParams, seed: string) =>
  fsrs({
    request_retention: params.retention ?? SRS_DEFAULTS.retention,
    enable_fuzz: true,
    learning_steps: [...SRS_DEFAULTS.learningSteps],
    relearning_steps: [...SRS_DEFAULTS.relearningSteps],
  }).useStrategy(StrategyMode.SEED, function (this: AbstractScheduler) {
    // ts-fsrs keeps the card being scheduled in a protected field (as its own id strategy reads it).
    return `${seed}_${(Reflect.get(this, "current") as Card).reps}`;
  });

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

/** A face's state after a rating; a face never reviewed starts new. `seed` names the face. */
export function review(
  state: FaceState | undefined | null,
  rating: CardRating,
  now: number,
  seed: string,
  params: SrsParams = {},
): FaceState {
  const card = state ? toCard(state) : createEmptyCard(new Date(now));
  return fromCard(scheduler(params, seed).next(card, new Date(now), rating as Grade).card);
}

/** Due times by rating: again, hard, good, easy. */
type Intervals = Record<1 | 2 | 3 | 4, number>;

/** When the face would be due after each rating (shown above the answer buttons). */
export function intervals(
  state: FaceState | undefined | null,
  now: number,
  seed: string,
  params: SrsParams = {},
): Intervals {
  const at = (rating: CardRating) => review(state, rating, now, seed, params).due;
  return { 1: at(1), 2: at(2), 3: at(3), 4: at(4) };
}

/**
 * An interval as Anki writes it above the answer buttons: seconds, minutes and days whole, hours,
 * months and years with one decimal; "<" before an interval under the 20-minute learn-ahead limit
 * ("<1m", "<10m", "4d", "1.2mo"). `units` are the localised unit letters, `number` writes a number
 * (the language's digits and decimal sign).
 */
export function intervalText(
  ms: number,
  units: Record<"s" | "m" | "h" | "d" | "mo" | "y", string>,
  number: (n: number) => string = String,
) {
  const s = Math.max(0, ms / 1000);
  const less = ms < SRS_DEFAULTS.learnAheadMs ? "<" : "";
  const one = (n: number) => number(Math.round(n * 10) / 10);
  if (s < 60) return `${less}${number(Math.round(s))}${units.s}`;
  if (s < 3600) return `${less}${number(Math.round(s / 60))}${units.m}`;
  if (s < 86_400) return `${one(s / 3600)}${units.h}`;
  const days = s / 86_400;
  if (days < 365 / 12) return `${number(Math.round(days))}${units.d}`;
  if (days < 365) return `${one(days / (365 / 12))}${units.mo}`;
  return `${one(days / 365)}${units.y}`;
}

/** How long until a face is due: null when it has no due date (new, suspended), 0 when it is due. */
export const dueIn = (due: number | null | undefined, now: number) =>
  due === null || due === undefined ? null : Math.max(0, due - now);

/** The start of the learner's day for a moment, and of the next one (local time, 4 AM). */
export function studyDay(now: number) {
  const hour = SRS_DEFAULTS.dayStartHour;
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

interface QueueEntry {
  cardId: string;
  face: CardFace;
  kind: "new" | "learning" | "review";
  due: number;
}

interface QueueLimits {
  now: number;
  /** When the learner's next day starts (reviews due before it are due today). */
  nextDay: number;
  newPerDay?: number;
  reviewsPerDay?: number;
  /** New faces introduced and review faces answered today. */
  newToday?: number;
  reviewsToday?: number;
  /** No daily limit on new faces (a lesson's own words, as Anki's custom study adds new cards). */
  allNew?: boolean;
}

/** Answers a face still needs today if each is Good: a new face goes through every learning step, a
 *  (re)learning face through the steps it has left, a review is one answer. */
function answersToGo(state: FaceState | null | undefined): number {
  const learning = SRS_DEFAULTS.learningSteps;
  if (isNew(state)) return Math.max(1, learning.length);
  if (!state || inReview(state)) return 1;
  const steps = isFirstLearning(state) ? learning : SRS_DEFAULTS.relearningSteps;
  return Math.max(1, steps.length - state.learningSteps);
}

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
    .filter((f) => inReview(f.state) && f.state.due < nextDay)
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
  const fresh = active
    .filter((f) => isNew(f.state))
    .sort((a, b) => a.position - b.position || faceOrder(a.face) - faceOrder(b.face))
    .slice(0, newLeft)
    .sort((a, b) => faceOrder(a.face) - faceOrder(b.face) || a.position - b.position)
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
    newWaiting: active.filter((f) => isNew(f.state)).length > fresh.length,
    /** Reviews due today held back by the review limit. */
    reviewsWaiting:
      active.filter((f) => inReview(f.state) && f.state.due < nextDay).length > reviews.length,
    buried: faces.filter((f) => f.buriedUntil && f.buriedUntil > now).length,
    /** About how many answers finish the day's study, if each is Good: changes as the learner answers
     *  (Again adds steps back). Learning faces due later today count too. */
    answersLeft: [
      ...fresh.map(() => answersToGo(undefined)),
      ...reviews.map(() => 1),
      ...active
        .filter((f) => f.state && isLearning(f.state) && f.state.due < nextDay)
        .map((f) => answersToGo(f.state)),
    ].reduce((sum, n) => sum + n, 0),
  };
}

export type Stage = "new" | "learning" | "review";

/** A face as Anki counts it: new (never answered), learning (learning or relearning), or review. */
export const faceStage = (state: FaceState | null | undefined): Stage =>
  isNew(state) ? "new" : inReview(state) ? "review" : "learning";

/** A word as the learner's words show it (04, "Lexeme state"): new until a face is answered, learning
 *  while a face is (re)learning, else review. */
export function wordState(states: Partial<Record<CardFace, FaceState>>): Stage {
  const stages = Object.values(states).map(faceStage);
  if (stages.includes("learning")) return "learning";
  return stages.includes("review") ? "review" : "new";
}

/** A leech: a face forgotten 8 times (Anki tags it; the learner decides what to do). */
export const isLeech = (state: FaceState | null | undefined) =>
  (state?.lapses ?? 0) >= SRS_DEFAULTS.leechLapses;
