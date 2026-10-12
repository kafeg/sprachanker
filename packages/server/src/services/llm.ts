// LLM setup of the profile (provider endpoints, keys, the default route), the client of that route for
// the tasks that use it — a structured call, a request previewed —, with LM Studio (llm-lmstudio.ts)
// and the learner's own prompts (llm-prompts.ts). Everything model-specific lives in
// @sprachanker/llm.
import {
  type ChatMessage,
  type CliKind,
  type CliRunner,
  cliClient,
  cliCommand,
  cliRun,
  estimateTokens,
  type LlmClient,
  LlmError,
  LMSTUDIO_CONTEXT,
  type OpenRouterKey,
  openRouterKey,
  PROVIDERS,
  type ProviderId,
  providerClient,
  providerRequest,
  runStructured,
  type StructuredTask,
  type TaskRequest,
} from "@sprachanker/llm";
import type { ErrorCode } from "@sprachanker/schema";
import { eq } from "drizzle-orm";
import type { ProfileDb } from "../db/profile/db.ts";
import { llmRoutes, secrets } from "../db/profile/schema.ts";
import { ServiceError } from "../errors.ts";
import type { SecretBox } from "../security/secrets.ts";
import { createLmStudio, type LmStudioHost } from "./llm-lmstudio.ts";
import { createLlmPrompts } from "./llm-prompts.ts";
import type { Settings } from "./settings.ts";

export type { LmStudioHost } from "./llm-lmstudio.ts";

/** Settings key with custom endpoints by provider id. */
const ENDPOINTS = "llm.endpoints" as const;

/** Whether a URL carries a user name or password (`https://user:secret@host/`). */
const hasLogin = (url: string) => {
  const parsed = URL.parse(url);
  return !!(parsed?.username || parsed?.password);
};

/** The providers whose endpoint the learner may set: the only ones a stored endpoint counts for. */
export const EDITABLE_ENDPOINTS: readonly ProviderId[] = Object.values(PROVIDERS)
  .filter((p) => p.editableUrl)
  .map((p) => p.id);
const DEFAULT_ROUTE = "default";

/** The assistant cannot run as set up (no provider, key, model…): 409. */
class LlmSetupError extends ServiceError {
  constructor(code: ErrorCode) {
    super(code, 409);
  }
}

interface ProviderState {
  id: ProviderId;
  baseUrl: string;
  defaultUrl: string;
  key: "required" | "optional" | "none";
  hasKey: boolean;
  editableUrl: boolean;
  /** Command-line providers: whether the command is installed here. */
  installed?: boolean;
}

/** Command-line agents on this machine (src/runtime/cli.ts). */
export interface CliHost {
  installed(kind: CliKind): boolean;
  run(kind: CliKind): CliRunner;
}

/** A request as it would be sent: for the prompt viewer. */
export interface PromptPreview {
  provider: ProviderId;
  model: string;
  url: string;
  /** The HTTP body as posted, or a command-line agent's prompt (system file or instructions, and
   *  stdin) with its arguments. */
  body: { messages: ChatMessage[] } & Record<string, unknown>;
  /** Rough token count of each message. */
  tokens: number[];
}

/** A stopwatch for a model's answer (a call or a stream): every stored answer records how long it took. */
export function stopwatch(now: () => number) {
  const started = now();
  return () => Math.max(0, now() - started);
}

export interface LlmState {
  provider: ProviderId | null;
  model: string | null;
  providers: ProviderState[];
}

