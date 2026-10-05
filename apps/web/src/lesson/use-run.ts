// A lesson run on the server: start or resume, record answers as events (sent in order, retried until
// stored), finish at the summary. Outcomes are computed locally for instant feedback with the same
// engine the server uses; the server stores its own (04).
import type { LessonKey, Outcome, StoredEvent } from "@sprachanker/schema";
import { useCallback, useEffect, useRef, useState } from "react";
import { ulid } from "ulid";
import { api, json } from "@/api/client.ts";

export interface ExerciseResult {
  /** First-attempt outcomes by item key. */
  first: Record<string, Outcome>;
  skipped?: boolean;
  /** Unscored exercise finished (self-rating, unsupported type). */
  seen?: boolean;
}

type Pending = { id: string; type: "page_shown" | "answered"; itemKey?: string; payload: unknown };

function resultsFrom(events: StoredEvent[]) {
  const results: Record<string, ExerciseResult> = {};
  const attempts: Record<string, number> = {};
  for (const e of events) {
    if (e.type !== "answered" || !e.itemKey) continue;
    const exercise = e.itemKey.split("#")[0] as string;
    const payload = e.payload as { outcome?: Outcome; answer?: { skipped?: boolean } };
    attempts[e.itemKey] = (attempts[e.itemKey] ?? 0) + 1;
    results[exercise] ??= { first: {} };
    const r = results[exercise];
    if (payload.outcome && !(e.itemKey in r.first)) r.first[e.itemKey] = payload.outcome;
  }
  return { results, attempts };
}

export function useRun(series: string, lessonKey: string, edition: string | undefined) {
  const [runId, setRunId] = useState<string>();
  const [resumePage, setResumePage] = useState<number>();
  const [results, setResults] = useState<Record<string, ExerciseResult>>({});
  const [error, setError] = useState<unknown>();
  const attempts = useRef<Record<string, number>>({});
  const queue = useRef<Pending[]>([]);
  const sending = useRef(false);

  useEffect(() => {
    if (!edition) return;
    let cancelled = false;
    json(api.runs.$post({ json: { series, lessonKey: lessonKey as LessonKey, edition } }))
      .then((started) => {
        if (cancelled) return;
        const derived = resultsFrom(started.events as StoredEvent[]);
        attempts.current = derived.attempts;
        setResults(derived.results);
        setRunId(started.run.id);
        setResumePage(started.events.length ? started.resumePage : -1);
      })
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [series, lessonKey, edition]);

  const flush = useCallback(async () => {
    if (!runId || sending.current || !queue.current.length) return;
    sending.current = true;
    const batch = queue.current.slice(0, 50);
    try {
      await json(api.runs[":id"].events.$post({ param: { id: runId }, json: { events: batch } }));
      queue.current = queue.current.slice(batch.length);
    } catch {
      setTimeout(() => void flush(), 3000);
    } finally {
      sending.current = false;
    }
    if (queue.current.length) void flush();
  }, [runId]);

  const send = useCallback(
    (events: Pending[]) => {
      queue.current.push(...events);
      void flush();
    },
    [flush],
  );

  return {
    runId,
    resumePage,
    results,
    error,
    pageShown: (pageIndex: number) =>
      send([{ id: ulid(), type: "page_shown", payload: { pageIndex } }]),
    /** Records answers of one exercise; returns nothing, results update locally. */
    answer(
      exerciseKey: string,
      answers: Array<{ itemKey: string; answer: unknown; outcome: Outcome }>,
      ms: number,
      skipped = false,
    ) {
      const events: Pending[] = answers.map(({ itemKey, answer }) => {
        const attempt = (attempts.current[itemKey] ?? 0) + 1;
        attempts.current[itemKey] = attempt;
        return { id: ulid(), type: "answered", itemKey, payload: { answer, attempt, ms } };
      });
      setResults((prev) => {
        const r = { ...(prev[exerciseKey] ?? { first: {} }) };
        r.first = { ...r.first };
        for (const a of answers) if (!(a.itemKey in r.first)) r.first[a.itemKey] = a.outcome;
        if (skipped && !Object.keys(prev[exerciseKey]?.first ?? {}).length) r.skipped = true;
        if (!answers.length) r.seen = true;
        return { ...prev, [exerciseKey]: r };
      });
      send(events);
    },
    async finish() {
      await flush();
      if (!runId) return undefined;
      return json(api.runs[":id"].finish.$post({ param: { id: runId } }));
    },
  };
}
export type RunState = ReturnType<typeof useRun>;
