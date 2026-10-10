// Downloads of speech models and voices (08): one at a time per id, their progress, why one failed,
// cancel — what whisper-server's models, Piper's voices and Qwen3-TTS's models share.

interface Download {
  /** Bytes so far. */
  done: number;
  /** All it fetches, when that is more than the model's own size (a model with its codec). */
  total?: number;
  controller: AbortController;
  error?: string;
}

/** Downloads of models or voices by id: one at a time each; a finished or cancelled one is forgotten,
 *  a failed one kept with its error until it is started again or cancelled. */
export function createModelDownloads() {
  const downloads = new Map<string, Download>();
  const going = (id: string) => {
    const d = downloads.get(id);
    return d && !d.error ? d : undefined;
  };
  return {
    /** Whether a download of `id` is under way. */
    going: (id: string) => !!going(id),
    /** Starts `job` for `id` unless one is under way; it tells the bytes so far through `progress`. */
    start(
      id: string,
      job: (progress: (bytes: number) => void, signal: AbortSignal) => Promise<void>,
      total?: number,
    ) {
      if (going(id)) return;
      const entry: Download = { done: 0, total, controller: new AbortController() };
      downloads.set(id, entry);
      const { signal } = entry.controller;
      job((n) => (entry.done = n), signal)
        .then(() => {
          if (downloads.get(id) === entry) downloads.delete(id);
        })
        .catch((error: unknown) => {
          // Cancelled: forgotten already.
          if (!signal.aborted) entry.error = String(error).slice(0, 200);
        });
    },
    /** Stops a download of `id` and forgets it. */
    cancel(id: string) {
      downloads.get(id)?.controller.abort();
      downloads.delete(id);
    },
    /** What the state shows of `id`: the bytes so far while it goes, or why it failed. */
    of(id: string): { downloaded?: number; error?: string } {
      const d = downloads.get(id);
      if (!d) return {};
      return d.error ? { error: d.error } : { downloaded: d.done };
    },
    /** All a download under way fetches, when it was given. */
    total: (id: string) => going(id)?.total,
  };
}

/** Waits for `promise`, or rejects once `signal` aborts (what it waits for goes on); the signal is let
 *  go once either happens. */
export const untilAborted = <T>(promise: Promise<T>, signal: AbortSignal) =>
  new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("cancelled"));
    if (signal.aborted) {
      // What it waits for goes on: its failure is nobody's to see now.
      promise.catch(() => {});
      return abort();
    }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
