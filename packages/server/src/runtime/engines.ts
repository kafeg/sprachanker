// The speech engines built in native/: which they are, where each one is — named by its
// environment variable, beside the app's binary (the desktop app bundles them there), else built in the
// repository — and the processes of those run on a local port, which go with the server.
// native/scripts/build.ts and apps/cli/scripts/build.ts take the engines and the triple from here.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { processName } from "./process-name.ts";

/** This machine's target triple: an engine built for it is `<program>-<triple>`. */
export const triple = `${process.arch === "arm64" ? "aarch64" : "x86_64"}-${
  process.platform === "darwin"
    ? "apple-darwin"
    : process.platform === "win32"
      ? "pc-windows-msvc"
      : "unknown-linux-gnu"
}`;

/** A program's suffix on this system (Windows: `.exe`). */
export const EXE = process.platform === "win32" ? ".exe" : "";

/** Each engine: its folder in native/, its program, the variable that may name it. */
export const ENGINES = {
  whisper: { folder: "whisper", program: "whisper-server", env: "SPRACHANKER_WHISPER_SERVER" },
  piper: { folder: "piper", program: "sherpa-onnx-offline-tts", env: "SPRACHANKER_PIPER" },
  qwen: { folder: "qwen", program: "tts-server", env: "SPRACHANKER_QWEN" },
} as const;
export type EngineName = keyof typeof ENGINES;

/** Where an engine's program is, if it is anywhere. */
export function engineAt(name: EngineName) {
  const { folder, program, env } = ENGINES[name];
  return [
    process.env[env],
    join(dirname(process.execPath), `${program}-${triple}${EXE}`),
    join(dirname(process.execPath), `${program}${EXE}`),
    join(import.meta.dir, "../../../../native", folder, "out", `${program}-${triple}${EXE}`),
  ].find((p): p is string => !!p && existsSync(p));
}

/** A free port on 127.0.0.1. */
export const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });

/** How much of the end of an engine's stderr is kept. */
const STDERR_KEPT = 4000;

/** Engines run on a local port go with the server — on its exit and on the signals that stop it — so
 *  none is left holding a model in memory. Their pids are kept in `pidFile`, so those a server killed
 *  outright left are stopped when the next one starts. */
export function engineProcesses(pidFile: string) {
  const running = new Map<number, { kill(): void }>();
  const writePids = () => {
    if (running.size) {
      mkdirSync(dirname(pidFile), { recursive: true });
      writeFileSync(pidFile, [...running.keys()].join("\n"));
    } else rmSync(pidFile, { force: true });
  };
  stopLeftOver(pidFile);
  const stopAll = () => {
    for (const proc of running.values()) proc.kill();
    running.clear();
    writePids();
  };
  process.once("exit", stopAll);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.once(signal, () => {
      stopAll();
      process.exit(0);
    });
  /** Runs an engine, kept in the pid file while it runs; the end of what it says on stderr kept (a
   *  start that fails logs it). */
  return (args: string[]) => {
    const proc = Bun.spawn(args, { stdout: "ignore", stderr: "pipe" });
    running.set(proc.pid, proc);
    writePids();
    void proc.exited.then(() => {
      running.delete(proc.pid);
      writePids();
    });
    let said = "";
    void (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of proc.stderr)
        said = (said + decoder.decode(chunk, { stream: true })).slice(-STDERR_KEPT);
    })().catch(() => {});
    return { exited: proc.exited, kill: () => proc.kill(), stderr: () => said };
  };
}

/** Stops engines a killed server left running (only processes that are its engines; the server
 *  starting holds the data folder, so none of them is another server's). */
function stopLeftOver(file: string) {
  const pids = (existsSync(file) ? readFileSync(file, "utf8") : "")
    .split("\n")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  for (const pid of pids) {
    try {
      // Without its name (Windows) the pid alone is not trusted enough to stop it.
      const name = processName(pid);
      if (name && (name.includes(ENGINES.whisper.program) || name.includes(ENGINES.qwen.program)))
        process.kill(pid);
    } catch {
      // Gone meanwhile, or not ours to stop.
    }
  }
  rmSync(file, { force: true });
}
