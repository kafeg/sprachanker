// An engine of the built-in model (07, "Built-in model"): something that can be installed into the
// data root and then serve one model over an OpenAI-compatible HTTP API.
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { ModelFormat } from "@sprachanker/llm";

export type EngineId = "llama" | "mlx";

export interface InstallProgress {
  /** Bytes of the engine's own download so far. */
  received: number;
  /** After the download: unpacking, setting up Python packages… */
  phase: "download" | "setup";
}

export interface Engine {
  id: EngineId;
  format: ModelFormat;
  /** Upstream version the engine is pinned to. */
  version: string;
  /** Rough size on disk after installation, for the UI. */
  installSize: number;
  /** Bytes the first step downloads (shown as progress). */
  downloadSize: number;
  /** Whether this machine can run it at all. */
  available: boolean;
  installed(): boolean;
  install(o: {
    fetch: typeof fetch;
    signal: AbortSignal;
    onProgress(p: InstallProgress): void;
  }): Promise<void>;
  /** How to serve a model (a file for GGUF, a folder for MLX) on a port. */
  serve(
    model: string,
    port: number,
    alias: string,
  ): {
    argv: string[];
    cwd: string;
    env?: Record<string, string>;
    /** The model name requests must carry. */
    requestModel: string;
  };
}

/** Runs a command; rejects with its stderr. */
export function run(argv: string[], env?: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const [program = "", ...args] = argv;
    const child = spawn(program, args, {
      stdio: ["ignore", "ignore", "pipe"],
      env: env ? { ...process.env, ...env } : process.env,
    });
    let err = "";
    child.stderr.setEncoding("utf8").on("data", (t: string) => {
      err = (err + t).slice(-2000);
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${basename(program)}: ${err.trim()}`)),
    );
  });
}

/** Unpacks .tar.gz or .zip with the system `tar` (bsdtar on macOS and Windows 10+, GNU tar on Linux). */
export const untar = (archive: string, dir: string) => run(["tar", "-xf", archive, "-C", dir]);

/** Path of the first file called `name` below `dir`, relative to it. */
export function findFile(dir: string, name: string): string | undefined {
  return (readdirSync(dir, { recursive: true }) as string[]).find((f) => basename(f) === name);
}

export const engineDir = (root: string, id: string, version: string) =>
  join(root, `${id}-${version}-${process.platform}-${process.arch}`);
