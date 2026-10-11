// A model's verdicts (05: `llm_verdict` events), kept and read one way over the run store: explain,
// writing and spoken checks, an exam answer's proposed rating (and word examples of earlier versions);
// and the answers to the questions a verdict set (`practice_answered`: an Understanding text's, a
// mistakes review's new items), each kept once.
import type { PracticeAnsweredPayload, RunKind, VerdictOf, VerdictTask } from "@sprachanker/schema";
import { type Context, payloadOf, type ReadEvent, type RunStore } from "./run-store.ts";

/** An answer to one of a verdict's questions, with when it was given. */
export type PracticeAnswer = PracticeAnsweredPayload & { ts: number };

/** The answers to the questions of verdicts in runs of a kind about a context, in the order given,
 *  by verdict. */
export function practiceAnswers(
  store: RunStore,
  where: { kind: RunKind; about: Context },
): Map<string, PracticeAnswer[]> {
  const out = new Map<string, PracticeAnswer[]>();
  for (const e of store.eventsWhere({ types: ["practice_answered"], ascending: true, ...where }))
    if (e.type === "practice_answered")
      out.set(e.payload.verdict, [
        ...(out.get(e.payload.verdict) ?? []),
        payloadOf<PracticeAnsweredPayload>(e),
      ]);
  return out;
}

/** Keeps an answer to a verdict's question in the verdict's run (also an ended one): a question
 *  answered already keeps its first answer. */
export function keepPracticeAnswer(
  store: RunStore,
  runId: string,
  answer: PracticeAnsweredPayload,
) {
  store.atomic(() => {
    const given = store
      .events(runId, ["practice_answered"])
      .some(
        (e) =>
          e.type === "practice_answered" &&
          e.payload.verdict === answer.verdict &&
          e.payload.question === answer.question,
      );
    if (!given)
      store.append(runId, [{ type: "practice_answered", payload: answer }], { anyStatus: true });
  });
}

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
