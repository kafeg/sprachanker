// Events on their way to the server (05; 09): sent in order, in batches of one run, retried until
// stored — sooner at first, then less often (doubling up to a minute) while the server cannot be
// reached or fails; asked to send meanwhile, it tries again at once. A batch the server refuses is dropped — sending it again cannot succeed — and the
// caller is told, so it reads the run again; the caller decides what counts as refused. Events are
// idempotent by id: one sent twice (a retry, the copy sent as the page closes) is stored once. Plain,
// so it is tested without React; the planned offline outbox (IndexedDB) keeps this contract.

export interface OutboxOptions<E> {
  /** Stores a batch; throws when it is not stored. */
  send(batch: E[]): Promise<void>;
  /** Whether a failure is the server refusing the batch (dropped) rather than not reaching it. */
  refused(error: unknown): boolean;
  /** A batch was refused and dropped. */
  onRefused(): void;
  /** What a batch shares (the run its events belong to): a batch never mixes two. */
  batchKey?: (event: E) => string;
  /** Waits before a retry (tests pass their own). */
  wait?: (ms: number) => Promise<void>;
  batchSize?: number;
  /** The first wait before a retry; each failure in a row doubles it, up to `maxRetryMs`. */
  retryMs?: number;
  maxRetryMs?: number;
}

export function createOutbox<E>(options: OutboxOptions<E>) {
  const {
    batchSize = 50,
    retryMs = 2000,
    maxRetryMs = 60_000,
    batchKey = () => "",
    wait = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  } = options;
  let queue: E[] = [];
  let sending: Promise<void> | null = null;
  /** Ends the wait before the next retry (a flush asked for meanwhile). */
  let wake: (() => void) | undefined;
  /** Events stored so far, in order (a reader marks where it started: `mark`, `storedSince`). */
  const stored: E[] = [];

  /** The next batch: the first events, as many as fit, all with the first one's key. */
  const nextBatch = () => {
    const first = queue[0] as E;
    const end = queue.findIndex((e, i) => i >= batchSize || batchKey(e) !== batchKey(first));
    return queue.slice(0, end < 0 ? queue.length : end);
  };

  async function drain() {
    let delay = retryMs;
    while (queue.length) {
      const batch = nextBatch();
      try {
        await options.send(batch);
        queue = queue.slice(batch.length);
        stored.push(...batch);
        delay = retryMs;
      } catch (error) {
        if (options.refused(error)) {
          queue = queue.slice(batch.length);
          options.onRefused();
        } else {
          await new Promise<void>((resolve) => {
            wake = resolve;
            void wait(delay).then(resolve);
          });
          wake = undefined;
          delay = Math.min(delay * 2, maxRetryMs);
        }
      }
    }
  }

  return {
    push(events: E[]) {
      queue.push(...events);
    },
    /** Sends what is queued, in order; resolves once the queue is empty (events queued meanwhile
     *  included). One sending at a time: a call while it runs gets the same promise, and one while it
     *  waits to retry ends the wait. */
    flush(): Promise<void> {
      wake?.();
      if (!sending)
        sending = drain().finally(() => {
          sending = null;
        });
      return sending;
    },
    /** What is still to send, in order. */
    pending: (): readonly E[] => queue,
    /** Where the stored events are now: what is stored after it is `storedSince` that mark. */
    mark: (): number => stored.length,
    storedSince: (mark: number): readonly E[] => stored.slice(mark),
    /** The next batch (for the copy sent as the page closes). */
    nextBatch: (): readonly E[] => (queue.length ? nextBatch() : []),
    /** Forgets what is queued (the run is read again). */
    clear() {
      queue = [];
    },
  };
}
export type Outbox<E> = ReturnType<typeof createOutbox<E>>;
