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
  signal?: AbortSignal;
}

export interface LlmClient {
  /** Chat models the endpoint offers (embedding models are left out). */
  models(signal?: AbortSignal): Promise<ModelInfo[]>;
  /** Streams the reply text; reasoning ("thinking") output is dropped. */
  chat(request: ChatRequest): AsyncIterable<string>;
}

export type LlmErrorCode =
  | "unreachable"
  | "unauthorized"
  | "model_not_found"
  | "timeout"
  | "bad_response";

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

export function openAiCompatible(endpoint: Endpoint, fetchFn: typeof fetch = fetch): LlmClient {
  const base = endpoint.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // OpenRouter shows the app name in its activity log; other servers ignore it.
    "x-title": "SprachAnker",
  };
  if (endpoint.apiKey) headers.authorization = `Bearer ${endpoint.apiKey}`;

  async function call(path: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal) {
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
  }

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
      const body = {
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.3,
        max_tokens: request.maxTokens,
        stream: true,
      };
      const open = (extra: Record<string, unknown> = {}) =>
        call(
          "/chat/completions",
          { method: "POST", body: JSON.stringify({ ...body, ...extra }) },
          CHAT_TIMEOUT_MS,
          request.signal,
        );
      const extra = request.reasoning === false ? endpoint.noReasoning : undefined;
      return stripThinking(
        streamChat(async () => {
          if (!extra) return open();
          try {
            return await open(extra);
          } catch (error) {
            // Models that always reason reject the switch: ask again without it.
            if (error instanceof LlmError && error.code === "bad_response") return open();
            throw error;
          }
        }),
      );
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
