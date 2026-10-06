// A lesson run on the server (05, "Lifecycle"). Opening a lesson starts nothing: it shows the active run
// (resume) or the latest finished one (read-only) or nothing. Starting, answering, skipping and finishing
// are recorded as events (sent in order, retried until stored), so a reload or another device sees the
// same state. The run's state is the engine's reading of its events — the stored ones plus those just
// recorded here — the same reading the server uses for progress. Outcomes are computed locally for
// instant feedback with the same engine the server uses; the server stores its own (04).
import { type ExerciseResult, exerciseResults } from "@sprachanker/engine";
import type { LessonKey, LessonResult, Outcome, Run, StoredEvent } from "@sprachanker/schema";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ulid } from "ulid";
import { api, json } from "@/api/client.ts";

export type { ExerciseResult } from "@sprachanker/engine";

/** `none`: never started · `active`: in progress · `finished`: the latest run is done (read-only). */
export type RunMode = "loading" | "none" | "active" | "finished";

type Pending = {
  id: string;
  type: "page_shown" | "answered" | "item_skipped";
  itemKey?: string;
  payload: unknown;
};

interface Loaded {
  run: Run;
  events: StoredEvent[];
  resumePage: number;
}

export function useRun(series: string, lessonKey: string, edition: string | undefined) {
  const client = useQueryClient();
  const [mode, setMode] = useState<RunMode>("loading");
  const [run, setRun] = useState<Run>();
  const [resumePage, setResumePage] = useState(-1);
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [error, setError] = useState<unknown>();
  const queue = useRef<Pending[]>([]);
  const sending = useRef(false);
  const runId = run?.status === "active" ? run.id : undefined;
  const results: Record<string, ExerciseResult> = useMemo(() => exerciseResults(events), [events]);

  const load = useCallback((state: Loaded | null) => {
    setEvents(state?.events ?? []);
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

  /** Queues events for the server and applies them here at once, answers with their local outcome. */
  const record = useCallback(
    (pending: Pending[], outcomes: Record<string, Outcome> = {}) => {
      queue.current.push(...pending);
      void flush();
      const ts = Date.now();
      setEvents((prev) => [
        ...prev,
        ...pending.map((e) => {
          const outcome = outcomes[e.id];
          const payload = outcome ? { ...(e.payload as object), outcome } : e.payload;
          return {
            ...e,
            payload,
            runId: runId ?? "",
            ts,
            itemKey: e.itemKey ?? null,
          } as StoredEvent;
        }),
      ]);
    },
    [flush, runId],
  );

  /** The course map and course list read progress from the server: refresh them after a change. */
  const refreshProgress = useCallback(() => {
    void client.invalidateQueries({ queryKey: ["courses"] });
    void client.invalidateQueries({ queryKey: ["course"] });
  }, [client]);

  /** Completes the active run (every exercise worked) and returns its result. */
  const finish = useCallback(async (): Promise<LessonResult | null> => {
    await flush();
    if (!runId) return null;
    const finished = (await json(api.runs[":id"].finish.$post({ param: { id: runId } }))) as Run;
    setRun(finished);
    setMode("finished");
    refreshProgress();
    return finished.result;
  }, [flush, runId, refreshProgress]);

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
      if (restart) refreshProgress();
    },
    pageShown: (pageIndex: number) =>
      record([{ id: ulid(), type: "page_shown", payload: { pageIndex } }]),
    /** Records an exercise: given answers (with local outcomes) and the items left without one. */
    answer(
      answers: Array<{ itemKey: string; answer: unknown; outcome: Outcome }>,
      skipped: string[],
      ms: number,
    ) {
      const attempts = (itemKey: string) =>
        events.filter((e) => e.type === "answered" && e.itemKey === itemKey).length;
      const given = answers.map(({ itemKey, answer, outcome }) => ({
        event: {
          id: ulid(),
          type: "answered" as const,
          itemKey,
          payload: { answer, attempt: attempts(itemKey) + 1, ms },
        },
        outcome,
      }));
      record(
        [
          ...given.map((g) => g.event),
          ...skipped.map((itemKey) => ({
            id: ulid(),
            type: "item_skipped" as const,
            itemKey,
            payload: {},
          })),
        ],
        Object.fromEntries(given.map((g) => [g.event.id, g.outcome])),
      );
    },
    finish,
  };
}
export type RunState = ReturnType<typeof useRun>;
