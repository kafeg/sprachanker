// LLM setup of the profile (provider endpoints, keys, the default route), LM Studio integration and the
// lesson tasks that use the route (07). Everything model-specific lives in @sprachanker/llm.
import {
  CHAT_TURN_BUDGETS,
  CHECK_WRITING_BUDGETS,
  type CliKind,
  type CliRunner,
  chatBody,
  chatTurnRules,
  checkWritingRules,
  cliClient,
  cliCommand,
  EXPLAIN_MISTAKE_BUDGETS,
  estimateTokens,
  explainMistakeRules,
  type LlmClient,
  LlmError,
  LMSTUDIO_CONTEXT,
  LMSTUDIO_RECOMMENDED,
  type LmStudioDownload,
  type LmStudioModel,
  languageName,
  lmStudioApi,
  type OpenRouterKey,
  openAiCompatible,
  openRouterKey,
  PROVIDERS,
  type ProviderId,
  recommendedLmStudioModel,
  SCENE_BUDGETS,
  sceneTurnRules,
  type TaskRequest,
  WORD_EXAMPLE_BUDGETS,
  wordExampleRules,
} from "@sprachanker/llm";
import type { Lang } from "@sprachanker/schema";
import { eq } from "drizzle-orm";
import type { ProfileDb } from "../db/profile/db.ts";
import { llmRoutes, secrets } from "../db/profile/schema.ts";
import { ServiceError } from "../errors.ts";
import type { SecretBox } from "../security/secrets.ts";
import type { Settings } from "./settings.ts";

/** Settings key with custom endpoints by provider id. */
const ENDPOINTS = "llm.endpoints" as const;
const DEFAULT_ROUTE = "default";

/** The assistant cannot run as set up (no provider, key, model…): 409. */
export class LlmSetupError extends ServiceError {
  constructor(message: string) {
    super(message, 409);
  }
}

export interface ProviderState {
  id: ProviderId;
  baseUrl: string;
  defaultUrl: string;
  key: "required" | "optional" | "none";
  hasKey: boolean;
  editableUrl: boolean;
  /** Command-line providers: whether the command is installed here. */
  installed?: boolean;
}

/** What the server can do with an LM Studio on its own machine (src/runtime/lmstudio.ts). */
export interface LmStudioHost {
  /** LM Studio is installed here (its `lms` command exists). */
  installed(): boolean;
  /** Starts LM Studio's server (`lms server start`). */
  startServer(): Promise<void>;
  memoryGb: number;
}

