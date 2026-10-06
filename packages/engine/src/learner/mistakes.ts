// The learner's mistakes (04, "Learner model"; 05, "Derived state"): items whose first attempt in the
// latest run that answered them was wrong or partly right, with whether a later answer got them right.
// "First attempt" is the run's first answer to the item — the same reading as the lesson score.
import { type ItemKey, lessonOf, parseItemKey, type StoredEvent } from "@sprachanker/schema";

export interface Mistake {
  itemKey: ItemKey;
  lessonKey: string;
  exerciseKey: string;
  /** 0-based item index in the exercise. */
  index: number;
  /** The first (wrong) answer. */
  answer: unknown;
  result: "wrong" | "partial";
  /** A later answer was correct. */
  fixed: boolean;
  /** When the first answer was given. */
  ts: number;
}

/** Mistakes over lesson runs given oldest first, each with its events in order (a lesson done again
 *  counts afresh); newest first. */
export function mistakesOf(runs: Array<{ events: StoredEvent[] }>): Mistake[] {
  const items = new Map<string, { first: StoredEvent; latest: StoredEvent }>();
  for (const { events } of runs) {
    const seen = new Set<string>();
    for (const e of events) {
      if (e.type !== "answered" || !e.itemKey) continue;
      // The run's first answer to an item replaces an older run's; every answer is the latest so far.
      if (!seen.has(e.itemKey)) items.set(e.itemKey, { first: e, latest: e });
      else (items.get(e.itemKey) as { latest: StoredEvent }).latest = e;
      seen.add(e.itemKey);
    }
  }
  const out: Mistake[] = [];
  for (const [key, { first, latest }] of items) {
    const result = (first.payload as { outcome?: { result: string } }).outcome?.result;
    if (result !== "wrong" && result !== "partial") continue;
    const { exercise, n } = parseItemKey(key as ItemKey);
    out.push({
      itemKey: key as ItemKey,
      lessonKey: lessonOf(exercise),
      exerciseKey: exercise,
      index: n - 1,
      answer: (first.payload as { answer?: unknown }).answer,
      result,
      fixed: (latest.payload as { outcome?: { result: string } }).outcome?.result === "correct",
      ts: first.ts,
    });
  }
  return out.sort((a, b) => b.ts - a.ts);
}
