// A model's verdicts (05: `llm_verdict` events), kept and read one way over the run store: explain,
// writing and spoken checks, an exam answer's proposed rating (and word examples of earlier versions).
import type { RunKind, VerdictOf, VerdictTask } from "@sprachanker/schema";
import type { Context, ReadEvent, RunStore } from "./run-store.ts";

/** A verdict as every history reads it: its payload typed by its task, with where and when it was
 *  given. One shape for the services that keep verdicts and the Notebook. */
export type Verdict<T extends VerdictTask> = VerdictOf<T> & {
  id: string;
  runId: string;
  itemKey: string | null;
  cardId: string | null;
  ts: number;
};

const verdictOf = <T extends VerdictTask>(e: ReadEvent): Verdict<T> => ({
  ...(e.payload as VerdictOf<T>),
  id: e.id,
  runId: e.runId,
  itemKey: e.itemKey,
  cardId: e.cardId ?? null,
  ts: e.ts,
});

/** A verdict kept in a run, also an ended one (a check kept with a finished lesson run), on an item
 *  or a card: the event (for the page that shows the run), and the verdict as histories read it. */
export function keepVerdict<T extends VerdictTask>(
  store: RunStore,
  runId: string,
  payload: VerdictOf<T>,
  on: { itemKey?: string; cardId?: string } = {},
) {
  const [event] = store.append(runId, [{ type: "llm_verdict", ...on, payload }], {
    anyStatus: true,
  }) as [ReadEvent];
  return { event, verdict: verdictOf<T>(event) };
}

/**
 * The verdicts of one task, newest first: in some runs or in runs of a kind about a context, on one
 * item or card when given; typed by the task (the payload was read with its schema, so one that no
 * longer reads was left out and logged already).
 */
export function verdicts<T extends VerdictTask>(
  store: RunStore,
  task: T,
  where: { runIds?: string[]; kind?: RunKind; about?: Context; itemKey?: string; cardId?: string },
): Verdict<T>[] {
  return store
    .eventsWhere({ types: ["llm_verdict"], ...where })
    .flatMap((e) => (e.type === "llm_verdict" && e.payload.task === task ? [verdictOf<T>(e)] : []));
}
