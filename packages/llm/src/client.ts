// OpenAI-compatible chat endpoint (07, "Providers"): LM Studio, OpenRouter and any compatible URL.
// Uses only web-standard APIs (fetch, streams), so it runs in Bun, Node and tests alike.
import { stripThinking } from "./thinking.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** An assistant message that called tools. */
  tool_calls?: ToolCall[];
  /** A tool's result answers this call. */
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** A function the model may call (07, "Tools"); `parameters` is a JSON Schema. */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelInfo {
  id: string;
  name?: string;
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
    messages: request.messages,
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

export interface LlmClient {
  /** Chat models the endpoint offers (embedding models are left out). */
  models(signal?: AbortSignal): Promise<ModelInfo[]>;
  /** Streams the reply text; reasoning ("thinking") output is dropped. */
  chat(request: ChatRequest): AsyncIterable<string>;
  /** The whole reply at once (structured output); reasoning output is dropped. */
  complete(request: ChatRequest): Promise<string>;
}

export type LlmErrorCode =
  | "unreachable"
  | "unauthorized"
  | "model_not_found"
  | "timeout"
  | "bad_response"
  /** A structured reply stayed invalid after the repair attempt. */
  | "invalid_output";

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface Endpoint {
  baseUrl: string;
  apiKey?: string;
  /** Extra request fields that turn reasoning off (see ProviderPreset). */
  noReasoning?: Record<string, unknown>;
}

const MODELS_TIMEOUT_MS = 10_000;
/** Tool rounds per answer; the last round has no tools, so the model must answer. */
const MAX_TOOL_ROUNDS = 4;
/** Local servers may load the model on the first request (JIT), which takes a while. */
const CHAT_TIMEOUT_MS = 180_000;

/**
 * Requests to one HTTP endpoint with the shared error mapping (unreachable, timeout, unauthorized…).
 * Used by the OpenAI-compatible client and by provider-specific APIs (LM Studio).
 */
export function endpointCaller(baseUrl: string, apiKey: string | undefined, fetchFn: typeof fetch) {
  const base = baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // OpenRouter shows the app name in its activity log; other servers ignore it.
    "x-title": "SprachAnker",
  };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  return async function call(
    path: string,
    init: RequestInit,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await fetchFn(`${base}${path}`, {
        ...init,
        headers,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (timeout.aborted) throw new LlmError("timeout", `${base} did not answer in time`);
      if (signal?.aborted) throw error;
      throw new LlmError("unreachable", `${base} is not reachable`);
    }
    if (res.ok) return res;
    const text = await res.text().catch(() => "");
    const message = errorMessage(text) ?? `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) throw new LlmError("unauthorized", message);
    if (res.status === 404) throw new LlmError("model_not_found", message);
    throw new LlmError("bad_response", message);
  };
}

export function openAiCompatible(endpoint: Endpoint, fetchFn: typeof fetch = fetch): LlmClient {
  const call = endpointCaller(endpoint.baseUrl, endpoint.apiKey, fetchFn);

  return {
    async models(signal) {
      const res = await call("/models", { method: "GET" }, MODELS_TIMEOUT_MS, signal);
      const body = (await res.json().catch(() => null)) as {
        data?: Array<{ id?: unknown; name?: unknown }>;
      } | null;
      if (!Array.isArray(body?.data)) throw new LlmError("bad_response", "no model list");
      return body.data
        .filter((m): m is { id: string; name?: unknown } => typeof m.id === "string")
        .filter((m) => !/embed/i.test(m.id))
        .map((m) => (typeof m.name === "string" ? { id: m.id, name: m.name } : { id: m.id }));
    },
    chat(request) {
      const open = (messages: ChatMessage[], options: { switchOff: boolean; tools: boolean }) =>
        call(
          "/chat/completions",
          {
            method: "POST",
            body: JSON.stringify(
              chatBody(
                { ...request, messages, tools: options.tools ? request.tools : undefined },
                options.switchOff ? endpoint.noReasoning : undefined,
              ),
            ),
          },
          CHAT_TIMEOUT_MS,
          request.signal,
        );
      // Models that always reason reject the switch, some servers reject tools: ask again without.
      const openWithFallbacks = async (messages: ChatMessage[], tools: boolean) => {
        const switchOff = request.reasoning === false && !!endpoint.noReasoning;
        const tries = [
          { switchOff, tools },
          ...(switchOff ? [{ switchOff: false, tools }] : []),
          ...(tools ? [{ switchOff: false, tools: false }] : []),
        ];
        let last: unknown;
        for (const t of tries) {
          try {
            return { res: await open(messages, t), tools: t.tools };
          } catch (error) {
            last = error;
            if (!(error instanceof LlmError && error.code === "bad_response")) throw error;
          }
        }
        throw last;
      };
      return stripThinking(
        (async function* () {
          let messages = request.messages;
          let tools = !!request.tools?.length && !!request.runTool;
          // A few rounds: the model may call tools, read their results, then answer.
          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const opened = await openWithFallbacks(messages, tools && round < MAX_TOOL_ROUNDS - 1);
            tools = opened.tools;
            const calls: ToolCall[] = [];
            let text = "";
            for await (const event of streamEvents(opened.res)) {
              if (event.text) {
                text += event.text;
                yield event.text;
              } else if (event.toolCalls) calls.push(...event.toolCalls);
            }
            if (!calls.length || !request.runTool) return;
            const results: ChatMessage[] = [];
            for (const c of calls) {
              let args: unknown = {};
              try {
                args = JSON.parse(c.function.arguments || "{}");
              } catch {}
              const result = await request
                .runTool(c.function.name, args)
                .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
              results.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(result) });
            }
            messages = [
              ...messages,
              { role: "assistant", content: text, tool_calls: calls },
              ...results,
            ];
          }
        })(),
      );
    },
    async complete(request) {
      // Fallbacks: without the reasoning switch, then without the schema (the prompt still asks for
      // JSON), for servers that reject either.
      const attempts = [
        { switchOff: true, schema: true },
        { switchOff: false, schema: true },
        { switchOff: false, schema: false },
      ].filter((a) => (a.switchOff ? request.reasoning === false && !!endpoint.noReasoning : true));
      let last: unknown;
      for (const a of attempts) {
        if (!a.schema && !request.jsonSchema) break;
        const body = chatBody(
          { ...request, jsonSchema: a.schema ? request.jsonSchema : undefined },
          a.switchOff ? endpoint.noReasoning : undefined,
        );
        try {
          const res = await call(
            "/chat/completions",
            { method: "POST", body: JSON.stringify({ ...body, stream: false }) },
            CHAT_TIMEOUT_MS,
            request.signal,
          );
          const json = (await res.json().catch(() => null)) as {
            choices?: Array<{ message?: { content?: unknown } }>;
          } | null;
          const content = json?.choices?.[0]?.message?.content;
          if (typeof content !== "string") throw new LlmError("bad_response", "no reply");
          return content
            .replace(/<think>[\s\S]*?<\/think>/g, "")
            .replace(SPECIAL_TOKEN, "")
            .trim();
        } catch (error) {
          last = error;
          if (!(error instanceof LlmError && error.code === "bad_response")) throw error;
        }
      }
      throw last;
    },
  };
}

/** Control tokens some local models leak into the text (Gemma: "<audio|>", others: "<|im_end|>"). */
const SPECIAL_TOKEN = /<\|?[a-z_]+\|>/g;

/** Text deltas and, at the end, the tool calls of an OpenAI-style server-sent event stream. */
async function* streamEvents(
  res: Response,
): AsyncIterable<{ text?: string; toolCalls?: ToolCall[] }> {
  if (!res.body) throw new LlmError("bad_response", "empty response");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  // Tool calls arrive in pieces, by index: id and name first, then the arguments.
  const calls: ToolCall[] = [];
  let buffer = "";
  try {
    reading: while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const data = line.startsWith("data:") ? line.slice(5).trim() : undefined;
        if (!data) continue;
        if (data === "[DONE]") break reading;
        const chunk = parseChunk(data);
        if (chunk.error) throw new LlmError("bad_response", chunk.error);
        const text = chunk.text?.replace(SPECIAL_TOKEN, "");
        if (text) yield { text };
        for (const part of chunk.toolCalls ?? []) {
          calls[part.index] ??= {
            id: part.id ?? `call_${part.index}`,
            type: "function",
            function: { name: "", arguments: "" },
          };
          const call = calls[part.index] as ToolCall;
          if (part.id) call.id = part.id;
          if (part.function?.name) call.function.name += part.function.name;
          if (part.function?.arguments) call.function.arguments += part.function.arguments;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  const complete = calls.filter((c) => c?.function.name);
  if (complete.length) yield { toolCalls: complete };
}

interface ToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

function parseChunk(data: string): { text?: string; toolCalls?: ToolCallDelta[]; error?: string } {
  try {
    const json = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: unknown; tool_calls?: ToolCallDelta[] } }>;
      error?: { message?: string };
    };
    if (json.error) return { error: json.error.message ?? "error" };
    const delta = json.choices?.[0]?.delta;
    return {
      text: typeof delta?.content === "string" ? delta.content : undefined,
      toolCalls: delta?.tool_calls,
    };
  } catch {
    return {};
  }
}

function errorMessage(body: string): string | undefined {
  try {
    const json = JSON.parse(body) as { error?: string | { message?: string } };
    return typeof json.error === "string" ? json.error : json.error?.message;
  } catch {
    return body.trim().slice(0, 200) || undefined;
  }
}
