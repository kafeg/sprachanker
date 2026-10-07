// Structured task outputs (07): JSON requested with a schema, parsed and validated with zod, then the
// task's own check; an invalid reply gets one repair attempt with the problems listed, then the task
// fails with `invalid_output`.
import { issuesText } from "@sprachanker/schema";
import { z } from "zod";
import { type ChatMessage, type LlmClient, LlmError, type TaskRequest } from "./client.ts";

export interface StructuredTask<T> {
  request: TaskRequest;
  /** Schema name sent to the provider. */
  name: string;
  schema: z.ZodType<T>;
  /** What the schema cannot say ("the sentence does not use the word"); undefined when it holds. */
  check?(value: T): string | undefined;
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
  return JSON.parse(candidate);
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
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await client.complete({ ...request, messages, model, signal });
    try {
      const result = task.schema.safeParse(parseJson(reply));
      const unmet = result.success ? task.check?.(result.data) : undefined;
      if (result.success && !unmet) return result.data;
      problem = result.success ? (unmet as string) : issuesText(result.error, 5);
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
  throw new LlmError("invalid_output", problem);
}
