// OpenAI-compatible chat endpoint (07, "Providers"): LM Studio, OpenRouter and any compatible URL.
// Uses only web-standard APIs (fetch, streams), so it runs in Bun, Node and tests alike.
import { LlmError } from "./errors.ts";
import { type ModelInfo, modelInfo, type RawModel } from "./models.ts";
import { SPECIAL_TOKEN, streamEvents, type ToolCall } from "./sse.ts";

export type { ToolCall } from "./sse.ts";

import { stripThinking } from "./thinking.ts";

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
function withToolNotes(messages: ChatMessage[], notes: string[] | undefined): ChatMessage[] {
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