export function createLlm(deps: {
  db: ProfileDb;
  settings: Settings;
  box: SecretBox;
  fetch: typeof fetch;
  lmStudio?: LmStudioHost;
  cli?: CliHost;
  now: () => number;
}) {
  const { db, settings, box } = deps;
  const endpoints = (): Partial<Record<ProviderId, string>> => settings.get(ENDPOINTS) ?? {};
  const route = () => db.select().from(llmRoutes).where(eq(llmRoutes.task, DEFAULT_ROUTE)).get();
  const hasKey = (id: ProviderId) =>
    !!db.select().from(secrets).where(eq(secrets.providerId, id)).get();
  // A stored endpoint counts only where the learner may set one (an imported profile may hold others).
  const baseUrl = (id: ProviderId) =>
    (PROVIDERS[id].editableUrl ? endpoints()[id] : undefined) ?? PROVIDERS[id].baseUrl;
  const origin = (url: string) => URL.parse(url)?.origin ?? url;
  const apiKey = async (id: ProviderId) => {
    const row = db.select().from(secrets).where(eq(secrets.providerId, id)).get();
    return row ? await box.open(row.valueEncrypted) : undefined;
  };
  const lmStudio = createLmStudio({
    endpoint: async () => ({ baseUrl: baseUrl("lmstudio"), apiKey: await apiKey("lmstudio") }),
    fetch: deps.fetch,
    host: deps.lmStudio,
  });
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
    // load per model at a time.
    if (id === "lmstudio" && model) await lmStudio.ensureLoaded(model);
    return {
      client: providerClient(preset, { baseUrl: url, apiKey: key }, deps.fetch),
      model: model ?? "",
    };
  }

  const { ensureLoaded: _, ...lmStudioSettings } = lmStudio;
  const self = {
    ...lmStudioSettings,
    ...createLlmPrompts(settings),
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
      const values = { providerId: provider, model };
      db.insert(llmRoutes)
        .values({ task: DEFAULT_ROUTE, ...values })
        .onConflictDoUpdate({ target: llmRoutes.task, set: values })
        .run();
    },
    /** Endpoint (null → preset) and API key (null → remove; undefined → keep). */
    async setProvider(id: ProviderId, change: { baseUrl?: string | null; apiKey?: string | null }) {
      // A key or password goes in the key field, sealed — never in the address, kept as it is.
      if (change.baseUrl && hasLogin(change.baseUrl))
        throw new ServiceError("llm_url_with_login", 400);
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
    /** The request of the default route for a task, without sending it. */
    preview(task: TaskRequest): PromptPreview {
      const r = route();
      if (!r?.model || !known(r.providerId)) throw new LlmSetupError("llm_not_configured");
      const cli = PROVIDERS[r.providerId].cli as CliKind | undefined;
      const request = { ...task, model: r.model };
      // What the provider gets: the HTTP body, or the command line agent's prompt, files and flags.
      let body: PromptPreview["body"];
      let url: string;
      if (cli) {
        const { stdin, args, files } = cliRun(cli, request);
        body = {
          messages: [
            { role: "system", content: files?.["system.txt"] ?? "" },
            { role: "user", content: stdin },
          ],
          args,
          files: Object.keys(files ?? {}),
        };
        url = cliCommand(cli, r.model);
      } else
        ({ url, body } = providerRequest(PROVIDERS[r.providerId], baseUrl(r.providerId), request));
      return {
        provider: r.providerId,
        model: r.model,
        url,
        body,
        tokens: body.messages.map((m) => estimateTokens(m.content)),
      };
    },
    /** A structured task with the configured model: its result, the model and how long it took (a
     *  stored answer records both). `timeoutAgain`: a call that ran out of time asked once more (a
     *  step the learner waits for under a model's passing load). */
    async structured<T>(task: StructuredTask<T>, options: { timeoutAgain?: boolean } = {}) {
      const { client, model } = await self.model();
      const elapsed = stopwatch(deps.now);
      const result = await runStructured(client, model, task).catch((error: unknown) => {
        if (!options.timeoutAgain || !(error instanceof LlmError) || error.code !== "timeout")
          throw error;
        console.warn(`${task.name}: ${model} ran out of time; asked once more`);
        return runStructured(client, model, task);
      });
      return { result, model, latencyMs: elapsed() };
    },
    /** The model's context window when the app knows it (LM Studio: loaded by us with this size). */
    contextWindow(): number | null {
      return route()?.providerId === "lmstudio" ? LMSTUDIO_CONTEXT : null;
    },
  };
  return self;
}
export type Llm = ReturnType<typeof createLlm>;
