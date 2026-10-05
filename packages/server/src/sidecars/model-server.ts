// Supervises one model server process (06, "Sidecars and models"): llama-server or mlx_lm.server,
// started on demand for a model, replaced when another model or engine is asked for, stopped after a
// while without use or with the app. A crashed process is started again on the next request.
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import type { RunState } from "../services/llm.ts";

/** How to start a server for one model on a port (from the engine). */
export interface Launch {
  argv: string[];
  cwd: string;
  env?: Record<string, string>;
  /** The model name requests must carry. */
  requestModel: string;
}

export interface ModelServerOptions {
  idleMs?: number;
  startTimeoutMs?: number;
}

export interface Endpoint {
  baseUrl: string;
  model: string;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });
}

export function createModelServer(options: ModelServerOptions = {}) {
  const idleMs = options.idleMs ?? 20 * 60_000;
  const startTimeoutMs = options.startTimeoutMs ?? 300_000;
  let current:
    | { key: string; model: string; child: ChildProcess; url: Promise<Endpoint>; state: RunState }
    | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  // Never leave a model loaded in memory after the app is gone.
  process.once("exit", () => current?.child.kill("SIGKILL"));

  function stop(): Promise<void> {
    const run = current;
    current = undefined;
    if (!run || run.child.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      run.child.once("exit", () => resolve());
      run.child.kill("SIGTERM");
      setTimeout(() => run.child.kill("SIGKILL"), 5000).unref();
    });
  }

  async function start(
    key: string,
    model: string,
    launch: (port: number) => Launch,
  ): Promise<Endpoint> {
    const port = await freePort();
    const { argv, cwd, env, requestModel } = launch(port);
    const [program = "", ...args] = argv;
    const child = spawn(program, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const log: string[] = [];
    // Error lines for the learner-facing message: llama.cpp's "0.15.140.804 E srv    …" (prefix
    // dropped) and Python's "ValueError: …" (mlx_lm).
    child.stderr?.setEncoding("utf8").on("data", (text: string) => {
      for (const line of text.split("\n").map((l) => l.trim())) {
        const llama = /^(?:[\d.]+ E \w+\s+|error:\s*)(.+)$/.exec(line)?.[1];
        const python = /^[A-Za-z.]*(?:Error|Exception): .+$/.test(line) ? line : undefined;
        if (llama ?? python) log.push((llama ?? python) as string);
      }
      log.splice(0, Math.max(0, log.length - 5));
    });
    const run = {
      key,
      model,
      child,
      state: { model, state: "starting" } as RunState,
      url: Promise.resolve({ baseUrl: "", model: requestModel }),
    };
    current = run;
    const fail = (error: string) => {
      run.state = { model, state: "failed", error };
      return new Error(error);
    };
    // A crash after start clears the run (the next request starts it again); a failed start stays
    // visible as `failed` until another request.
    child.once("exit", () => {
      if (run.state.state === "ready" && current === run) current = undefined;
    });
    run.url = (async () => {
      const url = `http://127.0.0.1:${port}`;
      const deadline = Date.now() + startTimeoutMs;
      while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw fail(log.slice(-3).join(" ") || `the model server exited with ${child.exitCode}`);
        }
        const ok = await fetch(`${url}/health`)
          .then((r) => r.ok)
          .catch(() => false);
        if (ok) {
          run.state = { model, state: "ready" };
          return { baseUrl: `${url}/v1`, model: requestModel };
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      child.kill("SIGKILL");
      throw fail("the model server did not start in time");
    })();
    return run.url;
  }

  return {
    /**
     * Endpoint of a server for `model`, started or replaced as needed. `key` identifies what runs
     * (engine + model): a different key restarts the process.
     */
    async endpoint(
      key: string,
      model: string,
      launch: (port: number) => Launch,
    ): Promise<Endpoint> {
      clearTimeout(idle);
      idle = setTimeout(() => void stop(), idleMs);
      idle.unref?.();
      if (current?.key === key && current.state.state !== "failed") return current.url;
      await stop();
      return start(key, model, launch);
    },
    state(): RunState | null {
      return current?.state ?? null;
    },
    /** Stops the process if it runs `key` (before its model is removed), or any process. */
    stop(key?: string): Promise<void> {
      if (key && current?.key !== key) return Promise.resolve();
      clearTimeout(idle);
      return stop();
    },
  };
}
export type ModelServer = ReturnType<typeof createModelServer>;
