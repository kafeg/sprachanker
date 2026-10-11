// OpenAI-compatible chat endpoint (07, "Providers"): LM Studio, OpenRouter and any compatible URL.
// Uses only web-standard APIs (fetch, streams), so it runs in Bun, Node and tests alike.
import { LlmError } from "./errors.ts";
import {
  bearer,
  CHAT_LIMITS,
  endpointCaller,
  type Limits,
  MODELS_TIMEOUT_MS,
  readJson,
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
 * The JSON body of a chat request exactly as it is posted — also shown in the prompt viewer (07,
 * "Debugging"). `noReasoning` are the provider's fields that turn reasoning off.
 */
export function chatBody(
  request: Omit<ChatRequest, "signal" | "runTool">,
  noReasoning?: Record<string, unknown>,
) {
  return {
    model: request.model,
    messages: request.tools?.length
      ? withToolNotes(request.messages, request.toolNotes)
      : request.messages,
    temperature: request.temperature ?? 0.3,
    max_tokens: request.maxTokens,
    // Structured answers are read whole; text is streamed.
    stream: !request.jsonSchema,
    ...(request.jsonSchema && {
      response_format: {
        type: "json_schema",
        json_schema: {
          name: request.jsonSchema.name,
          strict: true,
          schema: request.jsonSchema.schema,
        },
      },
    }),
    ...(request.tools?.length && {
      tools: request.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    }),
    ...(request.reasoning === false ? noReasoning : undefined),
  };
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

export interface Endpoint {
  baseUrl: string;
  apiKey?: string;
  /** Extra request fields that turn reasoning off (see ProviderPreset). */
  noReasoning?: Record<string, unknown>;
}

export function openAiCompatible(
  endpoint: Endpoint,
  fetchFn: typeof fetch = fetch,
  limits: Limits = CHAT_LIMITS,
): LlmClient {
  const call = endpointCaller(endpoint.baseUrl, bearer(endpoint.apiKey), fetchFn);
  const base = endpoint.baseUrl.replace(/\/+$/, "");
  const post = (body: unknown, limit: TimeLimit, signal?: AbortSignal) =>
    call("/chat/completions", { method: "POST", body: JSON.stringify(body) }, limit, signal);
  /** The reasoning switch is sent where the request asks for it and the provider has one. */
  const switchOff = (request: ChatRequest) => request.reasoning === false && !!endpoint.noReasoning;

  return {
    async models(signal) {
      const res = await call("/models", { method: "GET" }, MODELS_TIMEOUT_MS, signal);
      const body = (await res.json().catch(() => null)) as { data?: RawModel[] } | null;
      if (!Array.isArray(body?.data)) throw new LlmError("bad_response", "no model list");
      return body.data.flatMap((m) => modelInfo(m) ?? []);
    },
    chat(request) {
      return stripThinking(
        toolRounds<ChatMessage>(
          request,
          {
            messages: request.messages,
            // Models that always reason reject the switch, some servers reject tools: asked again
            // without.
            open: (messages, tools, limit) =>
              relaxing({ switchOff: switchOff(request), tools }, ["switchOff", "tools"], (on) =>
                post(
                  chatBody(
                    { ...request, messages, tools: on.tools ? request.tools : undefined },
                    on.switchOff ? endpoint.noReasoning : undefined,
                  ),
                  limit,
                  request.signal,
                ).then((res) => ({ res, tools: on.tools })),
              ),
            events: streamEvents,
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
      // Fallbacks: without the reasoning switch, then without the schema (the prompt still asks for
      // JSON), for servers that reject either.
      return relaxing(
        { switchOff: switchOff(request), schema: !!request.jsonSchema },
        ["switchOff", "schema"],
        async (on) => {
          const body = chatBody(
            { ...request, jsonSchema: on.schema ? request.jsonSchema : undefined },
            on.switchOff ? endpoint.noReasoning : undefined,
          );
          const limit = new TimeLimit(limits.firstMs);
          try {
            const res = await post({ ...body, stream: false }, limit, request.signal);
            const json = await readJson<{
              choices?: Array<{ message?: { content?: unknown } }>;
            }>(res, base, limit, request.signal);
            const content = json?.choices?.[0]?.message?.content;
            if (typeof content !== "string") throw new LlmError("bad_response", "no reply");
            return content
              .replace(/<think>[\s\S]*?<\/think>/g, "")
              .replace(SPECIAL_TOKEN, "")
              .trim();
          } finally {
            limit.clear();
          }
        },
      );
    },
  };
}
