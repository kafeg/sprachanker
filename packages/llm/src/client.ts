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

/** A chat model and what its endpoint tells of it (OpenRouter tells much, most servers only the id). */
export interface ModelInfo {
  id: string;
  name?: string;
  /** Costs nothing (OpenRouter's free variants). */
  free?: boolean;
  /** Price in US dollars per million tokens read and written. */
  price?: { input: number; output: number };
  /** Tokens it takes in at once. */
  contextLength?: number;
  /** Answers in a JSON schema (structured outputs): writing checks and scenes need it. */
  json?: boolean;
  /** Calls tools (the tutor's). */
  tools?: boolean;
  /** Who made it ("anthropic" of "anthropic/claude-…"). */
  publisher?: string;
}

interface RawModel {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  /** Groq's name for the context length. */
  context_window?: unknown;
  /** Who serves it (Groq, Gemini); the publisher when the id does not name one. */
  owned_by?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  architecture?: { output_modalities?: unknown };
  supported_parameters?: unknown;
}

const perMillion = (value: unknown) => {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1000) / 1000 : undefined;
};

/**
 * A model of an OpenAI-compatible `/models` list with what the endpoint tells of it; undefined for one
 * that is no chat model: an embedding model, speech in or out, an image or video generator, a safety
 * classifier — by its id where the list does not say (Groq, Gemini) —, or one whose output is not
 * text alone.
 */
const NOT_CHAT = /embed|whisper|tts|orpheus|guard|imagen|veo|image|audio|aqa/i;

export function modelInfo(raw: RawModel): ModelInfo | undefined {
  if (typeof raw.id !== "string" || NOT_CHAT.test(raw.id)) return undefined;
  const output = raw.architecture?.output_modalities;
  if (Array.isArray(output) && output.some((m) => m !== "text")) return undefined;
  const input = perMillion(raw.pricing?.prompt);
  const outputPrice = perMillion(raw.pricing?.completion);
  const params = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : undefined;
  const slash = raw.id.indexOf("/");
  return {
    id: raw.id,
    ...(typeof raw.name === "string" && { name: raw.name }),
    ...((raw.id.endsWith(":free") || (input === 0 && outputPrice === 0)) && { free: true }),
    ...(input !== undefined &&
      outputPrice !== undefined && { price: { input, output: outputPrice } }),
    ...(typeof raw.context_length === "number" && { contextLength: raw.context_length }),
    ...(typeof raw.context_window === "number" && { contextLength: raw.context_window }),
    ...(params && {
      json: params.includes("response_format") || params.includes("structured_outputs"),
      tools: params.includes("tools"),
    }),
    ...(slash > 0
      ? { publisher: raw.id.slice(0, slash) }
      : typeof raw.owned_by === "string" && raw.owned_by && { publisher: raw.owned_by }),
  };
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
  /** Chat models the endpoint offers (embedding, image and audio models are left out). */
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
  /** The provider's limit is reached for now (429: free tiers limit requests per minute and day). */
  | "rate_limited"
  /** A structured reply stayed invalid after the repair attempt. */
  | "invalid_output";

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    /** The HTTP status the provider answered with, when it answered. */
    readonly status?: number,
  ) {
    super(message);
  }
}

/** The provider refused the request as sent (400, 422): asking again without an option may help. */
const refused = (error: unknown) =>
  error instanceof LlmError && (error.status === 400 || error.status === 422);

/**
 * The time a request may take: until its first byte, then between chunks of a streamed reply (it is
 * extended as data arrives), so a slow model is never cut off while it is still writing.
 */
class TimeLimit {
  private readonly ctl = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(ms: number) {
    this.extend(ms);
  }
  get signal() {
    return this.ctl.signal;
  }
  get expired() {
    return this.ctl.signal.aborted;
  }
  extend(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.ctl.abort(), ms);
    // A pending limit does not keep the process alive (Bun, Node).
    (this.timer as { unref?: () => void }).unref?.();
  }
  clear() {
    clearTimeout(this.timer);
  }
}

/**
 * An error while reading a response body: the limit run out is a timeout, a dropped connection is
 * unreachable; the learner stopping, and errors already mapped, stay as they are.
 */
