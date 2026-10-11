// Anthropic's Messages API (07, "Providers"): Claude models with an API key, through fetch alone. The
// app's chat (client.ts's ChatMessage) becomes its shape — the system prompt apart, turns alternating
// from the learner's, tool calls and results as blocks —, its streamed events the client's text and
// tool calls, so tasks never know which API answers them.
import {
  type ApiQuirks,
  type ChatMessage,
  type ChatRequest,
  type Endpoint,
  type LlmClient,
  REASONING_ROOM,
  sendsSwitch,
  withToolNotes,
} from "./client.ts";
import { LlmError } from "./errors.ts";
import {
  CHAT_LIMITS,
  endpointCaller,
  type Limits,
  MODELS_TIMEOUT_MS,
  readJson,
  relaxing,
  TimeLimit,
} from "./http.ts";
import type { ModelInfo } from "./models.ts";
import { sseData, type ToolCall } from "./sse.ts";
import { type RoundEvent, toolRounds } from "./tool-rounds.ts";

export const ANTHROPIC_VERSION = "2023-06-01";
/** A reply's limit where the task sets none (every task sets one); `max_tokens` is required. */
const DEFAULT_MAX_TOKENS = 4096;
/** The models list comes in pages; this many at most are read. */
const MODEL_PAGES = 10;
/** Said for the learner where the API needs a turn of theirs the app has not got. */
const BEGIN = "(begin)";
const GO_ON = "(go on)";

export type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string };

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicBlock[];
}

/** The messages with one more, merged into the last when it has the same role (the API wants turns
 *  alternating). */
function append(messages: AnthropicMessage[], next: AnthropicMessage): AnthropicMessage[] {
  if (!next.content.length) return messages;
  const last = messages.at(-1);
  if (last?.role !== next.role) return [...messages, next];
  return [...messages.slice(0, -1), { ...last, content: [...last.content, ...next.content] }];
}

const text = (t: string): AnthropicBlock[] => (t ? [{ type: "text", text: t }] : []);

function toolInput(args: string): unknown {
  try {
    return JSON.parse(args || "{}");
  } catch {
    return {};
  }
}

/**
 * A chat in the Messages API's shape: the system messages as one system prompt; turns alternating,
 * starting and ending with the learner's (a turn of theirs is said where one is missing); a tool call
 * as a `tool_use` block, its result as a `tool_result` block of the learner's next turn.
 */
export function anthropicMessages(chat: ChatMessage[]): {
  system: string;
  messages: AnthropicMessage[];
} {
  const system = chat
    .filter((m) => m.role === "system" && m.content)
    .map((m) => m.content)
    .join("\n\n");
  let messages: AnthropicMessage[] = [];
  for (const m of chat) {
    if (m.role === "user") messages = append(messages, { role: "user", content: text(m.content) });
    else if (m.role === "tool")
      messages = append(messages, {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.tool_call_id ?? "", content: m.content }],
      });
    else if (m.role === "assistant")
      messages = append(messages, {
        role: "assistant",
        content: [
          ...text(m.content),
          ...(m.tool_calls ?? []).map((c) => ({
            type: "tool_use" as const,
            id: c.id,
            name: c.function.name,
            input: toolInput(c.function.arguments),
          })),
        ],
      });
  }
  if (messages[0]?.role !== "user")
    messages = [{ role: "user", content: text(BEGIN) }, ...messages];
  if (messages.at(-1)?.role === "assistant")
    messages = append(messages, { role: "user", content: text(GO_ON) });
  return { system, messages };
}

/** The system prompt as sent: the tool notes when the chat offers tools, the schema a JSON reply
 *  must match. */
function systemOf(request: Omit<ChatRequest, "signal" | "runTool">, notes: boolean): string {
  const { system } = anthropicMessages(
    notes ? withToolNotes(request.messages, request.toolNotes) : request.messages,
  );
  if (!request.jsonSchema) return system;
  return `${system}\n\nReply with one JSON object matching this JSON Schema, and nothing else:\n${JSON.stringify(request.jsonSchema.schema)}`;
}

/** What one request is sent with. */
interface Sent {
  switchOff: boolean;
  /** The tools offered; without them, a conversation that already used tools still names them
   *  (the API asks for it) with `tool_choice: none`. */
  tools: boolean;
  /** The tool notes in the system prompt: as the chat's first round had them, in every round alike
   *  (a thinking model's replayed thinking is bound to the system prompt it was made under). */
  notes: boolean;
  stream: boolean;
}

