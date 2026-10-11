// LM Studio's own REST API (v1, next to its OpenAI-compatible /v1): the models it has, loading one with
// the context the tasks need, and downloads. LM Studio picks the engine and stores the files; the app
// only asks (07, "LM Studio").

import { LlmError } from "./errors.ts";
import { bearer, endpointCaller } from "./http.ts";

export interface LmStudioModel {
  /** The id chat requests use: "google/gemma-4-12b". */
  key: string;
  title: string;
  sizeBytes: number;
  /** "mlx" | "gguf" — LM Studio chooses per machine. */
  format: string;
  quantization?: string;
  /** Loaded instances and their context windows. */
  loaded: Array<{ id: string; contextLength: number }>;
}

export interface LmStudioDownload {
  jobId?: string;
  status: "downloading" | "paused" | "completed" | "failed" | "already_downloaded";
  totalBytes?: number;
  downloadedBytes?: number;
}

/** Models we suggest; LM Studio downloads the best build of each for the machine. */
export const LMSTUDIO_RECOMMENDED = [
  { key: "google/gemma-4-e2b", title: "Gemma 4 E2B", sizeGb: 4.4, ramGb: 5 },
  { key: "google/gemma-4-e4b", title: "Gemma 4 E4B", sizeGb: 6.9, ramGb: 8 },
  { key: "google/gemma-4-12b", title: "Gemma 4 12B", sizeGb: 6.8, ramGb: 9 },
  { key: "google/gemma-4-26b-a4b-qat", title: "Gemma 4 26B A4B", sizeGb: 15.6, ramGb: 17 },
] as const;

/** The largest suggested model that leaves at least half of the computer's memory free. */
export const recommendedLmStudioModel = (memoryGb: number) =>
  LMSTUDIO_RECOMMENDED.filter((m) => m.ramGb <= memoryGb / 2).at(-1)?.key ??
  LMSTUDIO_RECOMMENDED[0].key;

/** The tutor's lesson context needs more than LM Studio's default window. */
export const LMSTUDIO_CONTEXT = 8192;

const QUICK_MS = 10_000;
/** Loading a model from disk can take a while for large ones. */
const LOAD_MS = 180_000;

interface RawModel {
  type?: string;
  key?: string;
  display_name?: string;
  size_bytes?: number;
  format?: string;
  quantization?: { name?: string };
  loaded_instances?: Array<{ id?: string; config?: { context_length?: number } }>;
}

/** `baseUrl` is the OpenAI-compatible one (…/v1), as configured for the provider. */
export function lmStudioApi(endpoint: { baseUrl: string; apiKey?: string }, fetchFn = fetch) {
  const root = endpoint.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  const call = endpointCaller(root, bearer(endpoint.apiKey), fetchFn);
  const post = (path: string, body: unknown, timeoutMs = QUICK_MS) =>
    call(path, { method: "POST", body: JSON.stringify(body) }, timeoutMs);
  const download = (raw: Record<string, unknown>): LmStudioDownload => ({
    jobId: typeof raw.job_id === "string" ? raw.job_id : undefined,
    status: raw.status as LmStudioDownload["status"],
    totalBytes: typeof raw.total_size_bytes === "number" ? raw.total_size_bytes : undefined,
    downloadedBytes: typeof raw.downloaded_bytes === "number" ? raw.downloaded_bytes : undefined,
  });

  const api = {
    /** Chat models LM Studio has on disk. */
    async models(signal?: AbortSignal): Promise<LmStudioModel[]> {
      const res = await call("/api/v1/models", { method: "GET" }, QUICK_MS, signal);
      const body = (await res.json().catch(() => null)) as { models?: RawModel[] } | null;
      if (!Array.isArray(body?.models)) throw new LlmError("bad_response", "no model list");
      return body.models
        .filter((m) => m.type === "llm" && typeof m.key === "string")
        .map((m) => ({
          key: m.key as string,
          title: m.display_name ?? (m.key as string),
          sizeBytes: m.size_bytes ?? 0,
          format: m.format ?? "",
          quantization: m.quantization?.name,
          loaded: (m.loaded_instances ?? []).map((i) => ({
            id: i.id ?? (m.key as string),
            contextLength: i.config?.context_length ?? 0,
          })),
        }));
    },

    /**
     * Makes sure `key` is loaded with at least `contextLength`. A model LM Studio loaded on its own
     * with a smaller window (JIT, default settings) is reloaded, so requests never hit a second copy.
     */
    async ensureLoaded(key: string, contextLength = LMSTUDIO_CONTEXT): Promise<void> {
      const model = (await api.models()).find((m) => m.key === key);
      if (!model) throw new LlmError("model_not_found", `${key} is not downloaded in LM Studio`);
      if (model.loaded.some((i) => i.contextLength >= contextLength)) return;
      for (const instance of model.loaded) {
        await post("/api/v1/models/unload", { instance_id: instance.id });
      }
      await post("/api/v1/models/load", { model: key, context_length: contextLength }, LOAD_MS);
    },

    /** Starts a download (catalog key or Hugging Face URL); LM Studio runs it in the background. */
    async download(model: string): Promise<LmStudioDownload> {
      const res = await post("/api/v1/models/download", { model });
      return download((await res.json()) as Record<string, unknown>);
    },

    async downloadStatus(jobId: string): Promise<LmStudioDownload> {
      const res = await call(
        `/api/v1/models/download/status/${jobId}`,
        { method: "GET" },
        QUICK_MS,
      );
      return download((await res.json()) as Record<string, unknown>);
    },
  };
  return api;
}
