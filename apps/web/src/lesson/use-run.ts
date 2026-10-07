// A lesson run on the server (05, "Lifecycle"). Opening a lesson starts nothing: it shows the active run
// (resume) or the latest finished one (read-only) or nothing. Starting, answering, skipping and finishing
// are recorded as events (sent in order, retried until stored), so a reload or another device sees the
// same state. The run's state is the engine's reading of its events — the stored ones plus those just
// recorded here — the same reading the server uses for progress. Outcomes are computed locally for
// instant feedback with the same engine the server uses; the server stores its own (04).
import { type ExerciseResult, exerciseResults, mistakesOf, stepsDone } from "@sprachanker/engine";
import type {
  LessonKey,
  LessonResult,
  Outcome,
  Run,
  StepId,
  StoredEvent,
} from "@sprachanker/schema";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ulid } from "ulid";
import { ApiError, api, json } from "@/api/client.ts";

export type { ExerciseResult } from "@sprachanker/engine";

/** `none`: never started · `active`: in progress · `finished`: the latest run is done (read-only). */
export type RunMode = "loading" | "none" | "active" | "finished";

type Pending = {
  id: string;
  type: "page_shown" | "answered" | "item_skipped" | "step_done";
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
  const [reload, setReload] = useState(0);
  const queue = useRef<Pending[]>([]);
  const sending = useRef<Promise<void> | null>(null);
  const runId = run?.status === "active" ? run.id : undefined;
  const results: Record<string, ExerciseResult> = useMemo(() => exerciseResults(events), [events]);
  /** Steps besides exercises done or skipped in the run (words, reading, AI practice). */
  const done = useMemo(() => stepsDone(events), [events]);
  /** Items whose first answer in the run was wrong or partly right (as the tutor reads them). */
  const mistakes = useMemo(() => mistakesOf([{ events }]), [events]);
  /** How many answers an item has in the run: the number of its latest attempt. */
  const attempts = (itemKey: string) =>
    events.filter((e) => e.type === "answered" && e.itemKey === itemKey).length;

  const load = useCallback((state: Loaded | null) => {
    setEvents(state?.events ?? []);
    setRun(state?.run);
    setResumePage(state?.events.length ? state.resumePage : -1);
    setMode(!state ? "none" : state.run.status === "active" ? "active" : "finished");
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `reload` re-reads the run on purpose
  useEffect(() => {
    if (!edition) return;
    let cancelled = false;
    setMode("loading");
    setError(undefined);
    json(api.runs.lesson.$get({ query: { series, lessonKey: lessonKey as LessonKey } }))
      .then(({ state }) => !cancelled && load(state as Loaded | null))
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [series, lessonKey, edition, load, reload]);

  /** Sends queued events in order; resolves once the queue is empty (events queued meanwhile
   *  included). Network failures are retried; events the server refuses (4xx) are dropped, since
   *  sending them again cannot succeed, and the run is read again from the server. */
  const flush = useCallback((): Promise<void> => {
    if (!runId) return Promise.resolve();
    if (sending.current) return sending.current;
    const send = async () => {
      while (queue.current.length) {
        const batch = queue.current.slice(0, 50);
        try {
          const { outcomes } = await json(
            api.runs[":id"].events.$post({ param: { id: runId }, json: { events: batch } }),
          );
          queue.current = queue.current.slice(batch.length);
          // The server's outcome is the one stored: it replaces the local one where they differ.
          if (Object.keys(outcomes).length)
            setEvents((prev) =>
              prev.map((e) =>
                outcomes[e.id]
                  ? { ...e, payload: { ...(e.payload as object), outcome: outcomes[e.id] } }
                  : e,
              ),
            );
        } catch (e) {
          if (e instanceof ApiError && e.status && e.status < 500) {
            queue.current = queue.current.slice(batch.length);
            setReload((n) => n + 1);
          } else await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    };
    sending.current = send().finally(() => {
      sending.current = null;
    });
    return sending.current;
  }, [runId]);

  // Events queued while the run was being started go out as soon as it exists.
  useEffect(() => {
    void flush();
  }, [flush]);

  // Leaving or reloading the page: what is still queued goes out with `keepalive`, which outlives the
  // page (events are idempotent by id, so one also in flight is stored once).
  useEffect(() => {
    if (!runId) return;
    const onHide = () => {
      if (!queue.current.length) return;
      void api.runs[":id"].events.$post(
        { param: { id: runId }, json: { events: queue.current.slice(0, 50) } },
        { init: { keepalive: true } },
      );
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [runId]);

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

  /** Completes the active run (every exercise worked) once all its events are stored, and returns
   *  its result. If the server finds exercises left, the run is read again from it. */
  const finish = useCallback(async (): Promise<LessonResult | null> => {
    await flush();
    if (!runId) return null;
    const finished = (await json(api.runs[":id"].finish.$post({ param: { id: runId } })).catch(
      (e) => {
        setReload((n) => n + 1);
        throw e;
      },
    )) as Run;
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
    mistakes,
    attempts,
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
    done,
    /** Records a step besides the exercises as done, or skipped. */
    stepDone: (step: StepId, skipped = false) =>
      record([
        { id: ulid(), type: "step_done", payload: { step, ...(skipped && { skipped: true }) } },
      ]),
    /** Records an exercise: given answers (with local outcomes) and the items left without one. */
    answer(
      answers: Array<{ itemKey: string; answer: unknown; outcome: Outcome }>,
      skipped: string[],
      ms: number,
    ) {
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
    /** Reads the run again from the server (e.g. after the lesson's progress was reset). */
    reload() {
      queue.current = [];
      setReload((n) => n + 1);
    },
  };
}
