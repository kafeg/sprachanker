// Model calls still running (07): what each one is doing, by key (a lesson), so a page opened meanwhile —
// after leaving it, a reload, another device — shows it instead of offering to start again, and a
// second one of the same kind is refused until the first is done. The calls run to their end even when
// the page that asked for them is gone: their result is kept and shown on return.
import { ServiceError } from "../errors.ts";

export function createInFlight<T>(busy: string) {
  const running = new Map<string, T>();
  return {
    /** What is running for a key, if anything. */
    get: (key: string): T | undefined => running.get(key),
    /** Runs `call` as `what` for `key`; 409 `busy` while another runs for it. */
    async run<R>(key: string, what: T, call: () => Promise<R>): Promise<R> {
      if (running.has(key)) throw new ServiceError(busy, 409);
      running.set(key, what);
      try {
        return await call();
      } finally {
        running.delete(key);
      }
    },
  };
}
