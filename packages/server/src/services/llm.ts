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

export class LlmSetupError extends Error {}

/** The llama-server process of the built-in model. */
export type RunState =
  | { model: string; state: "starting" | "ready" }
  | { model: string; state: "failed"; error: string };

export interface LocalModelStatus {
  id: string;
  title: string;
  sizeBytes: number;
  ramGb: number;
  recommended: boolean;
  /** paused: a part file waits to be resumed. */
  state: "absent" | "downloading" | "paused" | "failed" | "ready";
  received: number;
  error?: string;
}

export interface LocalLlmStatus {
  /** False on platforms without an official llama.cpp build. */
  available: boolean;
  /** llama.cpp itself: downloaded with the first model. */
  engine: {
    build: string;
    state: "absent" | "downloading" | "failed" | "ready";
    received: number;
    size: number;
    error?: string;
  };
  memoryGb: number;
  models: LocalModelStatus[];
  running: RunState | null;
}

/** The built-in runtime (src/sidecars/local-llm.ts); kept behind this interface so that app.ts stays
 *  free of process and file APIs. */
export interface LocalLlm {
  status(): LocalLlmStatus;
  download(id: string): void;
  cancel(id: string): void;
  remove(id: string): Promise<void>;
  /** Base URL of a llama-server running the model, started if needed. */
  endpoint(id: string): Promise<string>;
  stop(): Promise<void>;
}

export interface ProviderState {
  id: ProviderId;
  baseUrl: string;
  defaultUrl: string;
  key: "required" | "optional" | "none";
  hasKey: boolean;
  editableUrl: boolean;
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

  async function client(id: ProviderId, model?: string | null): Promise<LlmClient> {
    if (id === "builtin") {
      if (!local?.status().available) throw new LlmSetupError("llm_builtin_unavailable");
      if (!model) throw new LlmSetupError("llm_not_configured");
      if (local.status().models.find((m) => m.id === model)?.state !== "ready")
        throw new LlmSetupError("llm_model_missing");
      try {
        return openAiCompatible({ baseUrl: await local.endpoint(model) }, deps.fetch);
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
    return openAiCompatible({ baseUrl: url, apiKey, noReasoning: preset.noReasoning }, deps.fetch);
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
        const ready = local?.status().models.filter((m) => m.state === "ready") ?? [];
        return { models: ready.map((m) => ({ id: m.id, name: m.title })), ms: 0 };
      }
      const started = performance.now();
      const models = await (await client(id)).models(signal);
      return { models, ms: Math.round(performance.now() - started) };
    },
    /** Client and model of the default route; throws when the LLM is not set up. */
    async model(): Promise<{ client: LlmClient; model: string }> {
      const r = route();
      if (!r?.model) throw new LlmSetupError("llm_not_configured");
      return { client: await client(r.providerId as ProviderId, r.model), model: r.model };
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
