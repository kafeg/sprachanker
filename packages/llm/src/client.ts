// OpenAI-compatible chat endpoint (07, "Providers"): LM Studio, OpenRouter and any compatible URL.
// Uses only web-standard APIs (fetch, streams), so it runs in Bun, Node and tests alike.
import { LlmError } from "./errors.ts";
import {
  bearer,
  CHAT_LIMITS,
  cutShort,
  endpointCaller,
  type Limits,
  MODELS_TIMEOUT_MS,
  readJson,
  refusal,
  relaxing,
  TimeLimit,
} from "./http.ts";
import { type ModelInfo, modelInfo, type RawModel } from "./models.ts";
import { SPECIAL_TOKEN, streamEvents, type ToolCall } from "./sse.ts";

export type { ToolCall } from "./sse.ts";

import { stripThinking } from "./thinking.ts";
import { toolRounds } from "./tool-rounds.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** An assistant message that called tools. */
  tool_calls?: ToolCall[];
  /** A tool's result answers this call. */
  tool_call_id?: string;
}

/** A function the model may call (07, "Tools"); `parameters` is a JSON Schema. */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** false: answer without reasoning first (fast replies), where the provider allows it. */
  reasoning?: boolean;
  /** Ask for JSON matching this schema (structured output); used with complete(). */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /** Functions the model may call while answering; `runTool` answers each call. */
  tools?: ToolDef[];
  /** How to use the tools: added to the end of the first system message only when the tools are
   *  sent (a model without them must not be told to call them). */
  toolNotes?: string[];
  runTool?: (name: string, args: unknown) => Promise<unknown>;
  signal?: AbortSignal;
}

/** What a task asks for, before a provider and model are attached. */
export type TaskRequest = Omit<ChatRequest, "model" | "signal" | "runTool">;

/**
 * What sets one provider's API apart from the plain OpenAI-compatible one (07, "Providers"): how its
 * reasoning is turned off, which models reason, what its model list holds that is no chat model.
 */
export interface ApiQuirks {
  /** Request fields that turn a model's reasoning off, in this provider's dialect; by model where
   *  its families take different ones (undefined: the model has none). */
  noReasoning?: Record<string, unknown> | ((model: string) => Record<string, unknown> | undefined);
  /** The models that reason (OpenAI: o-series, gpt-5…): only they get the switch; they take no
   *  temperature, and their reasoning counts in the token limit, so it gets room. Unset: every model
   *  gets the switch and a temperature. */
  reasoners?: RegExp;
  /** The limit is `max_completion_tokens` (OpenAI: newer models refuse `max_tokens`). */
  completionTokens?: boolean;
  /** Models of the list that are no chat models, beyond the usual ones (models.ts). */
  notChat?: RegExp;
}

/** Tokens a reasoning model may think before it answers, on top of the task's limit. */
export const REASONING_ROOM = 4096;

/** The fields that turn this model's reasoning off, where the provider has them. */
export const reasoningSwitch = (quirks: ApiQuirks, model: string) =>
  typeof quirks.noReasoning === "function" ? quirks.noReasoning(model) : quirks.noReasoning;

/** Whether a request turns reasoning off with the provider's switch. */
export const sendsSwitch = (request: { model: string; reasoning?: boolean }, quirks: ApiQuirks) =>
  request.reasoning === false &&
  !!reasoningSwitch(quirks, request.model) &&
  (!quirks.reasoners || quirks.reasoners.test(request.model));

/** What a request may go without when the provider refuses it (http.ts `relaxing`). */
interface BodyOptions {
  switchOff: boolean;
  temperature: boolean;
  /** The schema with `strict: true` (OpenAI and others refuse a schema strict mode cannot take). */
  strict: boolean;
}

/**
 * The JSON body of a chat request exactly as it is posted — also shown in the prompt viewer (07,
 * "Debugging"), with every option on.
 */
export function chatBody(
  request: Omit<ChatRequest, "signal" | "runTool">,
  quirks: ApiQuirks = {},
  options: Partial<BodyOptions> = {},
) {
  const { switchOff = sendsSwitch(request, quirks), temperature = true, strict = true } = options;
  const reasoner = !!quirks.reasoners?.test(request.model);
  const maxTokens =
    request.maxTokens !== undefined && reasoner
      ? request.maxTokens + REASONING_ROOM
      : request.maxTokens;
  return {
    model: request.model,
    messages: request.tools?.length
      ? withToolNotes(request.messages, request.toolNotes)
      : request.messages,
    ...(temperature && !reasoner && { temperature: request.temperature ?? 0.3 }),
    ...(quirks.completionTokens ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
    // Structured answers are read whole; text is streamed.
    stream: !request.jsonSchema,
    ...(request.jsonSchema && {
      response_format: {
        type: "json_schema",
        json_schema: {
          name: request.jsonSchema.name,
          strict,
          schema: strict ? strictSchema(request.jsonSchema.schema) : request.jsonSchema.schema,
        },
      },
    }),
    ...(request.tools?.length && {
      tools: request.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    }),
    ...(switchOff ? reasoningSwitch(quirks, request.model) : undefined),
  };
}

/** Keywords strict mode refuses (OpenAI); the reply is still checked against them by zod. */
const NOT_STRICT = new Set([
  "minLength",
  "maxLength",
  "patternProperties",
  "unevaluatedProperties",
  "propertyNames",
  "minProperties",
  "maxProperties",
  "unevaluatedItems",
  "contains",
  "minContains",
  "maxContains",
  "uniqueItems",
]);
/** Where a schema's keys are names (of properties, of definitions), not keywords. */
const NAMED_SCHEMAS = new Set(["properties", "$defs", "definitions"]);
/** Where a schema holds values, not schemas. */
const VALUES = new Set(["enum", "const", "default", "examples"]);

/** A JSON Schema without the keywords strict mode refuses, at every depth. */
export const strictSchema = (schema: Record<string, unknown>) =>
  withoutUnstrict(schema) as Record<string, unknown>;

function withoutUnstrict(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutUnstrict);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (NOT_STRICT.has(key)) continue;
    out[key] = VALUES.has(key)
      ? value
      : NAMED_SCHEMAS.has(key) && value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withoutUnstrict(v)]))
        : withoutUnstrict(value);
  }
  return out;
}