function readFailure(error: unknown, base: string, limit: TimeLimit, signal?: AbortSignal) {
  if (limit.expired) return new LlmError("timeout", `${base} stopped answering`);
  if (signal?.aborted || error instanceof LlmError) return error;
  return new LlmError("unreachable", `${base}: the connection broke off`);
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
const ANSWER_NOW = "Answer the learner now with the information you have; no more tools.";
/** Local servers may load the model on the first request (JIT), which takes a while. */
const CHAT_TIMEOUT_MS = 180_000;
/** Silence allowed between chunks of a streamed reply. */
const IDLE_MS = 60_000;

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

  /** A request under a time limit (milliseconds, or a limit the caller extends while reading). */
  return async function call(
    path: string,
    init: RequestInit,
    limit: number | TimeLimit,
    signal?: AbortSignal,
  ): Promise<Response> {
    const time = typeof limit === "number" ? new TimeLimit(limit) : limit;
    let res: Response;
    try {
      res = await fetchFn(`${base}${path}`, {
        ...init,
        headers,
        signal: signal ? AbortSignal.any([signal, time.signal]) : time.signal,
      });
    } catch (error) {
      if (time.expired) throw new LlmError("timeout", `${base} did not answer in time`);
      if (signal?.aborted) throw error;
      throw new LlmError("unreachable", `${base} is not reachable`);
    }
    if (res.ok) return res;
    const text = await res.text().catch(() => "");
    const message = errorMessage(text) ?? `HTTP ${res.status}`;
    // Gemini refuses a wrong key with 400 and says so.
    if (
      res.status === 401 ||
      res.status === 403 ||
      (res.status === 400 && /api key/i.test(message))
    )
      throw new LlmError("unauthorized", message, res.status);
    if (res.status === 404) throw new LlmError("model_not_found", message, res.status);
    if (res.status === 429) throw new LlmError("rate_limited", message, res.status);
    throw new LlmError("bad_response", message, res.status);
  };
}

