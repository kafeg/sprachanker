// Structured task outputs (07): JSON requested with a schema, parsed and validated with zod, then the
// task's own check; an invalid reply gets one repair attempt with the problems listed, then the task
// fails with `invalid_output`. A valid reply short only of the task's quality is asked again once
// too, then kept.
import { issuesText } from "@sprachanker/schema";
import { z } from "zod";
import type { ChatMessage, LlmClient, TaskRequest } from "./client.ts";
import { LlmError } from "./errors.ts";

export interface StructuredTask<T> {
  request: TaskRequest;
  /** Schema name sent to the provider. */
  name: string;
  schema: z.ZodType<T>;
  /** What the schema cannot say ("the sentence does not use the word"); undefined when it holds. */
  check?(value: T): string | undefined;
  /** What makes a valid reply a better one ("not the question of the last line again"): a reply short
   *  of it is asked again once, then the last valid one is kept (logged); undefined when it holds. */
  quality?(value: T): string | undefined;
}

/** The JSON Schema of a zod schema, as providers take it. */
function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

/** JSON from a reply that may wrap it in a Markdown fence or add a sentence around it. */
function parseJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return unescapedQuotes(JSON.parse(candidate));
}

/** A value with every string's escaped quote (`\"`) made a plain one, and its escaped line breaks
 *  (`\n`) real ones where it has no real one: a model writing through a tool call (Claude Code's
 *  structured output) sometimes escapes them twice, and the learner would see the backslash. */
export function unescapedQuotes(value: unknown): unknown {
  if (typeof value === "string") {
    const quotes = value.replaceAll('\\"', '"');
    return quotes.includes("\n") ? quotes : quotes.replaceAll("\\n", "\n");
  }
  if (Array.isArray(value)) return value.map(unescapedQuotes);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unescapedQuotes(v)]));
  return value;
}

/** The task's request with its schema attached (also what the prompt viewer shows). */
export const structuredRequest = <T>(task: StructuredTask<T>): TaskRequest => ({
  ...task.request,
  jsonSchema: { name: task.name, schema: jsonSchemaOf(task.schema) },
});

export async function runStructured<T>(
  client: LlmClient,
  model: string,
  task: StructuredTask<T>,
  signal?: AbortSignal,
): Promise<T> {
  const request = structuredRequest(task);
  let messages: ChatMessage[] = request.messages;
  let problem = "";
  let kept: { value: T; short: string } | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await client.complete({ ...request, messages, model, signal });
    try {
      const result = task.schema.safeParse(parseJson(reply));
      const unmet = result.success ? task.check?.(result.data) : undefined;
      const short = result.success && !unmet ? task.quality?.(result.data) : undefined;
      if (result.success && !unmet && !short) return result.data;
      if (result.success && short) kept = { value: result.data, short };
      problem = result.success ? ((unmet ?? short) as string) : issuesText(result.error, 5);
    } catch {
      problem = "the reply was not valid JSON";
    }
    messages = [
      ...request.messages,
      { role: "assistant", content: reply },
      {
        role: "user",
        content: `Your reply did not meet the requirements (${problem}). Reply again with only the JSON object.`,
      },
    ];
  }
  if (kept) {
    console.warn(`${task.name}: ${model}'s reply kept short of its quality (${kept.short})`);
    return kept.value;
  }
  throw new LlmError("invalid_output", problem);
}
