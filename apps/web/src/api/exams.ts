// The exams through the API (09, Exams): the installed exams with the learner's standing, an exam's
// page, and a run — started, read, answered (through an outbox, as a lesson's answers go), handed in.
import type { ExamKey, ExamMode, ExamRun, Outcome, TypedEvent } from "@sprachanker/schema";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { ulid } from "ulid";
import { api, json } from "./client.ts";
import { runOutbox, useRunOutbox } from "./run-events.ts";

export const useExams = () =>
  useQuery({ queryKey: ["exams"], queryFn: () => json(api.exams.$get()) });
export type ExamRow = NonNullable<ReturnType<typeof useExams>["data"]>[number];

export const useExamPage = (exam: string, edition: string | undefined) =>
  useQuery({
    queryKey: ["exam", exam, edition],
    enabled: !!edition,
    queryFn: () => json(api.exams.page.$get({ query: { exam, edition: edition as string } })),
  });

/** What a run's page shows: the run, and its answers (a running mock exam's without outcomes); `skew`
 *  is how far the server's clock is ahead of this device's (ms), so the countdown keeps to the
 *  server's deadline. */
export interface ExamRunState {
  run: ExamRun;
  events: TypedEvent[];
  skew: number;
}

const runKey = (runId: string) => ["exam-run", runId] as const;

/** A run as the server gives it, with this device's clock compared to the server's. */
const withSkew = ({ now, run, events }: { now: number; run: ExamRun; events: unknown[] }) => ({
  run,
  events: events as TypedEvent[],
  skew: now - Date.now(),
});

export function useStartExam() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { exam: ExamKey; edition: string; mode: ExamMode; module?: string }) =>
      json(api.exams.runs.$post({ json: input })),
    onSuccess: (state) => {
      client.setQueryData<ExamRunState>(runKey(state.run.id), withSkew(state));
      void client.invalidateQueries({ queryKey: ["exams"] });
      void client.invalidateQueries({ queryKey: ["exam"] });
    },
  });
}

/** An answer on its way: its event and the run it belongs to. */
interface Queued {
  id: string;
  type: "answered";
  itemKey: string;
  payload: { answer: unknown; attempt: number; ms: number };
}

/** The run's outbox (api/run-events, as a lesson's): the server's outcomes (practice's) and
 *  attempts take the place of the local ones. */
const outboxOf = (client: QueryClient, runId: string) =>
  runOutbox<Queued>(client, runKey(runId), {
    runOf: () => runId,
    post: (id, events, init) =>
      json(
        api.exams.runs[":id"].events.$post(
          { param: { id }, json: { events: [...events] } },
          init && { init },
        ),
      ),
  });

/** A run with its answers; `answer` records one (shown at once, sent in order), `finish` hands the run
 *  in once every answer is stored. */
export function useExamRun(runId: string) {
  const client = useQueryClient();
  const outbox = useMemo(() => outboxOf(client, runId), [client, runId]);
  const query = useQuery({
    queryKey: runKey(runId),
    queryFn: async (): Promise<ExamRunState> => {
      const state = withSkew(await json(api.exams.runs[":id"].$get({ param: { id: runId } })));
      // Answers still on their way stay shown.
      const pending = outbox
        .pending()
        .map((e) => ({ ...e, runId, ts: Date.now(), cardId: null }) as unknown as TypedEvent);
      return { ...state, events: [...state.events, ...pending] };
    },
  });
  // Leaving or reloading the page: the answers still queued go out as the page closes.
  useRunOutbox(outbox);
  const finish = useMutation({
    mutationFn: async () => {
      await outbox.flush();
      return json(api.exams.runs[":id"].finish.$post({ param: { id: runId } }));
    },
    onSuccess: (state) => {
      client.setQueryData<ExamRunState>(runKey(runId), withSkew(state));
      void client.invalidateQueries({ queryKey: ["exams"] });
      void client.invalidateQueries({ queryKey: ["exam"] });
      void client.invalidateQueries({ queryKey: ["notebook"] });
    },
  });
  const answer = (itemKey: string, value: unknown, ms: number, outcome?: Outcome) => {
    const state = client.getQueryData<ExamRunState>(runKey(runId));
    const attempt =
      (state?.events.filter((e) => e.type === "answered" && e.itemKey === itemKey).length ?? 0) + 1;
    const event: Queued = {
      id: ulid(),
      type: "answered",
      itemKey,
      payload: { answer: value, attempt, ms },
    };
    // Shown at once (practice with the engine's own outcome, the server's replacing it).
    client.setQueryData<ExamRunState>(
      runKey(runId),
      (s) =>
        s && {
          ...s,
          events: [
            ...s.events,
            {
              ...event,
              runId,
              ts: Date.now(),
              cardId: null,
              payload: { ...event.payload, ...(outcome && { outcome }) },
            } as unknown as TypedEvent,
          ],
        },
    );
    outbox.push([event]);
    void outbox.flush();
  };
  /** The run's events as they are this moment (an answer just recorded included, before the page
   *  shows it). */
  const eventsNow = () => client.getQueryData<ExamRunState>(runKey(runId))?.events ?? [];
  return { query, answer, finish, eventsNow };
}

/** Events kept elsewhere in the run (the assistant's proposal, a conversation's lines), shown with
 *  its events at once. */
export function useKeepRunEvents(runId: string) {
  const client = useQueryClient();
  return (kept: TypedEvent | TypedEvent[]) => {
    const list = Array.isArray(kept) ? kept : [kept];
    const ids = new Set(list.map((e) => e.id));
    client.setQueryData<ExamRunState>(
      runKey(runId),
      (s) => s && { ...s, events: [...s.events.filter((e) => !ids.has(e.id)), ...list] },
    );
  };
}

/** An open answer rated by its criteria (by the learner, or the assistant's proposal taken): the run
 *  comes back with its result computed anew. */
export function useRateAnswer(runId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      itemKey: string;
      ratings: Record<string, number>;
      by: "self" | "assistant";
      model?: string;
    }) =>
      json(
        api.exams.runs[":id"].ratings.$post({
          param: { id: runId },
          json: { id: ulid(), ...input },
        }),
      ),
    onSuccess: (state) => {
      client.setQueryData<ExamRunState>(runKey(runId), withSkew(state));
      void client.invalidateQueries({ queryKey: ["exams"] });
      void client.invalidateQueries({ queryKey: ["exam"] });
      void client.invalidateQueries({ queryKey: ["notebook"] });
    },
  });
}
