// A lesson run on the server (05, "Lifecycle"). Opening a lesson starts nothing: it shows the active run
// (resume) or the latest finished one (read-only) or nothing. Starting, answering, skipping and finishing
// are recorded as events (sent in order, retried until stored), so a reload or another device sees the
// same state. The run's state is the engine's reading of its events — the stored ones plus those just
// recorded here — the same reading the server uses for progress. Outcomes are computed locally for
// instant feedback with the same engine the server uses; the server stores its own (04).
import {
  type ExerciseResult,
  exerciseResults,
  mistakesOf,
  practiceMarks,
  stepsDone,
} from "@sprachanker/engine";
import type { LessonKey, LessonResult, Outcome, StepId, TypedEvent } from "@sprachanker/schema";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { ulid } from "ulid";
import { api, json } from "@/api/client.ts";
import { runOutbox, useRunOutbox } from "@/api/run-events.ts";

export type { ExerciseResult } from "@sprachanker/engine";

/** `none`: never started · `active`: in progress · `finished`: the latest run is done (read-only). */
export type RunMode = "loading" | "none" | "active" | "finished";

type Pending = {
  id: string;
  type: "page_shown" | "answered" | "item_skipped" | "step_done";
  itemKey?: string;
  payload: unknown;
};
/** An event queued with the run it belongs to (none yet: the run being started). */
type Queued = Pending & { runId?: string };

/** The lesson's run as the server gives it (`GET /runs/lesson`), with the events recorded here. */
const fetchLoaded = (series: string, lessonKey: string) =>
  json(api.runs.lesson.$get({ query: { series, lessonKey: lessonKey as LessonKey } }));
type State = NonNullable<Awaited<ReturnType<typeof fetchLoaded>>["state"]>;
/** Its events as the engine reads them: those recorded here join the stored ones. */
type Loaded = Omit<State, "events"> & { events: TypedEvent[] };

const NO_EVENTS: TypedEvent[] = [];
/** An event as the server takes it: without the run it is queued for. */
const withoutRun = ({ runId: _, ...e }: Queued): Pending => e;

/** The active run in a lesson's cached state. */
const activeRun = (client: QueryClient, key: readonly unknown[]) => {
  const run = client.getQueryData<Loaded | null>(key)?.run;
  return run?.status === "active" ? run.id : undefined;
};

/** The lesson's outbox (api/run-events: one per profile and lesson): each event goes to the run it
 *  was recorded in; one queued before the run existed, to the run started since. */
const outboxOf = (client: QueryClient, key: readonly unknown[]) =>
  runOutbox<Queued>(client, key, {
    batchKey: (e) => e.runId ?? "",
    runOf: (batch) => batch[0]?.runId ?? activeRun(client, key),
    post: (id, batch, init) =>
      json(
        api.runs[":id"].events.$post(
          { param: { id }, json: { events: batch.map(withoutRun) } },
          init && { init },
        ),
      ),
  });

export function useRun(series: string, lessonKey: string, edition: string | undefined) {
  const client = useQueryClient();
  const key = useMemo(() => ["run", series, lessonKey], [series, lessonKey]);
  const outbox = useMemo(() => outboxOf(client, key), [client, key]);
  // The run as the server last gave it, with the events recorded here since: in the query cache, so
  // whatever reads the lesson's progress anew (a reset) reads the run anew too. Read again whenever
  // the lesson is opened (another device may have gone on); events still on their way stay in it.
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      // Events stored while the run is read may be stored after the server read it: they stay too.
      const mark = outbox.mark();
      const loaded = (await fetchLoaded(series, lessonKey)).state;
      if (!loaded) return loaded;
      const queued = new Set([...outbox.pending(), ...outbox.storedSince(mark)].map((e) => e.id));
      const stored = new Set(loaded.events.map((e) => e.id));
      const before = client.getQueryData<Loaded | null>(key);
      const onTheWay =
        before?.run.id === loaded.run.id
          ? before.events.filter((e) => queued.has(e.id) && !stored.has(e.id))
          : [];
      return { ...loaded, events: [...loaded.events, ...onTheWay] };
    },
    enabled: !!edition,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: "always",
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
  const results: Record<string, ExerciseResult> = useMemo(() => exerciseResults(events), [events]);
  /** Steps besides exercises done or skipped in the run (words, reading, AI practice). */
  const done = useMemo(() => stepsDone(events), [events]);
  /** How the AI practice went: each step's first work, marked as an exercise is. */
  const practice = useMemo(() => practiceMarks(events), [events]);
  /** Items whose first answer in the run was wrong or partly right (as the tutor reads them). */
  const mistakes = useMemo(() => mistakesOf([{ events }]), [events]);
  /** How many answers an item has in the run: the number of its latest attempt. */
  const attempts = (itemKey: string) =>
    events.filter((e) => e.type === "answered" && e.itemKey === itemKey).length;

  // Recorded events go out in order, each to its run (outboxOf above).
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

  // Leaving or reloading the page: what is still queued goes out as the page closes.
  useRunOutbox(outbox);

  /** Queues events for the server and applies them here at once, answers with their local outcome. */
  const record = useCallback(
    (pending: Pending[], outcomes: Record<string, Outcome> = {}) => {
      outbox.push(pending.map((e) => ({ ...e, runId })));
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
    const finished = await json(api.runs[":id"].finish.$post({ param: { id: runId } })).catch(
      (e) => {
        reload();
        throw e;
      },
    );
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
    /** Its events as the engine reads them (the plan's AI practice: practiceInPlan). */
    events,
    attempts,
    error: query.error,
    /** Reads the run again — after a failed read, after the assistant kept an answer in it —, keeping
     *  what is still on its way; resolves once read. */
    retry: () => query.refetch().then(() => undefined),
    /** Starts the lesson (or resumes its active run); `restart` begins it anew. */
    async start(restart = false) {
      if (!edition) return;
      const started = await json(
        api.runs.$post({
          json: { series, lessonKey: lessonKey as LessonKey, edition, restart },
        }),
      );
      client.setQueryData<Loaded | null>(key, started);
      if (restart) refreshProgress();
    },
    pageShown: (pageIndex: number) =>
      record([{ id: ulid(), type: "page_shown", payload: { pageIndex } }]),
    done,
    practice,
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
    /** Sends what is queued; resolves once it is stored. */
    flush,
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
