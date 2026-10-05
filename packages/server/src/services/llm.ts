// LLM setup of the profile (provider endpoints, keys, the default route) and the lesson tasks that use
// it (07). Everything model-specific lives in @sprachanker/llm.
import {
  explainMistake,
  type LlmClient,
  LlmError,
  openAiCompatible,
  PROVIDERS,
  type ProviderId,
} from "@sprachanker/llm";
import { type LessonKey, parseEditionId } from "@sprachanker/schema";
import { eq } from "drizzle-orm";
import type { ProfileDb } from "../db/profile/db.ts";
import { llmRoutes, secrets } from "../db/profile/schema.ts";
import type { SecretBox } from "../security/secrets.ts";
import type { Content } from "./content.ts";
import type { Settings } from "./settings.ts";

/** Settings key with custom endpoints by provider id. */
const ENDPOINTS = "llm.endpoints";
const DEFAULT_ROUTE = "default";
/** Settings key with the built-in runtime's engine. */
const LOCAL_ENGINE = "llm.localEngine";

const NO_LOCAL: LocalLlmStatus = {
  available: false,
  engine: null,
  engines: [],
  memoryGb: 0,
  models: [],
  running: null,
};

export class LlmSetupError extends Error {}

/** The llama-server process of the built-in model. */
export type RunState =
  | { model: string; state: "starting" | "ready" }
  | { model: string; state: "failed"; error: string };

export interface ProviderState {
  id: ProviderId;
  baseUrl: string;
  defaultUrl: string;
  key: "required" | "optional" | "none";
  hasKey: boolean;
  editableUrl: boolean;
}

export type EngineId = "llama" | "mlx";

export interface LocalModelStatus {
  id: string;
  title: string;
  /** Size of the model in the selected engine's format. */
  sizeBytes: number;
  ramGb: number;
  recommended: boolean;
  /** LM Studio has this exact build: it is copied instead of downloaded. */
  inLmStudio: boolean;
  /** paused: a part file waits to be resumed. */
  state: "absent" | "downloading" | "paused" | "failed" | "ready";
  received: number;
  error?: string;
}

export interface EngineStatus {
  id: EngineId;
  version: string;
  /** Whether this machine can run it. */
  available: boolean;
  /** The best available engine for this machine. */
  recommended: boolean;
  downloadSize: number;
  installSize: number;
  /** setup: unpacking or installing packages after the download. */
  state: "absent" | "downloading" | "setup" | "failed" | "ready";
  received: number;
  error?: string;
}

export interface LocalLlmStatus {
  /** False when no engine runs on this machine. */
  available: boolean;
  /** The engine in use; models are listed in its format. */
  engine: EngineId | null;
  engines: EngineStatus[];
  memoryGb: number;
  models: LocalModelStatus[];
  running: RunState | null;
}

/** The built-in runtime (src/sidecars/local-llm.ts); kept behind this interface so that app.ts stays
 *  free of process and file APIs. */
export interface LocalLlm {
  recommendedEngine(): EngineId | null;
  status(engine: EngineId | null): LocalLlmStatus;
  download(id: string, engine: EngineId): void;
  cancel(id: string, engine: EngineId): void;
  remove(id: string, engine: EngineId): Promise<void>;
  /** A server running the model, started if needed, and the model name requests must carry. */
  endpoint(id: string, engine: EngineId): Promise<{ baseUrl: string; model: string }>;
  stop(): Promise<void>;
}

export interface LlmState {
  provider: ProviderId | null;
  model: string | null;
  providers: ProviderState[];
}

export interface ExplainRequest {
  series: string;
  lessonKey: LessonKey;
  edition: string;
  exerciseKey: string;
  index: number;
  answer?: unknown;
  language: string;
}

