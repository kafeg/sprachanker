// Supervises one llama-server process (06, "Sidecars and models"): started on demand for a model,
// replaced when another model is asked for, stopped after a while without use or with the app.
// A crashed process is started again on the next request.
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import type { RunState } from "../services/llm.ts";

export interface LlamaServerOptions {
  /** The llama-server executable and the folder with its libraries. */
  binary: string;
  cwd: string;
  /** Runs this command instead of `binary` (tests: a stand-in script run by Bun). */
  command?: string[];
  idleMs?: number;
  startTimeoutMs?: number;
}

const CONTEXT = 8192;

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

export function createLlamaServer(options: LlamaServerOptions) {
  const idleMs = options.idleMs ?? 20 * 60_000;
  const startTimeoutMs = options.startTimeoutMs ?? 300_000;
  let current:
    | { model: string; child: ChildProcess; url: Promise<string>; state: RunState }
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

  async function start(model: string, modelPath: string): Promise<string> {
    const port = await freePort();
    const [program = options.binary, ...prefix] = options.command ?? [options.binary];
    const args = [
      ...prefix,
      "-m",
      modelPath,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "-c",
      String(CONTEXT),
      // Learners get the answer at once; thinking would only add waiting (07).
      "--reasoning",
      "off",
      "--no-webui",
      "--alias",
      model,
    ];
    const child = spawn(program, args, {
      cwd: options.cwd,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const log: string[] = [];
    // Error lines without llama.cpp's "0.15.140.804 E srv    " prefix, for the learner-facing message.
    child.stderr?.setEncoding("utf8").on("data", (text: string) => {
      for (const line of text.split("\n")) {
        const m = /^(?:[\d.]+ E \w+\s+|error:\s*)(.*)$/.exec(line.trim());
        if (m?.[1]) log.push(m[1]);
      }
      log.splice(0, Math.max(0, log.length - 5));
    });
    const run = {
      model,
      child,
      state: { model, state: "starting" } as RunState,
      url: Promise.resolve(""),
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
          throw fail(log.slice(-3).join(" ") || `llama-server exited with ${child.exitCode}`);
        }
        const ok = await fetch(`${url}/health`)
          .then((r) => r.ok)
          .catch(() => false);
        if (ok) {
          run.state = { model, state: "ready" };
          return `${url}/v1`;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      child.kill("SIGKILL");
      throw fail("llama-server did not start in time");
    })();
    return run.url;
  }

  return {
    /** Base URL (…/v1) of llama-server running `model`, started or switched as needed. */
    async endpoint(model: string, modelPath: string): Promise<string> {
      clearTimeout(idle);
      idle = setTimeout(() => void stop(), idleMs);
      idle.unref?.();
      if (current?.model === model && current.state.state !== "failed") return current.url;
      await stop();
      return start(model, modelPath);
    },
    state(): RunState | null {
      return current?.state ?? null;
    },
    /** Stops the process if it runs `model` (before the model file is removed), or any process. */
    stop(model?: string): Promise<void> {
      if (model && current?.model !== model) return Promise.resolve();
      clearTimeout(idle);
      return stop();
    },
  };
}
export type LlamaServer = ReturnType<typeof createLlamaServer>;