function body(
  request: Omit<ChatRequest, "signal" | "runTool">,
  messages: AnthropicMessage[],
  quirks: ApiQuirks,
  sent: Sent,
) {
  const reasoner = !!quirks.reasoners?.test(request.model);
  const usedTools = messages.some((m) => m.content.some((b) => b.type === "tool_use"));
  const tools = request.tools?.length && (sent.tools || usedTools) ? request.tools : undefined;
  const system = systemOf(request, sent.notes);
  return {
    model: request.model,
    // Room to think for a model that may (newer Claude models think unless told otherwise).
    max_tokens: (request.maxTokens ?? DEFAULT_MAX_TOKENS) + (reasoner ? REASONING_ROOM : 0),
    ...(system && { system }),
    messages,
    stream: sent.stream,
    ...(tools && {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
      ...(!sent.tools && { tool_choice: { type: "none" } }),
    }),
    ...(sent.switchOff ? quirks.noReasoning : undefined),
  };
}

/** The body of a request exactly as it is posted, with every option on (the prompt viewer). */
export function anthropicBody(
  request: Omit<ChatRequest, "signal" | "runTool">,
  quirks: ApiQuirks = {},
) {
  return body(request, anthropicMessages(request.messages).messages, quirks, {
    switchOff: sendsSwitch(request, quirks),
    tools: !!request.tools?.length,
    notes: !!request.tools?.length,
    stream: !request.jsonSchema,
  });
}

/** An error the API reports by its type (in a stream, or a body). */
function apiError(error: { type?: string; message?: string } | undefined): LlmError {
  const message = error?.message ?? error?.type ?? "error";
  switch (error?.type) {
    case "overloaded_error":
      return new LlmError("overloaded", message, 529);
    case "rate_limit_error":
      return new LlmError("rate_limited", message, 429);
    case "authentication_error":
    case "permission_error":
      return new LlmError("unauthorized", message);
    case "not_found_error":
      return new LlmError("model_not_found", message);
    default:
      return new LlmError("bad_response", message);
  }
}

type StreamEvent = {
  type?: string;
  index?: number;
  content_block?: AnthropicBlock;
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    thinking?: string;
    signature?: string;
  };
  error?: { type?: string; message?: string };
};

/** The blocks a reply is made of and sent back with its tool results. */
const KEPT = new Set(["text", "tool_use", "thinking", "redacted_thinking"]);

/**
 * A streamed reply's text as it comes and, at the end, its tool calls with the reply's blocks
 * (thinking included: a model that thought before calling a tool is shown its thinking again).
 */
export async function* anthropicEvents(
  res: Response,
  stop: AbortSignal,
  onData: () => void,
): AsyncIterable<RoundEvent> {
  const blocks: AnthropicBlock[] = [];
  const inputs: string[] = [];
  for await (const data of sseData(res, stop, onData)) {
    let event: StreamEvent;
    try {
      event = JSON.parse(data) as StreamEvent;
    } catch {
      continue;
    }
    const i = event.index ?? 0;
    const block = blocks[i];
    if (event.type === "error") throw apiError(event.error);
    if (event.type === "message_stop") break;
    if (event.type === "content_block_start" && event.content_block) {
      blocks[i] = { ...event.content_block };
      inputs[i] = "";
    } else if (event.type === "content_block_delta" && block && event.delta) {
      const d = event.delta;
      if (d.type === "text_delta" && block.type === "text" && d.text) {
        block.text += d.text;
        yield { text: d.text };
      } else if (d.type === "input_json_delta") inputs[i] += d.partial_json ?? "";
      else if (d.type === "thinking_delta" && block.type === "thinking")
        block.thinking = (block.thinking ?? "") + (d.thinking ?? "");
      else if (d.type === "signature_delta" && block.type === "thinking")
        block.signature = (block.signature ?? "") + (d.signature ?? "");
    } else if (event.type === "content_block_stop" && block?.type === "tool_use")
      block.input = toolInput(inputs[i] ?? "");
  }
  const turn = blocks.filter((b) => b && KEPT.has(b.type) && !(b.type === "text" && !b.text));
  const calls: ToolCall[] = turn.flatMap((b) =>
    b.type === "tool_use"
      ? [
          {
            id: b.id,
            type: "function" as const,
            function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
          },
        ]
      : [],
  );
  if (calls.length) yield { toolCalls: calls, turn };
}

