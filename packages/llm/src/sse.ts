// A streamed reply of an OpenAI-compatible endpoint (server-sent events): its text deltas and, at the
// end, its tool calls; control tokens some local models leak are dropped.
import { LlmError } from "./errors.ts";

/** A function the model called, as the endpoint sends it. */
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** Control tokens some local models leak into the text (Gemma: "<audio|>", others: "<|im_end|>"). */
export const SPECIAL_TOKEN = /<\|?[a-z_]+\|>/g;

/** Text deltas and, at the end, the tool calls of an OpenAI-style server-sent event stream. */
export async function* streamEvents(
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
