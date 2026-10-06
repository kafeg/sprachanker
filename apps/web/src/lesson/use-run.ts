// A lesson run on the server (05, "Lifecycle"). Opening a lesson starts nothing: it shows the active run
// (resume) or the latest finished one (read-only) or nothing. Starting, answering, skipping and finishing
// are recorded as events (sent in order, retried until stored), so a reload or another device sees the
// same state. Outcomes are computed locally for instant feedback with the same engine the server uses;
// the server stores its own (04).
import type { LessonKey, LessonResult, Outcome, Run, StoredEvent } from "@sprachanker/schema";
import { useCallback, useEffect, useRef, useState } from "react";
import { ulid } from "ulid";
import { api, json } from "@/api/client.ts";

export interface ExerciseResult {
  /** First-attempt outcomes by item key (they count for the score). */
  first: Record<string, Outcome>;
  /** The latest answer of each item, with its outcome: what the exercise shows when reopened. */
  last: Record<string, { answer: unknown; outcome?: Outcome }>;
  /** Items the learner moved on from without an answer. */
  skipped: string[];
}

/** `none`: never started · `active`: in progress · `finished`: the latest run is done (read-only). */
export type RunMode = "loading" | "none" | "active" | "finished";

type Pending = {
  id: string;
  type: "page_shown" | "answered" | "item_skipped";
  itemKey?: string;
  payload: unknown;
};

const exerciseOf = (itemKey: string) => itemKey.split("#")[0] as string;

function resultsFrom(events: StoredEvent[]) {
  const results: Record<string, ExerciseResult> = {};
  const attempts: Record<string, number> = {};
  for (const e of events) {
    if ((e.type !== "answered" && e.type !== "item_skipped") || !e.itemKey) continue;
    const key = exerciseOf(e.itemKey);
    results[key] ??= { first: {}, last: {}, skipped: [] };
    const r = results[key];
    if (e.type === "item_skipped") {
      if (!r.skipped.includes(e.itemKey)) r.skipped.push(e.itemKey);
      continue;
    }
    const payload = e.payload as { outcome?: Outcome; answer?: unknown };
    attempts[e.itemKey] = (attempts[e.itemKey] ?? 0) + 1;
    if (payload.outcome && !(e.itemKey in r.first)) r.first[e.itemKey] = payload.outcome;
    r.last[e.itemKey] = { answer: payload.answer, outcome: payload.outcome };
    r.skipped = r.skipped.filter((k) => k !== e.itemKey);
  }
  return { results, attempts };
}

interface Loaded {
  run: Run;
  events: StoredEvent[];
  resumePage: number;
}

export function useRun(series: string, lessonKey: string, edition: string | undefined) {
  const [mode, setMode] = useState<RunMode>("loading");
  const [run, setRun] = useState<Run>();
  const [resumePage, setResumePage] = useState(-1);
  const [results, setResults] = useState<Record<string, ExerciseResult>>({});
  const [error, setError] = useState<unknown>();
  const attempts = useRef<Record<string, number>>({});
  const queue = useRef<Pending[]>([]);
  const sending = useRef(false);
  const runId = run?.status === "active" ? run.id : undefined;

  const load = useCallback((state: Loaded | null) => {
    const derived = resultsFrom(state?.events ?? []);
    attempts.current = derived.attempts;
    setResults(derived.results);
    setRun(state?.run);
    setResumePage(state?.events.length ? state.resumePage : -1);
    setMode(!state ? "none" : state.run.status === "active" ? "active" : "finished");
  }, []);

  useEffect(() => {
    if (!edition) return;
    let cancelled = false;
    setMode("loading");
    json(api.runs.lesson.$get({ query: { series, lessonKey: lessonKey as LessonKey, edition } }))
      .then(({ state }) => !cancelled && load(state as Loaded | null))
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [series, lessonKey, edition, load]);

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

  // Events queued while the run was being started go out as soon as it exists.
  useEffect(() => {
    void flush();
  }, [flush]);

  const send = useCallback(
    (events: Pending[]) => {
      queue.current.push(...events);
      void flush();
    },
    [flush],
  );

  /** Completes the active run (at the summary) and returns its result. */
  const finish = useCallback(async (): Promise<LessonResult | null> => {
    await flush();
    if (!runId) return null;
    const finished = (await json(api.runs[":id"].finish.$post({ param: { id: runId } }))) as Run;
    setRun(finished);
    setMode("finished");
    return finished.result;
  }, [flush, runId]);

  const skippedEvents = (itemKeys: string[]): Pending[] =>
    itemKeys.map((itemKey) => ({ id: ulid(), type: "item_skipped", itemKey, payload: {} }));

  return {
    mode,
    run,
    resumePage,
    results,
    error,
    /** Starts the lesson (or resumes its active run); `restart` begins it anew. */
    async start(restart = false) {
      if (!edition) return;
      const started = await json(
        api.runs.$post({
          json: { series, lessonKey: lessonKey as LessonKey, edition, restart },
        }),
      );
      load(started as Loaded);
    },
    pageShown: (pageIndex: number) =>
      send([{ id: ulid(), type: "page_shown", payload: { pageIndex } }]),
    /** Records an exercise: given answers (with local outcomes) and the items left without one. */
    answer(
      exerciseKey: string,
      answers: Array<{ itemKey: string; answer: unknown; outcome: Outcome }>,
      skipped: string[],
      ms: number,
    ) {
      const events: Pending[] = answers.map(({ itemKey, answer }) => {
        const attempt = (attempts.current[itemKey] ?? 0) + 1;
        attempts.current[itemKey] = attempt;
        return { id: ulid(), type: "answered", itemKey, payload: { answer, attempt, ms } };
      });
      setResults((prev) => {
        const old = prev[exerciseKey];
        const r: ExerciseResult = {
          first: { ...old?.first },
          last: { ...old?.last },
          skipped: (old?.skipped ?? []).filter((k) => !answers.some((a) => a.itemKey === k)),
        };
        for (const a of answers) {
          if (!(a.itemKey in r.first)) r.first[a.itemKey] = a.outcome;
          r.last[a.itemKey] = { answer: a.answer, outcome: a.outcome };
        }
        for (const k of skipped) if (!r.skipped.includes(k)) r.skipped.push(k);
        return { ...prev, [exerciseKey]: r };
      });
      send([...events, ...skippedEvents(skipped)]);
    },
    finish,
  };
}
export type RunState = ReturnType<typeof useRun>;
