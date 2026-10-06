// Spaced repetition (04, "Spaced repetition"): FSRS scheduling of card faces via ts-fsrs, and the review
// queue — due faces first, then new ones within the day's limit, at most one face of a card per day.
// Pure: the caller passes the time and the start of the learner's day.
import type { CardFace, CardRating, FaceState } from "@sprachanker/schema";
import { type Card, createEmptyCard, fsrs, type Grade } from "ts-fsrs";

/** Desired retention by default (a profile setting, 04). */
export const DEFAULT_RETENTION = 0.9;
/** New faces a day by default: beginner-friendly (04). */
export const DEFAULT_NEW_PER_DAY = 10;
/** Stability from which a word counts as in long-term memory (04, "Lexeme state"). */
export const LONG_TERM_DAYS = 21;
/** The order new faces of a card are introduced in. */
export const FACE_ORDER: CardFace[] = ["recognition", "production", "listening"];

const scheduler = (retention: number) => fsrs({ request_retention: retention });

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

/** A face's state after a review; a face never reviewed starts empty. */
export function review(
  state: FaceState | undefined,
  rating: CardRating,
  now: number,
  retention = DEFAULT_RETENTION,
): FaceState {
  const card = state ? toCard(state) : createEmptyCard(new Date(now));
  return fromCard(scheduler(retention).next(card, new Date(now), rating as Grade).card);
}

/** Due times by rating: again, hard, good, easy. */
export type Intervals = Record<1 | 2 | 3 | 4, number>;

/** When the face would be due again after each rating (for the rating buttons). */
export function intervals(
  state: FaceState | undefined,
  now: number,
  retention = DEFAULT_RETENTION,
): Intervals {
  const at = (rating: CardRating) => review(state, rating, now, retention).due;
  return { 1: at(1), 2: at(2), 3: at(3), 4: at(4) };
}

export interface QueueCard {
  id: string;
  faces: CardFace[];
  suspended: boolean;
  createdAt: number;
  /** Stored states by face; a face without one was never reviewed. */
  states: Partial<Record<CardFace, FaceState>>;
  /** The face reviewed today, if any (a card shows one face a day). */
  reviewedToday?: CardFace;
}

export interface QueueEntry {
  cardId: string;
  face: CardFace;
  /** Never reviewed: counts against the day's new limit. */
  isNew: boolean;
  due: number;
}

/**
 * The faces to review now, due ones first (most overdue first), then new ones in the order the cards
 * were made, as many as the day still allows (`newPerDay` minus `newToday` already introduced).
 * A card reviewed today offers only that face again (after "again" it comes back the same day); a
 * card's next face is introduced once the faces before it are in review.
 */
export function reviewQueue(
  cards: QueueCard[],
  {
    now,
    newPerDay = DEFAULT_NEW_PER_DAY,
    newToday = 0,
  }: {
    now: number;
    newPerDay?: number;
    newToday?: number;
  },
): QueueEntry[] {
  const due: QueueEntry[] = [];
  const fresh: QueueEntry[] = [];
  for (const card of [...cards].sort((a, b) => a.createdAt - b.createdAt)) {
    if (card.suspended) continue;
    const faces = FACE_ORDER.filter(
      (f) => card.faces.includes(f) && (!card.reviewedToday || card.reviewedToday === f),
    );
    const dueFaces = faces
      .flatMap((face) => {
        const s = card.states[face];
        return s && s.due <= now ? [{ face, due: s.due }] : [];
      })
      .sort((a, b) => a.due - b.due);
    const first = dueFaces[0];
    if (first) {
      due.push({ cardId: card.id, face: first.face, isNew: false, due: first.due });
      continue;
    }
    // A new face only on a day the card has shown nothing yet, and once the face before it has left
    // learning (recognition before production before listening).
    const next = card.reviewedToday
      ? undefined
      : faces.find((f, i) => {
          if (card.states[f]) return false;
          const before = faces.slice(0, i).map((b) => card.states[b]);
          return before.every((b) => b && b.state === 2);
        });
    if (next) fresh.push({ cardId: card.id, face: next, isNew: true, due: card.createdAt });
  }
  due.sort((a, b) => a.due - b.due);
  return [...due, ...fresh.slice(0, Math.max(0, newPerDay - newToday))];
}

/** How far a word is: never reviewed, learning, or in long-term memory (stability ≥ 21 days on a face). */
export function wordState(
  states: Partial<Record<CardFace, FaceState>>,
): "new" | "learning" | "long_term" {
  const list = Object.values(states);
  if (!list.length) return "new";
  return list.some((s) => s.stability >= LONG_TERM_DAYS) ? "long_term" : "learning";
}
