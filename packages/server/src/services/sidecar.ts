// A local engine run on demand (06, "Sidecars"): a process serving HTTP on a free 127.0.0.1 port —
// today whisper-server (08), later the speech synthesiser. One process at a time, for one setup (a
// model): started once however many requests ask at the same moment, ready when its health check
// answers, stopped after a while without requests, started again after it exits. A request for another
// setup waits for the requests in flight before the process is replaced.
import type { ErrorCode } from "@sprachanker/schema";
import { ServiceError } from "../errors.ts";

export interface SidecarProcess {
  exited: Promise<number>;
  kill(): void;
}

export interface SidecarOptions {
  /** Starts the process for a setup, listening on `port`. */
  spawn(setup: string, port: number): SidecarProcess;
  freePort(): Promise<number>;
  fetch: typeof fetch;
  /** The error code a start that never became ready gives. */
  failed: ErrorCode;
  /** How long a start may take (loading a model), and how long the process stays without requests. */
  startMs: number;
  idleMs: number;
  healthPath?: string;
}

interface Running {
  setup: string;
  /** Resolves with the base URL once the process answers its health check. */
  ready: Promise<string>;
  proc?: SidecarProcess;
  exited: boolean;
  /** Stopped (maybe while still starting): a process spawned after is killed at once. */
  stopped: boolean;
  /** Requests using it now, and those waiting for it to be free. */
  inFlight: number;
  drained: Array<() => void>;
  idle?: ReturnType<typeof setTimeout>;
}

export function createSidecar(options: SidecarOptions) {
  const { healthPath = "/health" } = options;
  let current: Running | undefined;
  /** Starting and switching happen one at a time. */
  let turn: Promise<unknown> = Promise.resolve();

  function stop(run: Running | undefined = current) {
    if (!run) return;
    run.stopped = true;
    if (run.idle) clearTimeout(run.idle);
    run.proc?.kill();
    if (current === run) current = undefined;
  }

  const drained = (run: Running) =>
    run.inFlight === 0 ? Promise.resolve() : new Promise<void>((r) => run.drained.push(r));

  function start(setup: string): Running {
    const run: Running = {
      setup,
      exited: false,
      stopped: false,
      inFlight: 0,
      drained: [],
      ready: undefined as never,
    };
    run.ready = (async () => {
      const port = await options.freePort();
      const url = `http://127.0.0.1:${port}`;
      if (run.stopped) throw new ServiceError(options.failed, 502);
      const proc = options.spawn(setup, port);
      run.proc = proc;
      if (run.stopped) proc.kill();
      void proc.exited.then(() => {
        run.exited = true;
        if (current === run) current = undefined;
      });
      const until = Date.now() + options.startMs;
      while (Date.now() < until && !run.exited && !run.stopped) {
        const ok = await options
          .fetch(`${url}${healthPath}`, { signal: AbortSignal.timeout(2000) })
          .then((r) => r.ok)
          .catch(() => false);
        if (ok) return url;
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new ServiceError(options.failed, 502);
    })();
    // A start that fails leaves nothing behind; the next request starts afresh.
    run.ready.catch(() => stop(run));
    return run;
  }

  /** The process for a setup, counted as in use until `release`; started or switched to when needed. */
  function acquire(setup: string): Promise<Running> {
    const next = turn.then(async () => {
      if (current && current.setup !== setup) {
        const old = current;
        await drained(old);
        stop(old);
      }
      if (!current || current.exited) current = start(setup);
      const run = current;
      run.inFlight++;
      if (run.idle) clearTimeout(run.idle);
      return run;
    });
    turn = next.catch(() => {});
    return next;
  }

  function release(run: Running) {
    run.inFlight--;
    if (run.inFlight > 0) return;
    for (const resolve of run.drained.splice(0)) resolve();
    if (current === run) run.idle = setTimeout(() => stop(run), options.idleMs);
  }

  /** Runs `call` with the process's base URL, the process kept for the setup meanwhile. A call
   *  failing with the engine's own failure (`failed`: it did not answer, or not in time) stops the
   *  process — a stuck engine would hold every later request behind it — and the next starts afresh. */
  async function use<T>(setup: string, call: (url: string) => Promise<T>): Promise<T> {
    const run = await acquire(setup);
    try {
      return await call(await run.ready);
    } catch (error) {
      if (error instanceof ServiceError && error.code === options.failed) stop(run);
      throw error;
    } finally {
      release(run);
    }
  }

  return {
    use,
    /** Starts the process ahead of a request (loading takes seconds). */
    warm(setup: string) {
      void use(setup, async () => {}).catch(() => {});
    },
    /** The setup running now, if any. */
    setup: () => current?.setup,
    /** Stops the process (its setup removed, or the server stopping). */
    stop: () => stop(),
  };
}
