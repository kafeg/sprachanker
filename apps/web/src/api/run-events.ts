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
class NoRun extends Error {}
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
  let changed = false;
  const out = events.map((e): TypedEvent => {
    if (e.type !== "answered") return e;
    const outcome = stored.outcomes[e.id];
    const attempt = stored.attempts[e.id];
    const sameOutcome = !outcome || JSON.stringify(outcome) === JSON.stringify(e.payload.outcome);
    if (sameOutcome && (attempt === undefined || attempt === e.payload.attempt)) return e;
    changed = true;
    return {
      ...e,
      payload: {
        ...e.payload,
        ...(outcome && { outcome }),
        ...(attempt !== undefined && { attempt }),
      },
    };
  });
  // Nothing told otherwise than shown: the same array, so the cached state is left as it is.
  return changed ? out : events;
}

/** How a run's events are sent: `runOf` names the run a batch goes to (none: dropped), `post` sends
 *  it (`init`: the request's options — `keepalive` as the page closes). */
export interface RunPost<E> {
  runOf(batch: readonly E[]): string | undefined;
  post(runId: string, batch: readonly E[], init?: RequestInit): Promise<Stored>;
}

/** An outbox kept for its run: how many pages show the run now. */
interface Entry {
  outbox: Outbox<never>;
  users: number;
}
const outboxes = new Map<string, Entry>();
/** Each outbox's place in `outboxes` and how its events are sent. */
const homeOf = new WeakMap<object, { id: string; sending: RunPost<never> }>();

/**
 * The outbox of a run state cached under `key` (its `events` updated with what the server stored),
 * one per profile and key for as long as a page shows the run or events wait in it.
 */
export function runOutbox<E extends { id: string }>(
  client: QueryClient,
  key: readonly unknown[],
  options: RunPost<E> & { batchKey?: OutboxOptions<E>["batchKey"] },
): Outbox<E> {
  const profile = signedIn(client);
  const id = JSON.stringify([profile, ...key]);
  const found = outboxes.get(id);
  if (found) return found.outbox as unknown as Outbox<E>;
  const outbox = createOutbox<E>({
    batchKey: options.batchKey,
    async send(batch) {
      if (signedIn(client) !== profile) throw new NotSignedIn();
      const runId = options.runOf(batch);
      if (!runId) throw new NoRun();
      const stored = await options.post(runId, batch);
      const state = client.getQueryData<{ events: TypedEvent[] } | null>(key);
      const events = state && withStored(state.events, stored);
      if (state && events !== state.events) client.setQueryData(key, { ...state, events });
    },
    // A lost session (401) or a request that reached the wrong host (421) is no refusal: the
    // events wait for the learner to be back.
    refused: (e) => e instanceof NoRun || refusedByServer(e),
    // A batch refused: the run is read again.
    onRefused: () => void client.invalidateQueries({ queryKey: key }),
  });
  outboxes.set(id, { outbox: outbox as unknown as Outbox<never>, users: 0 });
  homeOf.set(outbox, { id, sending: options as unknown as RunPost<never> });
  return outbox;
}

/** While a page shows a run: its outbox is the run's (one released meanwhile — React's StrictMode
 *  mounts a page twice — is put back); what is still queued goes out with `keepalive` as the page
 *  closes (it outlives the page; events are idempotent by id, so one also in flight is stored once).
 *  The outbox goes when no page shows its run and nothing waits in it. */
export function useRunOutbox<E>(outbox: Outbox<E>) {
  useEffect(() => {
    const home = homeOf.get(outbox);
    const entry = home && (outboxes.get(home.id) ?? { outbox: outbox as Outbox<never>, users: 0 });
    // Another outbox took the run's place (this one was released and the run opened anew).
    if (!home || !entry || entry.outbox !== (outbox as unknown)) return;
    outboxes.set(home.id, entry);
    entry.users++;
    const onHide = () => {
      const batch = outbox.nextBatch() as readonly never[];
      const runId = batch.length ? home.sending.runOf(batch) : undefined;
      if (runId) home.sending.post(runId, batch, { keepalive: true }).catch(() => {});
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      entry.users--;
      if (!entry.users && !outbox.pending().length) outboxes.delete(home.id);
    };
  }, [outbox]);
}
