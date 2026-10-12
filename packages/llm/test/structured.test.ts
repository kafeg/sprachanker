import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { type ChatRequest, type LlmClient, openAiCompatible } from "../src/client.ts";
import { LlmError } from "../src/errors.ts";
import { runStructured, structuredRequest } from "../src/structured.ts";

const Verdict = z.object({ ok: z.boolean(), note: z.string() });
const task = {
  name: "verdict",
  schema: Verdict,
  request: { messages: [{ role: "user" as const, content: "check" }], reasoning: false },
};

/** A client that replies with the given texts in turn, recording requests. */
function scripted(replies: string[]) {
  const seen: ChatRequest[] = [];
  const client: LlmClient = {
    models: async () => [],
    chat: () => (async function* () {})(),
    complete: async (request) => {
      seen.push(request);
      return replies.shift() ?? "";
    },
  };
  return { client, seen };
}

describe("structured outputs", () => {
  test("the schema goes with the request as JSON Schema", () => {
    const request = structuredRequest(task);
    expect(request.jsonSchema?.name).toBe("verdict");
    expect(request.jsonSchema?.schema).toMatchObject({
      type: "object",
      required: ["ok", "note"],
      additionalProperties: false,
    });
    expect(request.jsonSchema?.schema.$schema).toBeUndefined();
  });

  test("valid JSON, also inside a fence or with words around it", async () => {
    for (const reply of [
      '{"ok":true,"note":"x"}',
      '```json\n{"ok":true,"note":"x"}\n```',
      'Here: {"ok":true,"note":"x"} done',
    ]) {
      expect(await runStructured(scripted([reply]).client, "m", task)).toEqual({
        ok: true,
        note: "x",
      });
    }
  });

  test("a quote escaped twice (Claude Code's structured output) reads as a plain one", async () => {
    // As the CLI gives it: the string holds a backslash before each quote once parsed.
    const reply = JSON.stringify({ ok: true, note: 'nicht \\"damit\\", sondern \\"der\\"' });
    expect(await runStructured(scripted([reply]).client, "m", task)).toEqual({
      ok: true,
      note: 'nicht "damit", sondern "der"',
    });
  });

  test("one repair attempt with the problems listed, then invalid_output", async () => {
    const fixed = scripted(['{"ok":"yes"}', '{"ok":true,"note":"x"}']);
    expect(await runStructured(fixed.client, "m", task)).toEqual({ ok: true, note: "x" });
    expect(fixed.seen[1]?.messages.at(-1)?.content).toContain("ok: Invalid input");

    const broken = scripted(["no json", "still none"]);
    const error = await runStructured(broken.client, "m", task).catch((e) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).code).toBe("invalid_output");
  });

  test("the task's own check: an unmet one is a problem to repair like a schema's", async () => {
    const checked = {
      ...task,
      check: (v: z.infer<typeof Verdict>) => (v.note ? undefined : "note is empty"),
    };
    const fixed = scripted(['{"ok":true,"note":""}', '{"ok":true,"note":"x"}']);
    expect(await runStructured(fixed.client, "m", checked)).toEqual({ ok: true, note: "x" });
    expect(fixed.seen[1]?.messages.at(-1)?.content).toContain("note is empty");
    const never = scripted(['{"ok":true,"note":""}', '{"ok":true,"note":""}']);
    const error: unknown = await runStructured(never.client, "m", checked).catch((e) => e);
    expect((error as LlmError).code).toBe("invalid_output");
  });

  test("complete(): non-streamed, with response_format; a server rejecting the schema is asked without it", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchFn = (async (_: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      bodies.push(body);
      if (body.response_format)
        return Response.json(
          { error: { message: "response_format is not supported" } },
          { status: 400 },
        );
      return Response.json({
        choices: [{ message: { content: '<think>x</think>{"ok":true,"note":"n"}' } }],
      });
    }) as unknown as typeof fetch;
    const client = openAiCompatible({ baseUrl: "http://h/v1" }, fetchFn);
    expect(await runStructured(client, "m", task)).toEqual({ ok: true, note: "n" });
    expect(bodies[0]).toMatchObject({ stream: false, response_format: { type: "json_schema" } });
    expect(bodies.at(-1)?.response_format).toBeUndefined();
  });
});