export function openAiCompatible(
  endpoint: Endpoint,
  fetchFn: typeof fetch = fetch,
  /** Until the first byte, and between chunks of a streamed reply (tests shorten them). */
  limits = { firstMs: CHAT_TIMEOUT_MS, idleMs: IDLE_MS },
): LlmClient {
  const call = endpointCaller(endpoint.baseUrl, endpoint.apiKey, fetchFn);
  const base = endpoint.baseUrl.replace(/\/+$/, "");

  return {
    async models(signal) {
      const res = await call("/models", { method: "GET" }, MODELS_TIMEOUT_MS, signal);
      const body = (await res.json().catch(() => null)) as { data?: RawModel[] } | null;
      if (!Array.isArray(body?.data)) throw new LlmError("bad_response", "no model list");
      return body.data.flatMap((m) => modelInfo(m) ?? []);
    },
    chat(request) {
      const open = (
        messages: ChatMessage[],
        options: { switchOff: boolean; tools: boolean },
        limit: TimeLimit,
      ) =>
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
          limit,
          request.signal,
        );
      // Models that always reason reject the switch, some servers reject tools: ask again without
      // (only when the request itself was refused — not when the server is busy or failing).
      const openWithFallbacks = async (
        messages: ChatMessage[],
        tools: boolean,
        limit: TimeLimit,
      ) => {
        const switchOff = request.reasoning === false && !!endpoint.noReasoning;
        const tries = [
          { switchOff, tools },
          ...(switchOff ? [{ switchOff: false, tools }] : []),
          ...(tools ? [{ switchOff: false, tools: false }] : []),
        ];
        let last: unknown;
        for (const t of tries) {
          try {
            return { res: await open(messages, t, limit), tools: t.tools };
          } catch (error) {
            last = error;
            if (!refused(error)) throw error;
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
            const last = round === MAX_TOOL_ROUNDS - 1;
            const limit = new TimeLimit(limits.firstMs);
            const calls: ToolCall[] = [];
            let text = "";
            try {
              const opened = await openWithFallbacks(messages, tools && !last, limit);
              tools = opened.tools;
              const stop = request.signal
                ? AbortSignal.any([request.signal, limit.signal])
                : limit.signal;
              const events = streamEvents(opened.res, stop, () => limit.extend(limits.idleMs));
              for await (const event of events) {
                if (event.text) {
                  text += event.text;
                  yield event.text;
                } else if (event.toolCalls) calls.push(...event.toolCalls);
              }
            } catch (error) {
              throw readFailure(error, base, limit, request.signal);
            } finally {
              limit.clear();
            }
            if (text.trim() && (!calls.length || last)) return;
            if (!calls.length || !request.runTool || last) {
              if (round > 0 && !last) {
                // Tool results came back but no answer: ask for it once more, without tools.
                messages = [...messages, { role: "user", content: ANSWER_NOW }];
                round = MAX_TOOL_ROUNDS - 2;
                continue;
              }
              return;
            }
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
              // The next round is the last one, without tools: say so, or some models stay silent.
              ...(round === MAX_TOOL_ROUNDS - 2
                ? [{ role: "user" as const, content: ANSWER_NOW }]
                : []),
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
        const limit = new TimeLimit(limits.firstMs);
        try {
          const res = await call(
            "/chat/completions",
            { method: "POST", body: JSON.stringify({ ...body, stream: false }) },
            limit,
            request.signal,
          );
          let json: { choices?: Array<{ message?: { content?: unknown } }> } | null;
          try {
            json = JSON.parse(await res.text());
          } catch (error) {
            // Not JSON at all is a bad reply; a body that never arrived is a timeout or a dropped
            // connection.
            if (error instanceof SyntaxError) throw new LlmError("bad_response", "no JSON reply");
            throw readFailure(error, base, limit, request.signal);
          }
          const content = json?.choices?.[0]?.message?.content;
          if (typeof content !== "string") throw new LlmError("bad_response", "no reply");
          return content
            .replace(/<think>[\s\S]*?<\/think>/g, "")
            .replace(SPECIAL_TOKEN, "")
            .trim();
        } catch (error) {
          last = error;
          if (!refused(error)) throw error;
        } finally {
          limit.clear();
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
  /** Stops reading: the time limit or the learner (whatever the fetch implementation does). */
  stop: AbortSignal,
  onData: () => void,
): AsyncIterable<{ text?: string; toolCalls?: ToolCall[] }> {
  if (!res.body) throw new LlmError("bad_response", "empty response");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const cancel = () => void reader.cancel().catch(() => {});
  stop.addEventListener("abort", cancel, { once: true });
  // Tool calls arrive in pieces, by index: id and name first, then the arguments. A server that sends
  // no index sends one call at a time: a delta with an id starts the next call.
  const calls: ToolCall[] = [];
  let buffer = "";
  try {
    reading: while (true) {
      const { value, done } = await reader.read();
      if (stop.aborted) throw stop.reason ?? new Error("stopped");
      // The last line may come without a newline.
      if (done) buffer += "\n";
      else {
        onData();
        buffer += value;
      }
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
          const index = part.index ?? (part.id || !calls.length ? calls.length : calls.length - 1);
          calls[index] ??= {
            id: part.id ?? `call_${index}`,
            type: "function",
            function: { name: "", arguments: "" },
          };
          const call = calls[index] as ToolCall;
          if (part.id) call.id = part.id;
          if (part.function?.name) call.function.name += part.function.name;
          if (part.function?.arguments) call.function.arguments += part.function.arguments;
        }
      }
      if (done) break;
    }
  } finally {
    stop.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const complete = calls.filter((c) => c?.function.name);
  if (complete.length) yield { toolCalls: complete };
}

interface ToolCallDelta {
  index?: number;
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
    type Body = { error?: string | { message?: string } };
    const parsed = JSON.parse(body) as Body | Body[];
    // Gemini wraps the error in a list.
    const json = Array.isArray(parsed) ? (parsed[0] ?? {}) : parsed;
    return typeof json.error === "string" ? json.error : json.error?.message;
  } catch {
    return body.trim().slice(0, 200) || undefined;
  }
}
