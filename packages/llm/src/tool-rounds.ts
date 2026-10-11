// A streamed answer with the tutor's tools (07, "Tools"), whichever API the provider speaks: the
// model may call tools, read their results, then answer — a few rounds at most, the last without
// tools. The API's own message shapes stay in its dialect.
import { type Limits, readFailure, TimeLimit } from "./http.ts";
import type { ToolCall } from "./sse.ts";

/** Tool rounds per answer; the last round has no tools, so the model must answer. */
const MAX_TOOL_ROUNDS = 4;
const ANSWER_NOW = "Answer the learner now with the information you have; no more tools.";

/** What one round of a streamed reply brings: text, and at the end the calls it made. */
export interface RoundEvent {
  text?: string;
  toolCalls?: ToolCall[];
  /** The API's own record of the reply (Anthropic: its content blocks), sent back with the results. */
  turn?: unknown;
}

/** A model's reply in one round. */
export interface Round {
  text: string;
  calls: ToolCall[];
  turn?: unknown;
}

/** A tool's answer to a call, as JSON. */
export interface ToolResult {
  call: ToolCall;
  content: string;
  /** The tool failed: it threw, or answered `{ error }` alone. */
  failed: boolean;
}

const failed = (result: unknown) =>
  !!result &&
  typeof result === "object" &&
  Object.keys(result).length === 1 &&
  typeof (result as { error?: unknown }).error === "string";

/** How one API holds a conversation with tools, in its own messages `M`. */
export interface RoundDialect<M> {
  messages: M[];
  /** Opens a round's stream: with the tools or without; says whether the tools went (a server may
   *  refuse them). */
  open(messages: M[], tools: boolean, limit: TimeLimit): Promise<{ res: Response; tools: boolean }>;
  events(res: Response, stop: AbortSignal, onData: () => void): AsyncIterable<RoundEvent>;
  /** The conversation after a round whose calls were answered, `note` added for the model. */
  answered(messages: M[], round: Round, results: ToolResult[], note?: string): M[];
  /** The conversation with a learner's line added. */
  say(messages: M[], text: string): M[];
}

/** What of a chat request the rounds read (client.ts's ChatRequest). */
interface RoundsRequest {
  tools?: unknown[];
  runTool?: (name: string, args: unknown) => Promise<unknown>;
  signal?: AbortSignal;
}

export async function* toolRounds<M>(
  request: RoundsRequest,
  dialect: RoundDialect<M>,
  limits: Limits,
  /** Where the requests go, for errors. */
  base: string,
): AsyncGenerator<string> {
  let messages = dialect.messages;
  let tools = !!request.tools?.length && !!request.runTool;
  for (let n = 0; n < MAX_TOOL_ROUNDS; n++) {
    const last = n === MAX_TOOL_ROUNDS - 1;
    const limit = new TimeLimit(limits.firstMs);
    const round: Round = { text: "", calls: [] };
    try {
      const opened = await dialect.open(messages, tools && !last, limit);
      tools = opened.tools;
      const stop = request.signal ? AbortSignal.any([request.signal, limit.signal]) : limit.signal;
      for await (const event of dialect.events(opened.res, stop, () =>
        limit.extend(limits.idleMs),
      )) {
        if (event.text) {
          round.text += event.text;
          yield event.text;
        }
        if (event.toolCalls) round.calls.push(...event.toolCalls);
        if (event.turn !== undefined) round.turn = event.turn;
      }
    } catch (error) {
      throw readFailure(error, base, limit, request.signal);
    } finally {
      limit.clear();
    }
    if (round.text.trim() && (!round.calls.length || last)) return;
    if (!round.calls.length || !request.runTool || last) {
      if (n > 0 && !last) {
        // Tool results came back but no answer: ask for it once more, without tools.
        messages = dialect.say(messages, ANSWER_NOW);
        n = MAX_TOOL_ROUNDS - 2;
        continue;
      }
      return;
    }
    const results: ToolResult[] = [];
    for (const call of round.calls) {
      let args: unknown = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {}
      const result = await request
        .runTool(call.function.name, args)
        .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
      results.push({ call, content: JSON.stringify(result), failed: failed(result) });
    }
    // The next round is the last one, without tools: say so, or some models stay silent.
    messages = dialect.answered(
      messages,
      round,
      results,
      n === MAX_TOOL_ROUNDS - 2 ? ANSWER_NOW : undefined,
    );
  }
}
