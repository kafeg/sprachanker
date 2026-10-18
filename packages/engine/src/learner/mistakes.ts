// The learner's mistakes: items whose first attempt in the
// latest run that answered them was wrong or partly right, with whether a later answer got them right.
// "First attempt" is read as the lesson score reads it (progress.ts `replacesFirst`: a take kept
// before it was heard gives way to the first one heard). A right answer in one's own words is none. An
// answer said aloud is read by its mark (progress.ts `answerMark`): the engine's judgement of what was
// heard, else the model's check of it — minor errors partly right, major errors or off the task
// wrong, good right; unchecked, it is no mistake.
import {
  type ItemKey,
  lessonOf,
  parseItemKey,
  type SpokenCheck,
  type TokenDiff,
  type TypedEvent,
} from "@sprachanker/schema";
import { answerMark, replacesFirst, spokenChecks } from "./progress.ts";

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
  /** An answer said aloud the engine judged: what was heard against the answer it was closest to. */
  diff?: TokenDiff[];
  /** A later answer was correct. */
  fixed: boolean;
  /** When the first answer was given. */
  ts: number;
}

type Answered = Extract<TypedEvent, { type: "answered" }>;

/** An answer's result: its mark, and for one said aloud the model's correction or the engine's
 *  word diff. */
function resultOf(e: Answered, checks: Map<string, SpokenCheck>) {
  const { outcome, answer } = e.payload;
  const result = answerMark(e.itemKey ?? "", answer, outcome, checks);
  if (outcome.result !== "unscored") return { result };
  if (outcome.spoken) return { result, diff: outcome.diff };
  const heard = (answer as { transcript?: unknown } | undefined)?.transcript;
  return { result, corrected: checks.get(`${e.itemKey}\n${heard}`)?.corrected };
}

type Read = { event: Answered; result?: string; corrected?: string; diff?: TokenDiff[] };

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
      const known = items.get(e.itemKey);
      // The run's first answer to an item replaces an older run's (and a take heard late, the first
      // heard: replacesFirst); every answer is the latest so far.
      if (!seen.has(e.itemKey) || !known) items.set(e.itemKey, { first: read, latest: read });
      else {
        if (replacesFirst(known.first.event.payload, e.payload.answer)) known.first = read;
        known.latest = read;
      }
      seen.add(e.itemKey);
    }
  }
  const out: Mistake[] = [];
  for (const [key, { first, latest }] of items) {
    const { result, corrected, diff } = first;
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
      ...(diff && { diff }),
      fixed: latest.result === "correct",
      ts: first.event.ts,
    });
  }
  return out.sort((a, b) => b.ts - a.ts);
}
