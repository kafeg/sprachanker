// The learner's mistakes: items whose first attempt in the
// latest run that answered them was wrong or partly right, with whether a later answer got them right.
// "First attempt" is the run's first answer to the item — the same reading as the lesson score. An
// answer said aloud without a phrase is read by the model's check of what was heard: minor errors
// partly right, major errors or off the task wrong, good right; unchecked, it is no mistake.
import {
  type ItemKey,
  lessonOf,
  parseItemKey,
  type SpokenCheck,
  type TypedEvent,
} from "@sprachanker/schema";

export interface Mistake {
  itemKey: ItemKey;
  lessonKey: string;
  exerciseKey: string;
  /** 0-based item index in the exercise. */
  index: number;
  /** The first (wrong) answer. */
  answer: unknown;
  result: "wrong" | "partial";
  /** An answer said aloud: the model's correction of what was heard. */
  corrected?: string;
  /** A later answer was correct. */
  fixed: boolean;
  /** When the first answer was given. */
  ts: number;
}

const SPOKEN_RESULT: Record<SpokenCheck["verdict"], "correct" | "partial" | "wrong"> = {
  good: "correct",
  minor_errors: "partial",
  major_errors: "wrong",
  off_task: "wrong",
};

/** The model's checks of spoken answers in a run, by item and what was heard; the latest counts. */
function spokenChecks(events: TypedEvent[]) {
  const checks = new Map<string, SpokenCheck>();
  for (const e of events)
    if (e.type === "llm_verdict" && e.itemKey && e.payload.task === "speaking")
      checks.set(`${e.itemKey}\n${e.payload.input}`, e.payload.result);
  return checks;
}

type Answered = Extract<TypedEvent, { type: "answered" }>;

/** An answer's result: its outcome, or for one said aloud and unscored, the model's check of it. */
function resultOf(e: Answered, checks: Map<string, SpokenCheck>) {
  const { outcome } = e.payload;
  const answer = e.payload.answer as { transcript?: unknown } | undefined;
  if (outcome.result !== "unscored" || typeof answer?.transcript !== "string")
    return { result: outcome.result };
  const check = checks.get(`${e.itemKey}\n${answer.transcript}`);
  return { result: check && SPOKEN_RESULT[check.verdict], corrected: check?.corrected };
}

type Read = { event: Answered; result?: string; corrected?: string };

/** Mistakes over lesson runs given oldest first, each with its events in order (a lesson done again
 *  counts afresh); newest first. */
export function mistakesOf(runs: Array<{ events: TypedEvent[] }>): Mistake[] {
  const items = new Map<string, { first: Read; latest: Read }>();
  for (const { events } of runs) {
    const checks = spokenChecks(events);
    const seen = new Set<string>();
    for (const e of events) {
      if (e.type !== "answered" || !e.itemKey) continue;
      const read = { event: e, ...resultOf(e, checks) };
      // The run's first answer to an item replaces an older run's; every answer is the latest so far.
      if (!seen.has(e.itemKey)) items.set(e.itemKey, { first: read, latest: read });
      else (items.get(e.itemKey) as { latest: Read }).latest = read;
      seen.add(e.itemKey);
    }
  }
  const out: Mistake[] = [];
  for (const [key, { first, latest }] of items) {
    const { result, corrected } = first;
    if (result !== "wrong" && result !== "partial") continue;
    const { exercise, n } = parseItemKey(key as ItemKey);
    out.push({
      itemKey: key as ItemKey,
      lessonKey: lessonOf(exercise),
      exerciseKey: exercise,
      index: n - 1,
      answer: first.event.payload.answer,
      result,
      ...(corrected !== undefined && { corrected }),
      fixed: latest.result === "correct",
      ts: first.event.ts,
    });
  }
  return out.sort((a, b) => b.ts - a.ts);
}