export function createLlm(deps: {
  db: ProfileDb;
  settings: Settings;
  box: SecretBox;
  content: Content;
  fetch: typeof fetch;
  local?: LocalLlm;
}) {
  const { db, settings, box, content, local } = deps;
  const endpoints = () => settings.get<Partial<Record<ProviderId, string>>>(ENDPOINTS) ?? {};
  const route = () => db.select().from(llmRoutes).where(eq(llmRoutes.task, DEFAULT_ROUTE)).get();
  const hasKey = (id: ProviderId) =>
    !!db.select().from(secrets).where(eq(secrets.providerId, id)).get();
  const baseUrl = (id: ProviderId) => endpoints()[id] ?? PROVIDERS[id].baseUrl;

  /** The built-in runtime's engine: the stored choice if it runs here, else the best for this machine. */
  function localEngine(): EngineId | null {
    const stored = settings.get<EngineId>(LOCAL_ENGINE);
    const available =
      local
        ?.status(null)
        .engines.filter((e) => e.available)
        .map((e) => e.id) ?? [];
    return stored && available.includes(stored) ? stored : (local?.recommendedEngine() ?? null);
  }

  /** A client for the provider and the model name to send (the built-in engines name it their way). */
  async function client(
    id: ProviderId,
    model?: string | null,
  ): Promise<{ client: LlmClient; model: string }> {
    if (id === "builtin") {
      const engine = localEngine();
      if (!local || !engine) throw new LlmSetupError("llm_builtin_unavailable");
      if (!model) throw new LlmSetupError("llm_not_configured");
      if (local.status(engine).models.find((m) => m.id === model)?.state !== "ready")
        throw new LlmSetupError("llm_model_missing");
      try {
        const endpoint = await local.endpoint(model, engine);
        return {
          client: openAiCompatible({ baseUrl: endpoint.baseUrl }, deps.fetch),
          model: endpoint.model,
        };
      } catch (error) {
        throw new LlmError("engine_failed", error instanceof Error ? error.message : String(error));
      }
    }
    const preset = PROVIDERS[id];
    const url = baseUrl(id);
    if (!url) throw new LlmSetupError("llm_no_endpoint");
    const row = db.select().from(secrets).where(eq(secrets.providerId, id)).get();
    const apiKey = row ? await box.open(row.valueEncrypted) : undefined;
    if (preset.key === "required" && !apiKey) throw new LlmSetupError("llm_no_key");
    return {
      client: openAiCompatible(
        { baseUrl: url, apiKey, noReasoning: preset.noReasoning },
        deps.fetch,
      ),
      model: model ?? "",
    };
  }

  return {
    state(): LlmState {
      const r = route();
      return {
        provider: (r?.providerId as ProviderId | undefined) ?? null,
        model: r?.model ?? null,
        providers: Object.values(PROVIDERS).map((p) => ({
          id: p.id,
          baseUrl: baseUrl(p.id),
          defaultUrl: p.baseUrl,
          key: p.key,
          hasKey: hasKey(p.id),
          editableUrl: p.editableUrl,
        })),
      };
    },
    /** Sets the default route; `provider: null` turns the LLM features off. */
    setRoute(provider: ProviderId | null, model: string | null) {
      if (!provider) {
        db.delete(llmRoutes).where(eq(llmRoutes.task, DEFAULT_ROUTE)).run();
        return;
      }
      const values = { providerId: provider, model, paramsJson: "{}" };
      db.insert(llmRoutes)
        .values({ task: DEFAULT_ROUTE, ...values })
        .onConflictDoUpdate({ target: llmRoutes.task, set: values })
        .run();
    },
    /** Endpoint (null → preset) and API key (null → remove; undefined → keep). */
    async setProvider(id: ProviderId, change: { baseUrl?: string | null; apiKey?: string | null }) {
      if (change.baseUrl !== undefined && PROVIDERS[id].editableUrl) {
        const { [id]: _, ...rest } = endpoints();
        settings.set(ENDPOINTS, change.baseUrl ? { ...rest, [id]: change.baseUrl } : rest);
      }
      if (change.apiKey === null) db.delete(secrets).where(eq(secrets.providerId, id)).run();
      else if (change.apiKey !== undefined) {
        const valueEncrypted = await box.seal(change.apiKey);
        db.insert(secrets)
          .values({ providerId: id, valueEncrypted })
          .onConflictDoUpdate({ target: secrets.providerId, set: { valueEncrypted } })
          .run();
      }
    },
    /** Models of a provider with the round-trip time, as a connection test. */
    async models(id: ProviderId, signal?: AbortSignal) {
      if (id === "builtin") {
        // Downloaded models; the process starts only when a lesson asks something.
        const ready = local?.status(localEngine()).models.filter((m) => m.state === "ready") ?? [];
        return { models: ready.map((m) => ({ id: m.id, name: m.title })), ms: 0 };
      }
      const started = performance.now();
      const models = await (await client(id)).client.models(signal);
      return { models, ms: Math.round(performance.now() - started) };
    },
    /** Client and model of the default route; throws when the LLM is not set up. */
    async model(): Promise<{ client: LlmClient; model: string }> {
      const r = route();
      if (!r?.model) throw new LlmSetupError("llm_not_configured");
      return client(r.providerId as ProviderId, r.model);
    },
    /** The built-in runtime as the settings show it: engines and models of the engine in use. */
    localStatus(): LocalLlmStatus {
      return local?.status(localEngine()) ?? NO_LOCAL;
    },
    /** Download, pause or delete a model of the engine in use. */
    async localModel(
      id: string,
      action: "download" | "cancel" | "remove",
    ): Promise<LocalLlmStatus> {
      const engine = localEngine();
      if (local && engine) {
        if (action === "download") local.download(id, engine);
        else if (action === "cancel") local.cancel(id, engine);
        else await local.remove(id, engine);
      }
      return this.localStatus();
    },
    /** Switches the built-in engine; the route keeps its model id, now served by the other engine. */
    setLocalEngine(engine: EngineId): LocalLlmStatus {
      settings.set(LOCAL_ENGINE, engine);
      return this.localStatus();
    },
    /** Explanation of a wrong answer, streamed. */
    async explain(request: ExplainRequest, signal?: AbortSignal): Promise<AsyncIterable<string>> {
      const { client: llm, model } = await this.model();
      const [lesson, locale] = await Promise.all([
        content.lesson(request.series, request.lessonKey),
        content.localeLesson(request.series, request.lessonKey, request.edition),
      ]);
      const exercise = lesson.pages.find((p) => p.exercise.key === request.exerciseKey)?.exercise;
      if (!exercise?.items[request.index]) throw new LlmSetupError("no_such_item");
      return explainMistake(
        llm,
        model,
        {
          exercise,
          locale: locale?.exercises[exercise.key],
          index: request.index,
          answer: request.answer,
          grammarHtml: locale?.tabs.grammar.map((t) => t.bodyHtml) ?? [],
          language: request.language,
          target: parseEditionId(request.edition).target,
        },
        signal,
      );
    },
  };
}
export type Llm = ReturnType<typeof createLlm>;
