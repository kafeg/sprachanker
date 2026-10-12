// A lesson's or an exam's answers stored over the run store, numbered by the server: each new
// answer after the answers its item has in the run, so two devices answering in one run never give
// two answers the same number.
import type { AnsweredPayload, Outcome } from "@sprachanker/schema";
import type { NewEvent, RunStore } from "./run-store.ts";

/** Stores a run's events as `store.append` does, each new answer numbered, and returns each answer's
 *  outcome and attempt — the stored ones for an answer sent again; none for an id another event has. */
export function appendAnswers(
  store: RunStore,
  runId: string,
  list: NewEvent[],
  options: { deviceId?: string } = {},
) {
  const count = new Map<string, number>();
  for (const a of store.eventsWhere({ types: ["answered"], runIds: [runId] }))
    if (a.itemKey) count.set(a.itemKey, (count.get(a.itemKey) ?? 0) + 1);
  const numbered = list.map((e): NewEvent => {
    // One sent again keeps its own number: the store gives it back as stored.
    if (e.type !== "answered" || !e.id || !e.itemKey || store.event(e.id)) return e;
    const attempt = (count.get(e.itemKey) ?? 0) + 1;
    count.set(e.itemKey, attempt);
    return { ...e, payload: { ...(e.payload as AnsweredPayload), attempt } };
  });
  const outcomes: Record<string, Outcome> = {};
  const attempts: Record<string, number> = {};
  for (const e of store.append(runId, numbered, options))
    if (e.type === "answered") {
      outcomes[e.id] = e.payload.outcome;
      attempts[e.id] = e.payload.attempt;
    }
  return { outcomes, attempts };
}