/** Command-line agents on this machine (src/runtime/cli.ts). */
export interface CliHost {
  installed(kind: CliKind): boolean;
  run(kind: CliKind): CliRunner;
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

/** A request as it would be sent: for the prompt viewer (07, "Debugging"). */
export interface PromptPreview {
  provider: ProviderId;
  model: string;
  url: string;
  body: ReturnType<typeof chatBody>;
  /** Rough token count of each message (07, "Debugging"). */
  tokens: number[];
}

/** A stopwatch for a model's answer (a call or a stream): every stored answer records how long it took. */
export function stopwatch(now: () => number) {
  const started = now();
  return () => Math.max(0, now() - started);
}

/** The tasks the settings explain, in the order they are shown. */
export const PROMPT_TASKS = ["explain", "tutor", "writing", "scene", "example"] as const;
export type PromptTask = (typeof PROMPT_TASKS)[number];

/** Each task's standing rules (its system prompt) for an answer language and a learnt language. */
const RULES: Record<PromptTask, (language: Lang, target: Lang) => string> = {
  explain: explainMistakeRules,
  tutor: chatTurnRules,
  writing: checkWritingRules,
  scene: sceneTurnRules,
  example: wordExampleRules,
};
const BUDGETS: Record<PromptTask, Record<string, number>> = {
  explain: EXPLAIN_MISTAKE_BUDGETS,
  tutor: CHAT_TURN_BUDGETS,
  writing: CHECK_WRITING_BUDGETS,
  scene: SCENE_BUDGETS,
  example: WORD_EXAMPLE_BUDGETS,
};
/** The learner's own system prompts, by task: templates with {language} and {target}. */
const PROMPTS = "llm.prompts" as const;

/** Placeholders a prompt template may hold: the answer language and the language learnt. */
const fill = (template: string, language: Lang, target: Lang) =>
  template
    .replaceAll("{language}", languageName(language))
    .replaceAll("{target}", languageName(target));

/** A task's system prompt as the settings show and edit it. */
export interface TaskPrompt {
  /** As sent for these languages. */
  system: string;
  /** The text to edit: the learner's own, or the standing rules with the languages as placeholders. */
  template: string;
  /** The learner's own prompt is in use. */
  custom: boolean;
  /** Characters of each context part it gets. */
  budgets: Record<string, number>;
}

export interface LlmState {
  provider: ProviderId | null;
  model: string | null;
  providers: ProviderState[];
}

const LOCAL_URL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/;

export function createLlm(deps: {
  db: ProfileDb;
  settings: Settings;
  box: SecretBox;
  fetch: typeof fetch;
  lmStudio?: LmStudioHost;
  cli?: CliHost;
}) {
  const { db, settings, box } = deps;
  /** Downloads started from the app: model key → LM Studio job id. */
  const downloads = new Map<string, string>();
  /** LM Studio loads in progress, by model key. */
  const loading = new Map<string, Promise<void>>();
  const endpoints = (): Partial<Record<ProviderId, string>> => settings.get(ENDPOINTS) ?? {};
  const customPrompts = (): Partial<Record<PromptTask, string>> => settings.get(PROMPTS) ?? {};
  const route = () => db.select().from(llmRoutes).where(eq(llmRoutes.task, DEFAULT_ROUTE)).get();
  const hasKey = (id: ProviderId) =>
    !!db.select().from(secrets).where(eq(secrets.providerId, id)).get();
  const baseUrl = (id: ProviderId) => endpoints()[id] ?? PROVIDERS[id].baseUrl;
  const origin = (url: string) => URL.parse(url)?.origin ?? url;
  const apiKey = async (id: ProviderId) => {
    const row = db.select().from(secrets).where(eq(secrets.providerId, id)).get();
    return row ? await box.open(row.valueEncrypted) : undefined;
  };
  const studio = async () =>
    lmStudioApi({ baseUrl: baseUrl("lmstudio"), apiKey: await apiKey("lmstudio") }, deps.fetch);
  /** A stored route may name a provider that no longer exists (the removed built-in runtime). */
  const known = (id: string | undefined): id is ProviderId => !!id && id in PROVIDERS;

  /** A client for the provider, and the model name to send. */
  async function client(
    id: ProviderId,
    model?: string | null,
  ): Promise<{ client: LlmClient; model: string }> {
    const preset = PROVIDERS[id];
    if (preset.cli) {
      if (!deps.cli?.installed(preset.cli)) throw new LlmSetupError("llm_cli_missing");
      return { client: cliClient(preset.cli, deps.cli.run(preset.cli)), model: model ?? "" };
    }
    const url = baseUrl(id);
    if (!url) throw new LlmSetupError("llm_no_endpoint");
    const key = await apiKey(id);
    if (preset.key === "required" && !key) throw new LlmSetupError("llm_no_key");
    // LM Studio would load a model on its own with a small default window: load it ourselves, one
    // load per model at a time (two tasks at once must not load two copies).
    if (id === "lmstudio" && model) {
      // Registered before any await, so a second task finds it.
      const pending = loading.get(model) ?? studio().then((api) => api.ensureLoaded(model));
      loading.set(model, pending);
      try {
        await pending;
      } finally {
        if (loading.get(model) === pending) loading.delete(model);
      }
    }
    return {
      client: openAiCompatible(
        { baseUrl: url, apiKey: key, noReasoning: preset.noReasoning },
        deps.fetch,
      ),
      model: model ?? "",
    };
  }

  return {
    state(): LlmState {
      const r = route();
      const provider = known(r?.providerId) ? (r?.providerId as ProviderId) : null;
      return {
        provider,
        model: provider ? (r?.model ?? null) : null,
        providers: Object.values(PROVIDERS).map((p) => ({
          id: p.id,
          baseUrl: baseUrl(p.id),
          defaultUrl: p.baseUrl,
          key: p.key,
          hasKey: hasKey(p.id),
          editableUrl: p.editableUrl,
          ...(p.cli ? { installed: deps.cli?.installed(p.cli) ?? false } : {}),
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
      let keyLeft = change.apiKey;
      if (change.baseUrl !== undefined && PROVIDERS[id].editableUrl) {
        const before = baseUrl(id);
        const { [id]: _, ...rest } = endpoints();
        settings.set(ENDPOINTS, change.baseUrl ? { ...rest, [id]: change.baseUrl } : rest);
        // A key is never sent to a host it was not given for.
        if (keyLeft === undefined && origin(before) !== origin(baseUrl(id))) keyLeft = null;
      }
      if (keyLeft === null) db.delete(secrets).where(eq(secrets.providerId, id)).run();
      else if (keyLeft !== undefined) {
        const valueEncrypted = await box.seal(keyLeft);
        db.insert(secrets)
          .values({ providerId: id, valueEncrypted })
          .onConflictDoUpdate({ target: secrets.providerId, set: { valueEncrypted } })
          .run();
      }
    },
    /** Models of a provider with the round-trip time, as a connection test. */
    async models(id: ProviderId, signal?: AbortSignal) {
      const started = performance.now();
      const models = await (await client(id)).client.models(signal);
      return { models, ms: Math.round(performance.now() - started) };
    },
    /** The state of a provider's key where it can be asked (OpenRouter: free tier, usage, limits);
     *  null where it cannot, or while no key is saved. */
    async keyState(id: ProviderId, signal?: AbortSignal): Promise<OpenRouterKey | null> {
      if (!PROVIDERS[id].keyState) return null;
      const key = await apiKey(id);
      if (!key) return null;
      return openRouterKey({ baseUrl: baseUrl(id), apiKey: key }, deps.fetch, signal);
    },
    /** Client and model of the default route; throws when the LLM is not set up. */
    async model(): Promise<{ client: LlmClient; model: string }> {
      const r = route();
      if (!r?.model || !known(r.providerId)) throw new LlmSetupError("llm_not_configured");
      return client(r.providerId, r.model);
    },
    /** LM Studio as the settings show it: installed, running, its models, suggested downloads. */
    async lmStudioStatus(): Promise<LmStudioStatus> {
      const base = {
        installed: deps.lmStudio?.installed() ?? false,
        local: LOCAL_URL.test(baseUrl("lmstudio")),
        memoryGb: deps.lmStudio?.memoryGb ?? 0,
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
    },
    /** Asks LM Studio to download a suggested model; progress shows in lmStudioStatus. */
    async lmStudioDownload(key: string): Promise<LmStudioStatus> {
      const job = await (await studio()).download(key);
      if (job.jobId) downloads.set(key, job.jobId);
      return this.lmStudioStatus();
    },
    /** Starts LM Studio's server when LM Studio is installed on this machine. */
    async lmStudioStart(): Promise<LmStudioStatus> {
      if (!deps.lmStudio?.installed()) throw new LlmSetupError("llm_lmstudio_missing");
      // The LM Studio here serves only a local endpoint; a remote one has to be started there.
      if (!LOCAL_URL.test(baseUrl("lmstudio"))) throw new LlmSetupError("llm_lmstudio_remote");
      await deps.lmStudio.startServer();
      return this.lmStudioStatus();
    },
    /** The request of the default route for a task, without sending it. */
    preview(task: TaskRequest): PromptPreview {
      const r = route();
      if (!r?.model || !known(r.providerId)) throw new LlmSetupError("llm_not_configured");
      return {
        provider: r.providerId,
        model: r.model,
        url: PROVIDERS[r.providerId].cli
          ? cliCommand(PROVIDERS[r.providerId].cli as CliKind, r.model)
          : `${baseUrl(r.providerId).replace(/\/+$/, "")}/chat/completions`,
        body: chatBody({ ...task, model: r.model }, PROVIDERS[r.providerId].noReasoning),
        tokens: task.messages.map((m) => estimateTokens(m.content)),
      };
    },
    /** The model's context window when the app knows it (LM Studio: loaded by us with this size). */
    contextWindow(): number | null {
      return route()?.providerId === "lmstudio" ? LMSTUDIO_CONTEXT : null;
    },
    /** System prompts of the tasks, as the settings show and edit them. */
    prompts(language: Lang, target: Lang): Record<PromptTask, TaskPrompt> {
      const own = customPrompts();
      return Object.fromEntries(
        PROMPT_TASKS.map((task) => {
          const custom = own[task];
          const standing = RULES[task](language, target);
          const template =
            custom ??
            standing
              .replaceAll(languageName(target), "{target}")
              .replaceAll(languageName(language), "{language}");
          return [
            task,
            {
              system: custom ? fill(custom, language, target) : standing,
              template,
              custom: !!custom,
              budgets: BUDGETS[task],
            },
          ];
        }),
      ) as Record<PromptTask, TaskPrompt>;
    },
    /** The learner's own system prompt of a task, filled in; undefined: the standing rules apply. */
    rulesFor(task: PromptTask, language: Lang, target: Lang): string | undefined {
      const custom = customPrompts()[task];
      return custom ? fill(custom, language, target) : undefined;
    },
    /** Saves the learner's own prompt of a task; null goes back to the standing rules. */
    setPrompt(task: PromptTask, template: string | null) {
      const { [task]: _, ...rest } = customPrompts();
      settings.set(PROMPTS, template?.trim() ? { ...rest, [task]: template } : rest);
    },
  };
}
export type Llm = ReturnType<typeof createLlm>;
