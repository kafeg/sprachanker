// The built-in LLM (07, "Built-in model"): engines (llama.cpp, mlx-lm) and models downloaded on the
// learner's request into the data root (engines/, models/llm/), one model server at a time.
import { createHash } from "node:crypto";
import {
  constants,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  buildSize,
  LOCAL_MODELS,
  type LocalModel,
  type ModelBuild,
  type ModelFile,
  modelFileUrl,
  recommendedLocalModel,
} from "@sprachanker/llm";
import { download, partFile, partSize } from "../jobs/download.ts";
import type { EngineId, LocalLlm, LocalLlmStatus, LocalModelStatus } from "../services/llm.ts";
import type { Engine, InstallProgress } from "./engines/engine.ts";
import { llamaEngine } from "./engines/llama.ts";
import { mlxEngine } from "./engines/mlx.ts";
import { createModelServer, type Launch } from "./model-server.ts";

/** Where LM Studio keeps downloads: <dir>/<hf-repo>/<file>. */
const LM_STUDIO_MODELS = join(homedir(), ".lmstudio", "models");

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export function createLocalLlm(options: {
  /** Downloaded models (<data-root>/models/llm): GGUF files flat, MLX builds in a folder each. */
  modelsDir: string;
  /** Installed engines (<data-root>/engines), one folder per engine, version and platform. */
  enginesDir: string;
  fetch: typeof fetch;
  memoryGb: number;
  /** Tests: other engines, catalog and LM Studio folder. */
  engines?: Engine[];
  models?: LocalModel[];
  lmStudioDir?: string;
}): LocalLlm {
  const { modelsDir } = options;
  const catalog = options.models ?? LOCAL_MODELS;
  const lmStudio = options.lmStudioDir ?? LM_STUDIO_MODELS;
  // Order = preference: the first available engine is recommended. llama.cpp first: on an M2 Pro it
  // was as fast as MLX on Gemma 4 12B and faster on E4B, starts faster and is far smaller (07).
  const engines = options.engines ?? [
    llamaEngine(options.enginesDir),
    mlxEngine(options.enginesDir),
  ];
  const recommendedModel = recommendedLocalModel(options.memoryGb)?.id;
  const server = createModelServer();

  const installs = new Map<
    EngineId,
    { promise: Promise<void>; controller: AbortController; progress: InstallProgress }
  >();
  const engineErrors = new Map<EngineId, string>();
  const jobs = new Map<string, { controller: AbortController; received: number }>();
  const errors = new Map<string, string>();

  const engineOf = (id: EngineId) => {
    const engine = engines.find((e) => e.id === id);
    if (!engine) throw new Error(`unknown engine ${id}`);
    return engine;
  };
  const modelOf = (id: string) => {
    const model = catalog.find((m) => m.id === id);
    if (!model) throw new Error(`unknown local model ${id}`);
    return model;
  };
  const buildOf = (model: LocalModel, engine: Engine): ModelBuild | undefined =>
    engine.format === "mlx" ? model.mlx : model.gguf;
  /** GGUF: files in the models folder itself; MLX: a folder named after the repository. */
  const buildDir = (build: ModelBuild, engine: Engine) =>
    engine.format === "mlx" ? join(modelsDir, basename(build.repo)) : modelsDir;
  const filePath = (build: ModelBuild, engine: Engine, file: ModelFile) =>
    join(buildDir(build, engine), file.path);
  const servedPath = (build: ModelBuild, engine: Engine) =>
    engine.format === "mlx"
      ? buildDir(build, engine)
      : filePath(build, engine, build.files[0] as ModelFile);
  const inLmStudio = (build: ModelBuild, file: ModelFile) => {
    const candidate = join(lmStudio, build.repo, file.path);
    return statSync(candidate, { throwIfNoEntry: false })?.size === file.size
      ? candidate
      : undefined;
  };
  const jobKey = (model: string, engine: EngineId) => `${engine}:${model}`;
  const recommendedEngine = () => engines.find((e) => e.available)?.id ?? null;

  function ensureEngine(engine: Engine): Promise<void> {
    if (engine.installed()) return Promise.resolve();
    const running = installs.get(engine.id);
    if (running) return running.promise;
    const controller = new AbortController();
    const entry = {
      controller,
      progress: { received: 0, phase: "download" } as InstallProgress,
      promise: Promise.resolve(),
    };
    engineErrors.delete(engine.id);
    entry.promise = engine
      .install({
        fetch: options.fetch,
        signal: controller.signal,
        onProgress: (p) => {
          entry.progress = p;
        },
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          engineErrors.set(engine.id, error instanceof Error ? error.message : String(error));
        throw error;
      })
      .finally(() => installs.delete(engine.id));
    installs.set(engine.id, entry);
    return entry.promise;
  }

  /** A copy LM Studio already has: cloned (no extra disk on APFS) and checked before use. */
  async function adopt(source: string, dest: string, file: ModelFile): Promise<boolean> {
    const part = partFile(dest);
    copyFileSync(source, part, constants.COPYFILE_FICLONE);
    if ((await sha256(part)) === file.sha256) {
      renameSync(part, dest);
      return true;
    }
    rmSync(part, { force: true });
    return false;
  }

  async function fetchBuild(
    build: ModelBuild,
    engine: Engine,
    job: { controller: AbortController; received: number },
  ) {
    let done = 0;
    for (const file of build.files) {
      const dest = filePath(build, engine, file);
      mkdirSync(dirname(dest), { recursive: true });
      if (!existsSync(dest)) {
        const local = inLmStudio(build, file);
        if (!(local && (await adopt(local, dest, file)))) {
          await download({
            url: modelFileUrl(build, file),
            dest,
            size: file.size,
            sha256: file.sha256,
            fetch: options.fetch,
            signal: job.controller.signal,
            onProgress: (received) => {
              job.received = done + received;
            },
          });
        }
      }
      done += file.size;
      job.received = done;
    }
  }

  function modelStatus(model: LocalModel, engine: Engine): LocalModelStatus | undefined {
    const build = buildOf(model, engine);
    if (!build) return undefined;
    const size = buildSize(build);
    const base = {
      id: model.id,
      title: model.title,
      sizeBytes: size,
      ramGb: model.ramGb,
      recommended: model.id === recommendedModel,
      inLmStudio: build.files.every((f) => inLmStudio(build, f)),
    };
    const files = build.files.map((f) => filePath(build, engine, f));
    if (files.every((f) => existsSync(f))) return { ...base, state: "ready", received: size };
    const job = jobs.get(jobKey(model.id, engine.id));
    if (job) return { ...base, state: "downloading", received: job.received };
    const received = build.files.reduce((sum, f, i) => {
      const path = files[i] as string;
      return sum + (existsSync(path) ? f.size : partSize(path));
    }, 0);
    const error = errors.get(jobKey(model.id, engine.id));
    if (error) return { ...base, state: "failed", received, error };
    return { ...base, state: received > 0 ? "paused" : "absent", received };
  }

  return {
    recommendedEngine,

    status(engineId): LocalLlmStatus {
      const recommended = recommendedEngine();
      const engine = engines.find((e) => e.id === engineId && e.available);
      return {
        available: recommended !== null,
        engine: engine?.id ?? null,
        engines: engines.map((e) => {
          const install = installs.get(e.id);
          const error = engineErrors.get(e.id);
          const state = e.installed()
            ? "ready"
            : install
              ? install.progress.phase === "setup"
                ? "setup"
                : "downloading"
              : error
                ? "failed"
                : "absent";
          return {
            id: e.id,
            version: e.version,
            available: e.available,
            recommended: e.id === recommended,
            downloadSize: e.downloadSize,
            installSize: e.installSize,
            received: install?.progress.received ?? 0,
            state,
            error,
          };
        }),
        memoryGb: options.memoryGb,
        running: server.state(),
        models: engine ? catalog.flatMap((m) => modelStatus(m, engine) ?? []) : [],
      };
    },

    download(id, engineId) {
      const engine = engineOf(engineId);
      const model = modelOf(id);
      const build = buildOf(model, engine);
      if (!build) throw new Error(`${id} has no ${engine.format} build`);
      // The engine comes with the first model; a failure shows in the status.
      ensureEngine(engine).catch(() => {});
      const key = jobKey(id, engineId);
      if (jobs.has(key) || modelStatus(model, engine)?.state === "ready") return;
      errors.delete(key);
      const job = { controller: new AbortController(), received: 0 };
      jobs.set(key, job);
      fetchBuild(build, engine, job)
        .catch((error: unknown) => {
          if (!job.controller.signal.aborted)
            errors.set(key, error instanceof Error ? error.message : String(error));
        })
        .finally(() => jobs.delete(key));
    },

    cancel(id, engineId) {
      jobs.get(jobKey(id, engineId))?.controller.abort();
    },

    async remove(id, engineId) {
      const engine = engineOf(engineId);
      const build = buildOf(modelOf(id), engine);
      if (!build) return;
      jobs.get(jobKey(id, engineId))?.controller.abort();
      await server.stop(jobKey(id, engineId));
      for (const file of build.files) {
        const path = filePath(build, engine, file);
        rmSync(path, { force: true });
        rmSync(partFile(path), { force: true });
      }
      if (engine.format === "mlx")
        rmSync(buildDir(build, engine), { recursive: true, force: true });
      errors.delete(jobKey(id, engineId));
    },

    async endpoint(id, engineId) {
      const engine = engineOf(engineId);
      const build = buildOf(modelOf(id), engine);
      if (!build) throw new Error(`${id} has no ${engine.format} build`);
      await ensureEngine(engine);
      const path = servedPath(build, engine);
      return server.endpoint(
        jobKey(id, engineId),
        id,
        (port): Launch => engine.serve(path, port, id),
      );
    },

    async stop() {
      for (const job of jobs.values()) job.controller.abort();
      for (const install of installs.values()) install.controller.abort();
      await server.stop();
    },
  };
}
