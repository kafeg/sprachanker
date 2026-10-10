// A run's events on their way to the server (05, "Sending"), the same for every module's runs (a
// lesson's, an exam's): one outbox per profile and run state for the page's life — the events of a
// profile signed out wait until it is back, a page opened again sends on after what it queued
// before —, the server's outcome and attempt of each answer put in place of the local ones, and what
// is still queued sent with `keepalive` as the page closes. An outbox nothing waits in goes once its
// page does.
import type { Outcome, TypedEvent } from "@sprachanker/schema";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { refusedByServer } from "./client.ts";
import { createOutbox, type Outbox, type OutboxOptions } from "./outbox.ts";

/** Events of no run: the run ended or was replaced before they went (dropped). */
export class NoRun extends Error {}
/** Events of a profile not signed in now: they wait for it (another profile cannot store them). */
class NotSignedIn extends Error {}

/** The profile this device is signed in to, as the session query last read it. */
const signedIn = (client: QueryClient) =>
  client.getQueryData<{ profile: { id: string } | null }>(["session"])?.profile?.id ?? "";

/** What the server says of the answers it stored (the stored ones for an answer sent again). */
export interface Stored {
  outcomes: Record<string, Outcome>;
  attempts: Record<string, number>;
}

/** A run's events with the server's outcome and attempt of each answer in place of the local ones
 *  (another device may have answered the item meanwhile; a mock exam tells no outcome). Pure. */
export function withStored(events: TypedEvent[], stored: Stored): TypedEvent[] {
  return events.map((e): TypedEvent => {
    if (e.type !== "answered") return e;
    const outcome = stored.outcomes[e.id];
    const attempt = stored.attempts[e.id];
    if (!outcome && attempt === undefined) return e;
    return {
      ...e,
      payload: {
        ...e.payload,
        ...(outcome && { outcome }),
        ...(attempt !== undefined && { attempt }),
      },
    };
  });
}

const outboxes = new Map<string, Outbox<never>>();

/**
 * The outbox of a run state cached under `key` (its `events` updated with what the server stored):
 * `runOf` names the run a batch goes to (none: dropped), `post` sends it.
 */
export function runOutbox<E extends { id: string }>(
  client: QueryClient,
  key: readonly unknown[],
  options: {
    runOf(batch: E[]): string | undefined;
    post(runId: string, batch: E[]): Promise<Stored>;
    batchKey?: OutboxOptions<E>["batchKey"];
  },
): Outbox<E> {
  const profile = signedIn(client);
  const id = JSON.stringify([profile, ...key]);
  let outbox = outboxes.get(id) as Outbox<E> | undefined;
  if (!outbox) {
    outbox = createOutbox<E>({
      batchKey: options.batchKey,
      async send(batch) {
        if (signedIn(client) !== profile) throw new NotSignedIn();
        const runId = options.runOf(batch);
        if (!runId) throw new NoRun();
        const stored = await options.post(runId, batch);
        client.setQueryData<{ events: TypedEvent[] } | null>(key, (s) =>
          s ? { ...s, events: withStored(s.events, stored) } : s,
        );
      },
      // A lost session (401) or a request that reached the wrong host (421) is no refusal: the
      // events wait for the learner to be back.
      refused: (e) => e instanceof NoRun || refusedByServer(e),
      // A batch refused: the run is read again.
      onRefused: () => void client.invalidateQueries({ queryKey: key }),
    });
    outboxes.set(id, outbox as Outbox<never>);
  }
  return outbox;
}

/** While a page shows a run: what is still queued goes out with `keepalive` as the page closes (it
 *  outlives the page; events are idempotent by id, so one also in flight is stored once); the
 *  outbox goes with the page once nothing waits in it. */
export function useRunOutbox<E>(
  outbox: Outbox<E>,
  sendOnHide: ((batch: readonly E[]) => void) | undefined,
) {
  useEffect(() => {
    if (!sendOnHide) return;
    const onHide = () => {
      const batch = outbox.nextBatch();
      if (batch.length) sendOnHide(batch);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [outbox, sendOnHide]);
  useEffect(
    () => () => {
      if (outbox.pending().length) return;
      for (const [id, o] of outboxes) if (o === (outbox as unknown)) outboxes.delete(id);
    },
    [outbox],
  );
}
