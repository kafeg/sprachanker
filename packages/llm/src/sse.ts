// Streamed replies (server-sent events): the data lines of any provider's stream, and an
// OpenAI-compatible reply's text deltas and, at the end, its tool calls; control tokens some local
// models leak are dropped.
import { LlmError } from "./errors.ts";

/** A function the model called, as the endpoint sends it. */
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** Control tokens some local models leak into the text (Gemma: "<audio|>", others: "<|im_end|>"). */
export const SPECIAL_TOKEN = /<\|?[a-z_]+\|>/g;

/** The `data:` payloads of a server-sent event stream, in order, until the stream ends. */
export async function* sseData(
  res: Response,
  /** Stops reading: the time limit or the learner (whatever the fetch implementation does). */
  stop: AbortSignal,
  onData: () => void,
): AsyncGenerator<string> {
  if (!res.body) throw new LlmError("bad_response", "empty response");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const cancel = () => void reader.cancel().catch(() => {});
  stop.addEventListener("abort", cancel, { once: true });
  let buffer = "";
  try {
    while (true) {
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
        if (data) yield data;
      }
      if (done) break;
    }
  } finally {
    stop.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

/**
 * Text deltas and, at the end, the tool calls of an OpenAI-style server-sent event stream. A stream
 * that ends before `[DONE]` or a `finish_reason` broke off: `unreachable`, its tool calls never run.
 */
export async function* streamEvents(
  res: Response,
  stop: AbortSignal,
  onData: () => void,
): AsyncIterable<{ text?: string; toolCalls?: ToolCall[] }> {
  // Tool calls arrive in pieces, by index: id and name first, then the arguments. A server that sends
  // no index sends one call at a time: a delta with an id starts the next call.
  const calls: ToolCall[] = [];
  let ended = false;
  for await (const data of sseData(res, stop, onData)) {
    if (data === "[DONE]") {
      ended = true;
      break;
    }
    const chunk = parseChunk(data);
    if (chunk.error) throw new LlmError("bad_response", chunk.error);
    if (chunk.finished) ended = true;
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
  if (!ended) throw new LlmError("unreachable", "the reply broke off before its end");
  const complete = calls.filter((c) => c?.function.name);
  if (complete.length) yield { toolCalls: complete };
}

interface ToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

function parseChunk(data: string): {
  text?: string;
  toolCalls?: ToolCallDelta[];
  error?: string;
  /** The choice's `finish_reason` came: the reply is whole. */
  finished?: boolean;
} {
  try {
    const json = JSON.parse(data) as {
      choices?: Array<{
        delta?: { content?: unknown; tool_calls?: ToolCallDelta[] };
        finish_reason?: string | null;
      }>;
      error?: { message?: string };
    };
    if (json.error) return { error: json.error.message ?? "error" };
    const choice = json.choices?.[0];
    const delta = choice?.delta;
    return {
      text: typeof delta?.content === "string" ? delta.content : undefined,
      toolCalls: delta?.tool_calls,
      finished: !!choice?.finish_reason,
    };
  } catch {
    return {};
  }
}
