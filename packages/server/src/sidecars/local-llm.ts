// The built-in LLM (07, "Built-in model"): llama.cpp and GGUF models downloaded on the learner's request
// into the data root (engines/, models/llm/), one llama-server process at a time.
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  LOCAL_MODELS,
  type LocalModel,
  localModelUrl,
  recommendedLocalModel,
} from "@sprachanker/llm";
import { download, partFile, partSize } from "../jobs/download.ts";
import type { LocalLlm, LocalLlmStatus } from "../services/llm.ts";
import { type EngineAsset, llamaAsset } from "./llama-release.ts";
import { createLlamaServer, type LlamaServer } from "./llama-server.ts";

/**
 * Installs the engine into `<enginesDir>/llama.cpp-<build>-<platform>` once: downloads the pinned
 * archive (resumable, sha256 checked), unpacks it with the system `tar` (bsdtar on macOS and
 * Windows 10+, GNU tar on Linux; both read the release archives) and returns the llama-server path.
 */
export async function installEngine(
  asset: EngineAsset,
  enginesDir: string,
  fetchFn: typeof fetch,
  onProgress?: (received: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const dir = join(enginesDir, `llama.cpp-${asset.build}-${asset.platform}`);
  const marker = join(dir, ".installed");
  if (existsSync(marker)) return join(dir, readFileSync(marker, "utf8").trim());
  mkdirSync(enginesDir, { recursive: true });
  const archive = join(enginesDir, asset.file);
  if (!existsSync(archive)) {
    await download({ ...asset, dest: archive, fetch: fetchFn, onProgress, signal });
  }
  const work = `${dir}.unpacking`;
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const tar = spawn("tar", ["-xf", archive, "-C", work], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    tar.stderr.setEncoding("utf8").on("data", (t: string) => {
      err += t;
    });
    tar.once("error", reject);
    tar.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`tar: ${err.trim()}`))));
  });
  const exe = process.platform === "win32" ? "llama-server.exe" : "llama-server";
  const binary = (readdirSync(work, { recursive: true }) as string[]).find(
    (f) => basename(f) === exe,
  );
  if (!binary) throw new Error(`${asset.file}: no ${exe} inside`);
  rmSync(dir, { recursive: true, force: true });
  renameSync(work, dir);
  writeFileSync(marker, `${binary}\n`);
  rmSync(archive, { force: true });
  return join(dir, binary);
}

export function createLocalLlm(options: {
  /** Downloaded GGUF files (<data-root>/models/llm). */
  modelsDir: string;
  /** Unpacked engines (<data-root>/engines), one folder per build and platform. */
  enginesDir: string;
  /** The engine release; defaults to the pinned one for this machine (tests pass their own). */
  engine?: EngineAsset | null;
  fetch: typeof fetch;
  memoryGb: number;
  /** Replace llama-server and the model catalog in tests. */
  command?: string[];
  models?: LocalModel[];
}): LocalLlm {
  const catalog = options.models ?? LOCAL_MODELS;
  const { modelsDir } = options;
  const asset = options.engine === undefined ? llamaAsset() : (options.engine ?? undefined);
  const engine: {
    install?: Promise<string>;
    controller?: AbortController;
    received: number;
    error?: string;
  } = { received: 0 };
  const jobs = new Map<string, { controller: AbortController; received: number }>();
  const errors = new Map<string, string>();
  const recommended = recommendedLocalModel(options.memoryGb)?.id;
  let llama: LlamaServer | undefined;

  const find = (id: string) => {
    const model = catalog.find((m) => m.id === id);
    if (!model) throw new Error(`unknown local model ${id}`);
    return { model, path: join(modelsDir, model.file) };
  };

  /** Downloads and unpacks the engine once; concurrent callers share the attempt. */
  function ensureEngine(): Promise<string> {
    if (!asset) return Promise.reject(new Error("no built-in engine for this platform"));
    if (engine.install) return engine.install;
    const controller = new AbortController();
    engine.controller = controller;
    engine.error = undefined;
    engine.install = installEngine(
      asset,
      options.enginesDir,
      options.fetch,
      (received) => {
        engine.received = received;
      },
      controller.signal,
    ).catch((error: unknown) => {
      engine.install = undefined;
      if (!controller.signal.aborted)
        engine.error = error instanceof Error ? error.message : String(error);
      throw error;
    });
    return engine.install;
  }

  async function server(): Promise<LlamaServer> {
    const binary = await ensureEngine();
    llama ??= createLlamaServer({ binary, cwd: dirname(binary), command: options.command });
    return llama;
  }

  const engineState = (): LocalLlmStatus["engine"] => {
    const installed =
      asset &&
      existsSync(
        join(options.enginesDir, `llama.cpp-${asset.build}-${asset.platform}`, ".installed"),
      );
    const base = { build: asset?.build ?? "", size: asset?.size ?? 0, received: engine.received };
    if (installed) return { ...base, state: "ready", received: base.size };
    if (engine.install) return { ...base, state: "downloading" };
    if (engine.error) return { ...base, state: "failed", error: engine.error };
    return { ...base, state: "absent" };
  };

  return {
    status(): LocalLlmStatus {
      return {
        available: !!asset,
        engine: engineState(),
        memoryGb: options.memoryGb,
        running: llama?.state() ?? null,
        models: catalog.map((m) => {
          const path = join(modelsDir, m.file);
          const job = jobs.get(m.id);
          const base = {
            id: m.id,
            title: m.title,
            sizeBytes: m.sizeBytes,
            ramGb: m.ramGb,
            recommended: m.id === recommended,
          };
          if (existsSync(path)) return { ...base, state: "ready", received: m.sizeBytes };
          if (job) return { ...base, state: "downloading", received: job.received };
          const error = errors.get(m.id);
          if (error) return { ...base, state: "failed", received: partSize(path), error };
          const part = partSize(path);
          return { ...base, state: part > 0 ? "paused" : "absent", received: part };
        }),
      };
    },

    download(id) {
      const { model, path } = find(id);
      // The engine comes with the first model; a failure shows in the status.
      ensureEngine().catch(() => {});
      if (jobs.has(id) || existsSync(path)) return;
      mkdirSync(modelsDir, { recursive: true });
      errors.delete(id);
      const job = { controller: new AbortController(), received: partSize(path) };
      jobs.set(id, job);
      download({
        url: localModelUrl(model),
        dest: path,
        size: model.sizeBytes,
        sha256: model.sha256,
        fetch: options.fetch,
        signal: job.controller.signal,
        onProgress: (received) => {
          job.received = received;
        },
      })
        .catch((error: unknown) => {
          if (!job.controller.signal.aborted)
            errors.set(id, error instanceof Error ? error.message : String(error));
        })
        .finally(() => jobs.delete(id));
    },

    cancel(id) {
      jobs.get(id)?.controller.abort();
    },

    async remove(id) {
      const { path } = find(id);
      jobs.get(id)?.controller.abort();
      await llama?.stop(id);
      rmSync(path, { force: true });
      rmSync(partFile(path), { force: true });
      errors.delete(id);
    },

    async endpoint(id) {
      return (await server()).endpoint(id, find(id).path);
    },

    async stop() {
      for (const job of jobs.values()) job.controller.abort();
      engine.controller?.abort();
      await llama?.stop();
    },
  };
}
