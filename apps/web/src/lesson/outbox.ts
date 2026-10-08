// Events on their way to the server (05; 09): sent in order, in batches, retried until stored. A batch
// the server refuses (4xx) is dropped — sending it again cannot succeed — and the caller is told, so
// it reads the run again. Events are idempotent by id: one sent twice (a retry, the copy sent as the
// page closes) is stored once. Plain, so it is tested without React; the planned offline outbox
// (IndexedDB) keeps this contract.

export interface OutboxOptions<E> {
  /** Stores a batch; throws when it is not stored. */
  send(batch: E[]): Promise<void>;
  /** Whether a failure is the server refusing the batch (dropped) rather than not reaching it. */
  refused(error: unknown): boolean;
  /** A batch was refused and dropped. */
  onRefused(): void;
  /** Waits before a retry (tests pass their own). */
  wait?: (ms: number) => Promise<void>;
  batchSize?: number;
  retryMs?: number;
}

export function createOutbox<E>(options: OutboxOptions<E>) {
  const {
    batchSize = 50,
    retryMs = 3000,
    wait = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  } = options;
  let queue: E[] = [];
  let sending: Promise<void> | null = null;

  async function drain() {
    while (queue.length) {
      const batch = queue.slice(0, batchSize);
      try {
        await options.send(batch);
        queue = queue.slice(batch.length);
      } catch (error) {
        if (options.refused(error)) {
          queue = queue.slice(batch.length);
          options.onRefused();
        } else await wait(retryMs);
      }
    }
  }

  return {
    push(events: E[]) {
      queue.push(...events);
    },
    /** Sends what is queued, in order; resolves once the queue is empty (events queued meanwhile
     *  included). One sending at a time: a call while it runs gets the same promise. */
    flush(): Promise<void> {
      if (!sending)
        sending = drain().finally(() => {
          sending = null;
        });
      return sending;
    },
    /** What is still to send (for the copy sent as the page closes). */
    pending: (): readonly E[] => queue.slice(0, batchSize),
    /** Forgets what is queued (the run is read again). */
    clear() {
      queue = [];
    },
  };
}
export type Outbox<E> = ReturnType<typeof createOutbox<E>>;
