// A deck's standing for the Notebook (04, "Spaced repetition"; 09): its words by state as My words
// counts them, those whose every face is due no sooner than three weeks ("mature", as Anki says), the
// faces due today, by tomorrow and within a week, and the answers of the last 30 days with the share
// of reviewed cards remembered.
import type { FaceState } from "@sprachanker/schema";
import type { CardAnswer } from "./day.ts";
import { type Stage, wordState } from "./index.ts";
import { inReview, isNew } from "./state.ts";

/** Anki's mature cards: scheduled three weeks or more ahead. */
const MATURE_DAYS = 21;
const DAY = 86_400_000;

export interface DeckWord {
  suspended: boolean;
  /** Its faces' states (an unanswered face has none); suspended faces are left out of what is due. */
  faces: Array<{ state?: FaceState; suspended: boolean }>;
}

export function deckStanding(
  words: DeckWord[],
  /** The deck's answers not taken back (`cardDay`). */
  answers: CardAnswer[],
  /** The start of today's study day. */
  today: number,
) {
  const counts: Record<Stage | "mature" | "suspended", number> = {
    new: 0,
    learning: 0,
    review: 0,
    mature: 0,
    suspended: 0,
  };
  const due = { today: 0, tomorrow: 0, week: 0 };
  for (const w of words) {
    if (w.suspended) {
      counts.suspended++;
      continue;
    }
    const states = w.faces.flatMap((f) => (f.state ? [f.state] : []));
    const stage = wordState(Object.fromEntries(states.map((s, i) => [i, s])));
    const mature =
      stage === "review" &&
      states.length === w.faces.length &&
      states.every((s) => s.scheduledDays >= MATURE_DAYS);
    counts[mature ? "mature" : stage]++;
    for (const f of w.faces) {
      if (!f.state || f.suspended || isNew(f.state)) continue;
      if (f.state.due < today + DAY) due.today++;
      if (f.state.due < today + 2 * DAY) due.tomorrow++;
      if (f.state.due < today + 7 * DAY) due.week++;
    }
  }
  // The last 30 study days, today's included.
  const month = answers.filter((a) => a.ts >= today - 29 * DAY);
  const recalled = month.filter((a) => inReview(a.review.stateBefore));
  return {
    words: counts,
    due,
    /** The last 30 days: answers, and the share of reviewed cards remembered. */
    answers: month.length,
    remembered: recalled.length
      ? recalled.filter((a) => a.review.rating > 1).length / recalled.length
      : undefined,
  };
}
