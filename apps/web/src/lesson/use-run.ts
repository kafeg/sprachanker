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
  TypedEvent,
} from "@sprachanker/schema";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { ulid } from "ulid";
import { ApiError, api, json } from "@/api/client.ts";
import { createOutbox } from "./outbox.ts";

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
  events: TypedEvent[];
  resumePage: number;
}

const NO_EVENTS: TypedEvent[] = [];

export function useRun(series: string, lessonKey: string, edition: string | undefined) {
  const client = useQueryClient();
  const key = useMemo(() => ["run", series, lessonKey], [series, lessonKey]);
  // The run as the server last gave it, with the events recorded here since: in the query cache, so
  // whatever reads the lesson's progress anew (a reset) reads the run anew too.
  const query = useQuery({
    queryKey: key,
    queryFn: async () =>
      (await json(api.runs.lesson.$get({ query: { series, lessonKey: lessonKey as LessonKey } })))
        .state as Loaded | null,
    enabled: !!edition,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
  const state = query.data;
  const update = useCallback(
    (change: (state: Loaded) => Loaded) =>
      client.setQueryData<Loaded | null>(key, (old) => (old ? change(old) : old)),
    [client, key],
  );
  const run = state?.run;
  const events = state?.events ?? NO_EVENTS;
  const mode: RunMode = query.isPending
    ? "loading"
    : !state
      ? "none"
      : state.run.status === "active"
        ? "active"
        : "finished";
  const resumePage = state?.events.length ? state.resumePage : -1;
  /** The events as of now, for callers holding an older render (a model's answer arriving later). */
  const latest = useRef(events);
  latest.current = events;
  const runId = run?.status === "active" ? run.id : undefined;
  const runIdNow = useRef(runId);
  runIdNow.current = runId;
  const results: Record<string, ExerciseResult> = useMemo(() => exerciseResults(events), [events]);
  /** Steps besides exercises done or skipped in the run (words, reading, AI practice). */
  const done = useMemo(() => stepsDone(events), [events]);
  /** Items whose first answer in the run was wrong or partly right (as the tutor reads them). */
  const mistakes = useMemo(() => mistakesOf([{ events }]), [events]);
  /** How many answers an item has in the run: the number of its latest attempt. */
  const attempts = (itemKey: string) =>
    events.filter((e) => e.type === "answered" && e.itemKey === itemKey).length;

  // Recorded events go out in order (lesson/outbox.ts); the server's outcome of an answer is the one
  // stored, and replaces the local one where they differ. A batch it refuses: the run is read again.
  const outbox = useMemo(
    () =>
      createOutbox<Pending>({
        async send(batch) {
          const id = runIdNow.current;
          if (!id) throw new Error("no run yet");
          const { outcomes } = await json(
            api.runs[":id"].events.$post({ param: { id }, json: { events: batch } }),
          );
          if (Object.keys(outcomes).length)
            update((s) => ({
              ...s,
              events: s.events.map((e): TypedEvent => {
                const outcome = outcomes[e.id];
                return outcome && e.type === "answered"
                  ? { ...e, payload: { ...e.payload, outcome } }
                  : e;
              }),
            }));
        },
        refused: (e) => e instanceof ApiError && !!e.status && e.status < 500,
        onRefused: () => void client.invalidateQueries({ queryKey: key }),
      }),
    [client, key, update],
  );
  const reload = useCallback(() => {
    outbox.clear();
    void client.invalidateQueries({ queryKey: key });
  }, [client, key, outbox]);
  /** Sends what is queued; nothing goes before the run exists. */
  const flush = useCallback(
    (): Promise<void> => (runId ? outbox.flush() : Promise.resolve()),
    [runId, outbox],
  );

  // Events queued while the run was being started go out as soon as it exists.
  useEffect(() => {
    void flush();
  }, [flush]);

  // Leaving or reloading the page: what is still queued goes out with `keepalive`, which outlives the
  // page (events are idempotent by id, so one also in flight is stored once).
  useEffect(() => {
    if (!runId) return;
    const onHide = () => {
      const pending = outbox.pending();
      if (!pending.length) return;
      void api.runs[":id"].events.$post(
        { param: { id: runId }, json: { events: [...pending] } },
        { init: { keepalive: true } },
      );
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [runId, outbox]);

  /** Queues events for the server and applies them here at once, answers with their local outcome. */
  const record = useCallback(
    (pending: Pending[], outcomes: Record<string, Outcome> = {}) => {
      outbox.push(pending);
      void flush();
      const ts = Date.now();
      update((s) => ({
        ...s,
        events: [
          ...s.events,
          ...pending.map((e) => {
            const outcome = outcomes[e.id];
            const payload = outcome ? { ...(e.payload as object), outcome } : e.payload;
            return {
              ...e,
              payload,
              runId: runId ?? "",
              ts,
              itemKey: e.itemKey ?? null,
            } as TypedEvent;
          }),
        ],
      }));
    },
    [flush, runId, outbox, update],
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
        reload();
        throw e;
      },
    )) as Run;
    update((s) => ({ ...s, run: finished }));
    refreshProgress();
    return finished.result;
  }, [flush, runId, refreshProgress, reload, update]);

  return {
    mode,
    run,
    resumePage,
    results,
    mistakes,
    attempts,
    error: query.error,
    /** Starts the lesson (or resumes its active run); `restart` begins it anew. */
    async start(restart = false) {
      if (!edition) return;
      const started = await json(
        api.runs.$post({
          json: { series, lessonKey: lessonKey as LessonKey, edition, restart },
        }),
      );
      client.setQueryData(key, started as Loaded);
      if (restart) refreshProgress();
    },
    pageShown: (pageIndex: number) =>
      record([{ id: ulid(), type: "page_shown", payload: { pageIndex } }]),
    done,
    /** Records a step besides the exercises as done, or skipped — once: a step already in that state
     *  (by the run's events as of now) records nothing. */
    stepDone: (step: StepId, skipped = false) => {
      if (stepsDone(latest.current).get(step) === (skipped ? "skipped" : "done")) return;
      record([
        { id: ulid(), type: "step_done", payload: { step, ...(skipped && { skipped: true }) } },
      ]);
    },
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
    /** Events the server stored in the run by itself (a model's check): applied here as they are. */
    received(stored: TypedEvent[]) {
      update((s) => ({
        ...s,
        events: [...s.events, ...stored.filter((e) => !s.events.some((p) => p.id === e.id))],
      }));
    },
    /** Reads the run again from the server (e.g. after the lesson's progress was reset). */
    reload,
  };
}