/** A refusal naming the effort setting drops it first. */
const NAMED = { switchOff: /effort|output_config/i };

export function anthropic(
  endpoint: Endpoint,
  fetchFn: typeof fetch = fetch,
  limits: Limits = CHAT_LIMITS,
): LlmClient {
  const call = endpointCaller(
    endpoint.baseUrl,
    {
      ...(endpoint.apiKey && { "x-api-key": endpoint.apiKey }),
      "anthropic-version": ANTHROPIC_VERSION,
    },
    fetchFn,
  );
  const base = endpoint.baseUrl.replace(/\/+$/, "");
  const post = (sent: unknown, limit: TimeLimit, signal?: AbortSignal) =>
    call("/messages", { method: "POST", body: JSON.stringify(sent) }, limit, signal);

  return {
    async models(signal) {
      const models: ModelInfo[] = [];
      let after: string | undefined;
      for (let page = 0; page < MODEL_PAGES; page++) {
        const query = `?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ""}`;
        const res = await call(`/models${query}`, { method: "GET" }, MODELS_TIMEOUT_MS, signal);
        const list = (await res.json().catch(() => null)) as {
          data?: Array<{ id?: unknown; display_name?: unknown; max_input_tokens?: unknown }>;
          has_more?: boolean;
          last_id?: string | null;
        } | null;
        if (!Array.isArray(list?.data)) throw new LlmError("bad_response", "no model list");
        for (const m of list.data)
          if (typeof m.id === "string")
            models.push({
              id: m.id,
              ...(typeof m.display_name === "string" && { name: m.display_name }),
              ...(typeof m.max_input_tokens === "number" && { contextLength: m.max_input_tokens }),
              // Every Claude model calls tools.
              tools: true,
            });
        if (!list.has_more || !list.last_id) break;
        after = list.last_id;
      }
      return models;
    },
    chat(request) {
      let switchOff = sendsSwitch(request, endpoint);
      let notes: boolean | undefined;
      return toolRounds<AnthropicMessage>(
        request,
        {
          messages: anthropicMessages(request.messages).messages,
          open: (messages, tools, limit) => {
            notes ??= tools;
            return relaxing(
              { switchOff },
              ["switchOff"],
              (on) =>
                post(
                  body(request, messages, endpoint, {
                    switchOff: on.switchOff,
                    tools,
                    notes: !!notes,
                    stream: true,
                  }),
                  limit,
                  request.signal,
                ).then((res) => {
                  // A later round goes without what this one was refused.
                  switchOff = on.switchOff;
                  return { res, tools };
                }),
              NAMED,
            );
          },
          events: anthropicEvents,
          answered: (messages, round, results, note) =>
            append(
              append(messages, {
                role: "assistant",
                content: (round.turn as AnthropicBlock[] | undefined) ?? [
                  ...text(round.text),
                  ...round.calls.map((c) => ({
                    type: "tool_use" as const,
                    id: c.id,
                    name: c.function.name,
                    input: toolInput(c.function.arguments),
                  })),
                ],
              }),
              {
                role: "user",
                content: [
                  ...results.map((r) => ({
                    type: "tool_result" as const,
                    tool_use_id: r.call.id,
                    content: r.content,
                  })),
                  ...text(note ?? ""),
                ],
              },
            ),
          say: (messages, line) => append(messages, { role: "user", content: text(line) }),
        },
        limits,
        base,
      );
    },
    async complete(request) {
      const { messages } = anthropicMessages(request.messages);
      return relaxing(
        { switchOff: sendsSwitch(request, endpoint) },
        ["switchOff"],
        async (on) => {
          const limit = new TimeLimit(limits.firstMs);
          try {
            const res = await post(
              body(request, messages, endpoint, {
                switchOff: on.switchOff,
                tools: false,
                notes: false,
                stream: false,
              }),
              limit,
              request.signal,
            );
            const json = await readJson<{
              content?: AnthropicBlock[];
              error?: { type?: string; message?: string };
            }>(res, base, limit, request.signal);
            if (json?.error) throw apiError(json.error);
            if (!Array.isArray(json?.content)) throw new LlmError("bad_response", "no reply");
            return json.content
              .flatMap((b) => (b.type === "text" ? [b.text] : []))
              .join("")
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
