// A learner's study days (04, "Learner model"; 09, Notebook): what each day held, read from the event
// log and counted by module (schema `stats.ts`) — lesson work (answers, skips, steps), exam answers,
// card reviews (an answer taken back does not count), new cards learnt, how many reviewed cards were
// remembered, and AI practice (the learner's messages and the model's checks, in whichever run) — and
// the totals of a span of days. Pure: the caller passes the events, the day boundary and each run's
// module.
import {
  type DayActivity,
  type EventType,
  MODULES,
  type ModuleId,
  type TypedEvent,
} from "@sprachanker/schema";
import { undoneReviews } from "../srs/day.ts";
import { inReview } from "../srs/state.ts";

/** What counts as work done in a lesson run: an answer, a skip, a step of the plan (words, a page read,
 *  practice). A run without any is only a lesson opened. An exam run's work is its answers. */
export const LESSON_WORK = ["answered", "item_skipped", "step_done"] as const satisfies EventType[];
const WORK = new Set<string>(LESSON_WORK);

/** The events a learner's days are read from. */
export const ACTIVITY_EVENTS = [
  ...LESSON_WORK,
  "card_review",
  "card_undo",
  "llm_turn",
  "llm_verdict",
] as const satisfies EventType[];

const empty = (start: number): DayActivity => ({
  start,
  lesson: 0,
  exam: 0,
  review: 0,
  ai: 0,
  newCards: 0,
  recalled: 0,
  remembered: 0,
});

/** The study days with something done, oldest first. `moduleOf`: the module of the run an event is in
 *  (by its kind, `MODULE_OF_KIND`) — a lesson's work and an exam's answers are told apart by it; the
 *  model's checks and the learner's messages are AI practice in whichever run they are. */
export function activityByDay(
  events: TypedEvent[],
  dayOf: (ts: number) => number,
  moduleOf: (runId: string) => ModuleId | undefined,
): DayActivity[] {
  const undone = undoneReviews(events);
  const days = new Map<number, DayActivity>();
  const at = (ts: number) => {
    const start = dayOf(ts);
    const day = days.get(start) ?? empty(start);
    days.set(start, day);
    return day;
  };
  for (const e of events) {
    if (e.type === "llm_verdict" || (e.type === "llm_turn" && e.payload.role === "user"))
      at(e.ts).ai++;
    else if (e.type === "card_review" && !undone.has(e.id)) {
      const p = e.payload;
      const day = at(e.ts);
      day.review++;
      if (!p.stateBefore) day.newCards++;
      else if (inReview(p.stateBefore)) {
        day.recalled++;
        if (p.rating > 1) day.remembered++;
      }
    } else if (WORK.has(e.type)) {
      const module = moduleOf(e.runId);
      if (module === "lesson") at(e.ts).lesson++;
      else if (module === "exam" && e.type === "answered") at(e.ts).exam++;
    }
  }
  return [...days.values()].sort((a, b) => a.start - b.start);
}

/** The totals of the days from `from` on (all of them without it). */
export function activityTotals(days: DayActivity[], from = Number.NEGATIVE_INFINITY) {
  const span = days.filter((d) => d.start >= from);
  const sum = (key: keyof Omit<DayActivity, "start">) => span.reduce((n, d) => n + d[key], 0);
  const recalled = sum("recalled");
  return {
    activeDays: span.filter((d) => MODULES.some((m) => d[m] > 0)).length,
    lesson: sum("lesson"),
    exam: sum("exam"),
    review: sum("review"),
    newCards: sum("newCards"),
    ai: sum("ai"),
    /** The share of reviewed cards remembered; undefined without any. */
    remembered: recalled ? sum("remembered") / recalled : undefined,
  };
}
