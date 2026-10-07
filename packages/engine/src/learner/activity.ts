// A learner's study days (04, "Learner model"; 09, Notebook): what each day held, read from the event
// log — lesson work (answers, skips, steps), card reviews (an answer taken back does not count), new
// cards learnt, how many reviewed cards were remembered, and AI practice (the learner's messages and
// checks) — and the totals of a span of days. Pure: the caller passes the events and the day boundary.
import type { EventType } from "@sprachanker/schema";

export interface ActivityEvent {
  id: string;
  ts: number;
  type: string;
  payload: unknown;
}

export interface DayActivity {
  /** When the study day starts. */
  start: number;
  /** Exercise answers, skips and steps done in lessons. */
  lesson: number;
  /** Card answers not taken back. */
  review: number;
  /** Faces answered for the first time (new cards learnt). */
  newCards: number;
  /** Answers to faces already in review, and of them those not "Again" (remembered). */
  recalled: number;
  remembered: number;
  /** The learner's messages to the tutor and scenes, and the model's checks asked for. */
  ai: number;
}

/** What counts as work done in a lesson run: an answer, a skip, a step of the plan (words, a page read,
 *  practice). A run without any is only a lesson opened. */
export const LESSON_WORK = ["answered", "item_skipped", "step_done"] as const satisfies EventType[];
const LESSON = new Set<string>(LESSON_WORK);

/** The events a learner's days are read from. */
export const ACTIVITY_EVENTS = [
  ...LESSON_WORK,
  "card_review",
  "card_undo",
  "llm_turn",
  "llm_verdict",
] as const satisfies EventType[];

export function activityByDay(
  events: ActivityEvent[],
  dayOf: (ts: number) => number,
): DayActivity[] {
  const undone = new Set(
    events.flatMap((e) =>
      e.type === "card_undo" ? [(e.payload as { review?: string }).review ?? ""] : [],
    ),
  );
  const days = new Map<number, DayActivity>();
  const at = (ts: number) => {
    const start = dayOf(ts);
    let day = days.get(start);
    if (!day) {
      day = { start, lesson: 0, review: 0, newCards: 0, recalled: 0, remembered: 0, ai: 0 };
      days.set(start, day);
    }
    return day;
  };
  for (const e of events) {
    if (LESSON.has(e.type)) at(e.ts).lesson++;
    else if (e.type === "card_review" && !undone.has(e.id)) {
      const p = e.payload as { rating: number; stateBefore: { state: number } | null };
      const day = at(e.ts);
      day.review++;
      if (!p.stateBefore) day.newCards++;
      else if (p.stateBefore.state === 2) {
        day.recalled++;
        if (p.rating > 1) day.remembered++;
      }
    } else if (e.type === "llm_verdict") at(e.ts).ai++;
    else if (e.type === "llm_turn" && (e.payload as { role?: string }).role === "user")
      at(e.ts).ai++;
  }
  return [...days.values()].sort((a, b) => a.start - b.start);
}

/** The totals of the days from `from` on (all of them without it). */
export function activityTotals(days: DayActivity[], from = Number.NEGATIVE_INFINITY) {
  const span = days.filter((d) => d.start >= from);
  const sum = (key: keyof Omit<DayActivity, "start">) => span.reduce((n, d) => n + d[key], 0);
  const recalled = sum("recalled");
  return {
    activeDays: span.filter((d) => d.lesson + d.review + d.ai > 0).length,
    lesson: sum("lesson"),
    review: sum("review"),
    newCards: sum("newCards"),
    ai: sum("ai"),
    /** The share of reviewed cards remembered; undefined without any. */
    remembered: recalled ? sum("remembered") / recalled : undefined,
  };
}
