// OpenAI-compatible chat endpoint (07, "Providers"): LM Studio, OpenRouter and any compatible URL.
// Uses only web-standard APIs (fetch, streams), so it runs in Bun, Node and tests alike.
import { stripThinking } from "./thinking.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
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
  signal?: AbortSignal;
}

/** What a task asks for, before a provider and model are attached. */
export type TaskRequest = Omit<ChatRequest, "model" | "signal">;

/**
 * The JSON body of a chat request exactly as it is posted — also shown in the prompt viewer (07,
 * "Debugging"). `noReasoning` are the provider's fields that turn reasoning off.
 */
export function chatBody(
  request: Omit<ChatRequest, "signal">,
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
      const open = (withSwitch: boolean) =>
        call(
          "/chat/completions",
          {
            method: "POST",
            body: JSON.stringify(chatBody(request, withSwitch ? endpoint.noReasoning : undefined)),
          },
          CHAT_TIMEOUT_MS,
          request.signal,
        );
      const extra = request.reasoning === false && !!endpoint.noReasoning;
      return stripThinking(
        streamChat(async () => {
          if (!extra) return open(false);
          try {
            return await open(true);
          } catch (error) {
            // Models that always reason reject the switch: ask again without it.
            if (error instanceof LlmError && error.code === "bad_response") return open(false);
            throw error;
          }
        }),
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

/** Text deltas of an OpenAI-style server-sent event stream. */
async function* streamChat(open: () => Promise<Response>): AsyncIterable<string> {
  const res = await open();
  if (!res.body) throw new LlmError("bad_response", "empty response");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const data = line.startsWith("data:") ? line.slice(5).trim() : undefined;
        if (!data) continue;
        if (data === "[DONE]") return;
        const chunk = parseChunk(data);
        if (chunk.error) throw new LlmError("bad_response", chunk.error);
        const text = chunk.text?.replace(SPECIAL_TOKEN, "");
        if (text) yield text;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseChunk(data: string): { text?: string; error?: string } {
  try {
    const json = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: unknown } }>;
      error?: { message?: string };
    };
    if (json.error) return { error: json.error.message ?? "error" };
    const text = json.choices?.[0]?.delta?.content;
    return typeof text === "string" ? { text } : {};
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
