// The learner's mistakes, derived from lesson runs (05, "Derived state"): items whose latest first
// attempt was wrong or partly right, newest first, with whether a later attempt got them right.
import { type ItemKey, lessonOf, parseItemKey } from "@sprachanker/schema";
import { and, desc, eq } from "drizzle-orm";
import type { ProfileDb } from "../db/profile/db.ts";
import { events, runs } from "../db/profile/schema.ts";

export interface Mistake {
  itemKey: ItemKey;
  lessonKey: string;
  exerciseKey: string;
  /** 0-based item index in the exercise. */
  index: number;
  /** The first (wrong) answer. */
  answer: unknown;
  result: "wrong" | "partial";
  /** A later attempt was correct. */
  fixed: boolean;
  ts: number;
}

interface Answered {
  answer: unknown;
  attempt: number;
  outcome: { result: string };
}

export function createMistakes(db: ProfileDb) {
  return {
    /** Mistakes in lessons, newest first: of all lessons or of one. */
    list(filter: { lesson?: string; limit?: number } = {}): Mistake[] {
      const rows = db
        .select({ itemKey: events.itemKey, ts: events.ts, payload: events.payloadJson })
        .from(events)
        .innerJoin(runs, eq(runs.id, events.runId))
        .where(and(eq(runs.kind, "lesson"), eq(events.type, "answered")))
        .orderBy(desc(events.ts))
        .all();
      const byItem = new Map<string, { first?: Answered & { ts: number }; latest?: Answered }>();
      for (const row of rows) {
        if (!row.itemKey) continue;
        const lesson = lessonOf(parseItemKey(row.itemKey as ItemKey).exercise);
        if (filter.lesson && lesson !== filter.lesson) continue;
        const answered = JSON.parse(row.payload) as Answered;
        const entry = byItem.get(row.itemKey) ?? {};
        // Rows come newest first: the first row seen is the latest answer, and the first attempt of the
        // latest run (a lesson done again counts afresh).
        entry.latest ??= answered;
        if (answered.attempt === 1) entry.first ??= { ...answered, ts: row.ts };
        byItem.set(row.itemKey, entry);
      }
      const out: Mistake[] = [];
      for (const [key, { first, latest }] of byItem) {
        const result = first?.outcome.result;
        if (!first || (result !== "wrong" && result !== "partial")) continue;
        const { exercise, n } = parseItemKey(key as ItemKey);
        out.push({
          itemKey: key as ItemKey,
          lessonKey: lessonOf(exercise),
          exerciseKey: exercise,
          index: n - 1,
          answer: first.answer,
          result,
          fixed: latest?.outcome.result === "correct",
          ts: first.ts,
        });
      }
      return out.sort((a, b) => b.ts - a.ts).slice(0, filter.limit ?? out.length);
    },
  };
}
export type Mistakes = ReturnType<typeof createMistakes>;
