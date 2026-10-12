// LM Studio for the assistant: its state as the settings show it — installed here,
// running, its models, the suggested ones with their downloads —, starting its server on this machine,
// and loading a model with our context window before a task uses it (one load per model at a time).
import {
  LlmError,
  LMSTUDIO_RECOMMENDED,
  type LmStudioDownload,
  type LmStudioModel,
  lmStudioApi,
  recommendedLmStudioModel,
} from "@sprachanker/llm";
import { ServiceError } from "../errors.ts";
import { createOnce } from "../once.ts";

/** What the server can do with an LM Studio on its own machine (src/runtime/lmstudio.ts). */
export interface LmStudioHost {
  /** LM Studio is installed here (its `lms` command exists). */
  installed(): boolean;
  /** Starts LM Studio's server (`lms server start`); rejects when it does not start. */
  startServer(): Promise<void>;
  memoryGb: number;
}

export interface LmStudioStatus {
  installed: boolean;
  /** The configured endpoint is on this machine, so the app can start its server. */
  local: boolean;
  running: boolean;
  /** Why LM Studio did not answer (an llm_* code), when running is false. */
  error?: string;
  memoryGb: number;
  models: LmStudioModel[];
  suggestions: Array<{
    key: (typeof LMSTUDIO_RECOMMENDED)[number]["key"];
    title: string;
    sizeGb: number;
    ramGb: number;
    recommended: boolean;
    downloaded: boolean;
    download?: LmStudioDownload;
  }>;
}

const LOCAL_URL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/;

export function createLmStudio(deps: {
  /** LM Studio's endpoint as the profile set it, and its key. */
  endpoint(): Promise<{ baseUrl: string; apiKey?: string }>;
  fetch: typeof fetch;
  host?: LmStudioHost;
}) {
  const { host } = deps;
  /** Downloads started from the app: model key → LM Studio job id. */
  const downloads = new Map<string, string>();
  /** Loads in progress, by model key: two tasks at once load one copy. */
  const loading = createOnce<void>();
  const studio = async () => lmStudioApi(await deps.endpoint(), deps.fetch);

  async function lmStudioStatus(): Promise<LmStudioStatus> {
    const { baseUrl } = await deps.endpoint();
    const base = {
      installed: host?.installed() ?? false,
      local: LOCAL_URL.test(baseUrl),
      memoryGb: host?.memoryGb ?? 0,
    };
    const api = await studio();
    let models: LmStudioModel[];
    try {
      models = await api.models();
    } catch (error) {
      const code = error instanceof LlmError ? `llm_${error.code}` : "llm_unreachable";
      return { ...base, running: false, error: code, models: [], suggestions: [] };
    }
    const recommended = recommendedLmStudioModel(base.memoryGb);
    const suggestions = await Promise.all(
      LMSTUDIO_RECOMMENDED.map(async (m) => {
        const downloaded = models.some((x) => x.key === m.key);
        const job = downloads.get(m.key);
        let download: LmStudioDownload | undefined;
        if (job && !downloaded) {
          download = await api.downloadStatus(job).catch(() => undefined);
          if (!download || download.status === "failed") downloads.delete(m.key);
        } else downloads.delete(m.key);
        return { ...m, recommended: m.key === recommended, downloaded, download };
      }),
    );
    return { ...base, running: true, models, suggestions };
  }

  return {
    /** Loads a model with our context window (LM Studio would load it with a small default one). */
    ensureLoaded: (model: string) =>
      loading(model, () => studio().then((api) => api.ensureLoaded(model))),
    lmStudioStatus,
    /** Asks LM Studio to download a suggested model; progress shows in lmStudioStatus. */
    async lmStudioDownload(key: string): Promise<LmStudioStatus> {
      const job = await (await studio()).download(key);
      if (job.jobId) downloads.set(key, job.jobId);
      return lmStudioStatus();
    },
    /** Starts LM Studio's server when LM Studio is installed on this machine. */
    async lmStudioStart(): Promise<LmStudioStatus> {
      if (!host?.installed()) throw new ServiceError("llm_lmstudio_missing", 409);
      // The LM Studio here serves only a local endpoint; a remote one has to be started there.
      if (!LOCAL_URL.test((await deps.endpoint()).baseUrl))
        throw new ServiceError("llm_lmstudio_remote", 409);
      await host.startServer().catch((error: unknown) => {
        console.error("lms server start:", error);
        throw new ServiceError("llm_lmstudio_failed", 502);
      });
      return lmStudioStatus();
    },
  };
}
