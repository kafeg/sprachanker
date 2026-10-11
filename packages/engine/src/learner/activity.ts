// A learner's study days (04, "Learner model"; 09, Notebook): what each day held, read from the event
// log and counted by module (schema `stats.ts`) — lesson work (answers, skips, steps), exam answers,
// card reviews (an answer taken back does not count), new cards learnt, how many reviewed cards were
// remembered, and AI practice (the learner's messages and the model's checks, in whichever run) —, the
// time each module took, and the totals of a span of days. Pure: the caller passes the events, the
// day boundary and each run's module.
import {
  type DayActivity,
  type EventType,
  MODULES,
  type ModuleId,
  type TypedEvent,
} from "@sprachanker/schema";
import { undoneReviews } from "../srs/day.ts";
import { answerMs } from "../srs/index.ts";
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
  time: { lesson: 0, exam: 0, review: 0, ai: 0 },
});

/** The longest pause between two events counted in full: away longer, up to a session break, the
 *  learner is counted this much (a long page read, a long answer written). */
export const IDLE_MS = 5 * 60_000;
/** A pause longer than this ends a session: the event after it starts a new one, the pause counts
 *  none. */
export const BREAK_MS = 30 * 60_000;

/** A pause's time spent: in full up to `IDLE_MS`, `IDLE_MS` up to a session break, none past it. */
export const pauseMs = (gap: number) => (gap <= IDLE_MS ? gap : gap <= BREAK_MS ? IDLE_MS : 0);

/** An event as time is read from it: which one, its run, when it was stored and how long after the
 *  event before it — of any run, so runs open together (a lesson and its tutor chat, two tabs) are
 *  one timeline (null: the first event). */
export interface Moment {
  id: string;
  runId: string;
  ts: number;
  gap: number | null;
}

/** The study days with something done, oldest first. `moduleOf`: the module of the run an event is in
 *  (by its kind, `MODULE_OF_KIND`) — a lesson's work and an exam's answers are told apart by it; the
 *  model's checks and the learner's messages are AI practice in whichever run they are.
 *  Time spent, read from one timeline of every event (`moments`), each pause counted once, on the
 *  later event's day: up to a card answer, the answer's own time (`ms`, measured from shown to rated,
 *  at most a minute; none before it was measured), never more than the pause; up to any other event,
 *  the pause (`pauseMs`) in its run's module — a page read, an exercise answered, a chat's reply
 *  waited for and the next message written. A review run's other events (an answer taken back) count
 *  none. */
export function activityByDay(
  events: TypedEvent[],
  dayOf: (ts: number) => number,
  moduleOf: (runId: string) => ModuleId | undefined,
  moments: ReadonlyArray<Moment> = [],
): DayActivity[] {
  const undone = undoneReviews(events);
  const days = new Map<number, DayActivity>();
  const at = (ts: number) => {
    const start = dayOf(ts);
    const day = days.get(start) ?? empty(start);
    days.set(start, day);
    return day;
  };
  /** Card answers' own time, by event. */
  const answered = new Map<string, number>();
  for (const e of events) {
    if (e.type === "llm_verdict" || (e.type === "llm_turn" && e.payload.role === "user"))
      at(e.ts).ai++;
    else if (e.type === "card_review" && !undone.has(e.id)) {
      const p = e.payload;
      const day = at(e.ts);
      day.review++;
      if (p.ms) answered.set(e.id, answerMs(p.ms));
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
  for (const m of moments) {
    const answer = answered.get(m.id);
    if (answer !== undefined) {
      const ms = Math.min(answer, m.gap ?? answer);
      if (ms > 0) at(m.ts).time.review += ms;
      continue;
    }
    const module = moduleOf(m.runId);
    const ms = m.gap === null ? 0 : pauseMs(m.gap);
    if (module && module !== "review" && ms > 0) at(m.ts).time[module] += ms;
  }
  return [...days.values()].sort((a, b) => a.start - b.start);
}

/** A day's time spent, every module's together (ms). */
export const dayTime = (day: Pick<DayActivity, "time">) =>
  MODULES.reduce((n, m) => n + day.time[m], 0);

/** The totals of the days from `from` on, before `to` (all of them without them). */
export function activityTotals(
  days: DayActivity[],
  from = Number.NEGATIVE_INFINITY,
  to = Number.POSITIVE_INFINITY,
) {
  const span = days.filter((d) => d.start >= from && d.start < to);
  const sum = (key: keyof Omit<DayActivity, "start" | "time">) =>
    span.reduce((n, d) => n + d[key], 0);
  const recalled = sum("recalled");
  return {
    activeDays: span.filter((d) => MODULES.some((m) => d[m] > 0)).length,
    lesson: sum("lesson"),
    exam: sum("exam"),
    review: sum("review"),
    newCards: sum("newCards"),
    ai: sum("ai"),
    /** Answers to cards in review: what the share remembered is of. */
    recalled,
    /** The share of reviewed cards remembered; undefined without any. */
    remembered: recalled ? sum("remembered") / recalled : undefined,
    /** Time spent by module (ms), and all of it. */
    time: Object.fromEntries(
      MODULES.map((m) => [m, span.reduce((n, d) => n + d.time[m], 0)]),
    ) as DayActivity["time"],
    timeAll: span.reduce((n, d) => n + dayTime(d), 0),
  };
}