/** The messages with the tool notes at the end of the first system message. */
export function withToolNotes(messages: ChatMessage[], notes: string[] | undefined): ChatMessage[] {
  const at = messages.findIndex((m) => m.role === "system");
  if (!notes?.length || at < 0) return messages;
  return messages.map((m, i) =>
    i === at ? { ...m, content: `${m.content ?? ""}\n\n${notes.join("\n")}` } : m,
  );
}

export interface LlmClient {
  /** Chat models the endpoint offers (embedding, image and audio models are left out). */
  models(signal?: AbortSignal): Promise<ModelInfo[]>;
  /** Streams the reply text; reasoning ("thinking") output is dropped. */
  chat(request: ChatRequest): AsyncIterable<string>;
  /** The whole reply at once (structured output); reasoning output is dropped. */
  complete(request: ChatRequest): Promise<string>;
}

export interface Endpoint extends ApiQuirks {
  baseUrl: string;
  apiKey?: string;
}

/** A refusal that names what it refused: that option goes first. */
const NAMED = {
  switchOff: /reasoning/i,
  temperature: /temperature/i,
  strict: /schema|response_format/i,
};

export function openAiCompatible(
  endpoint: Endpoint,
  fetchFn: typeof fetch = fetch,
  limits: Limits = CHAT_LIMITS,
): LlmClient {
  const call = endpointCaller(endpoint.baseUrl, bearer(endpoint.apiKey), fetchFn);
  const base = endpoint.baseUrl.replace(/\/+$/, "");
  const post = (body: unknown, limit: TimeLimit, signal?: AbortSignal) =>
    call("/chat/completions", { method: "POST", body: JSON.stringify(body) }, limit, signal);

  return {
    async models(signal) {
      const res = await call("/models", { method: "GET" }, MODELS_TIMEOUT_MS, signal);
      const body = (await res.json().catch(() => null)) as { data?: RawModel[] } | null;
      if (!Array.isArray(body?.data)) throw new LlmError("bad_response", "no model list");
      return body.data.flatMap((m) =>
        typeof m.id === "string" && endpoint.notChat?.test(m.id) ? [] : (modelInfo(m) ?? []),
      );
    },
    chat(request) {
      const on = { switchOff: sendsSwitch(request, endpoint), temperature: true };
      return stripThinking(
        toolRounds<ChatMessage>(
          request,
          {
            messages: request.messages,
            // Models that always reason reject the switch, reasoning models a temperature, some
            // servers tools: asked again without.
            open: (messages, tools, limit) =>
              relaxing(
                { ...on, tools },
                ["switchOff", "tools"],
                (now) =>
                  post(
                    chatBody(
                      { ...request, messages, tools: now.tools ? request.tools : undefined },
                      endpoint,
                      now,
                    ),
                    limit,
                    request.signal,
                  ).then((res) => {
                    // A later round goes without what this one was refused.
                    Object.assign(on, { switchOff: now.switchOff, temperature: now.temperature });
                    return { res, tools: now.tools };
                  }),
                NAMED,
              ),
            events: (res, stop, onData) =>
              streamEvents(res, stop, onData, () => cutShort(base, request.model)),
            answered: (messages, round, results, note) => [
              ...messages,
              { role: "assistant", content: round.text, tool_calls: round.calls },
              ...results.map((r) => ({
                role: "tool" as const,
                tool_call_id: r.call.id,
                content: r.content,
              })),
              ...(note ? [{ role: "user" as const, content: note }] : []),
            ],
            say: (messages, text) => [...messages, { role: "user", content: text }],
          },
          limits,
          base,
        ),
      );
    },
    async complete(request) {
      // Fallbacks: without the reasoning switch or a temperature, then the schema not strict, then
      // without it (the prompt still asks for JSON), for servers that reject any of them.
      return relaxing(
        {
          switchOff: sendsSwitch(request, endpoint),
          temperature: true,
          strict: !!request.jsonSchema,
          schema: !!request.jsonSchema,
        },
        ["switchOff", "strict", "schema"],
        async (on) => {
          const body = chatBody(
            { ...request, jsonSchema: on.schema ? request.jsonSchema : undefined },
            endpoint,
            on,
          );
          const limit = new TimeLimit(limits.firstMs);
          try {
            const res = await post({ ...body, stream: false }, limit, request.signal);
            const json = await readJson<{
              choices?: Array<{
                message?: { content?: unknown; refusal?: unknown };
                finish_reason?: string | null;
              }>;
            }>(res, base, limit, request.signal);
            const choice = json?.choices?.[0];
            if (typeof choice?.message?.refusal === "string" && choice.message.refusal)
              throw refusal();
            if (choice?.finish_reason === "length") cutShort(base, request.model);
            const content = choice?.message?.content;
            if (typeof content !== "string") throw new LlmError("bad_response", "no reply");
            return content
              .replace(/<think>[\s\S]*?<\/think>/g, "")
              .replace(SPECIAL_TOKEN, "")
              .trim();
          } finally {
            limit.clear();
          }
        },
        NAMED,
      );
    },
  };
}
