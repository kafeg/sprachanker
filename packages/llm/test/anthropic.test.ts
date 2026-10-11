// Anthropic's Messages API (07, "Providers") against a fake server: no request leaves the test.
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { anthropicMessages } from "../src/anthropic.ts";
import { REASONING_ROOM } from "../src/client.ts";
import { LlmError } from "../src/errors.ts";
import { PROVIDERS, providerClient, providerRequest } from "../src/providers.ts";
import { runStructured } from "../src/structured.ts";
import { bodies, collect, fakeFetch, sse } from "./fake-http.ts";

const preset = PROVIDERS.anthropic;
const endpoint = { baseUrl: preset.baseUrl, apiKey: "sk-ant-test" };
const client = (respond: Parameters<typeof fakeFetch>[0]) => {
  const fake = fakeFetch(respond);
  return { ...fake, client: providerClient(preset, endpoint, fake.fn) };
};

/** A server-sent event as Anthropic writes it: its name, then its data. */
const event = (data: Record<string, unknown>) =>
  `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`;
const start = { type: "message_start", message: { id: "msg_1", role: "assistant", content: [] } };
const end = (stop_reason: string) => [
  event({ type: "message_delta", delta: { stop_reason }, usage: { output_tokens: 9 } }),
  event({ type: "message_stop" }),
];
const textBlock = (index: number, ...parts: string[]) => [
  event({ type: "content_block_start", index, content_block: { type: "text", text: "" } }),
  ...parts.map((text) =>
    event({ type: "content_block_delta", index, delta: { type: "text_delta", text } }),
  ),
  event({ type: "content_block_stop", index }),
];
const toolBlock = (index: number, id: string, name: string, ...json: string[]) => [
  event({
    type: "content_block_start",
    index,
    content_block: { type: "tool_use", id, name, input: {} },
  }),
  ...json.map((partial_json) =>
    event({
      type: "content_block_delta",
      index,
      delta: { type: "input_json_delta", partial_json },
    }),
  ),
  event({ type: "content_block_stop", index }),
];
const reply = (...blocks: string[][]) => sse([event(start), ...blocks.flat()]);
const TOOLS = [
  { name: "get_progress", description: "The learner's progress", parameters: { type: "object" } },
];

describe("Anthropic", () => {
  test("streams text: the key and version headers, the system prompt apart, effort low where the model takes it", async () => {
    const { client: c, calls } = client(() =>
      reply(
        [event({ type: "ping" })],
        textBlock(0, "Weil ", "»Frau« ", "weiblich ist."),
        end("end_turn"),
      ),
    );
    const text = await collect(
      c.chat({
        model: "claude-sonnet-5-5",
        messages: [
          { role: "system", content: "Explain briefly." },
          { role: "user", content: "Warum die?" },
        ],
        maxTokens: 1200,
        reasoning: false,
      }),
    );
    expect(text).toBe("Weil »Frau« weiblich ist.");
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect([headers["x-api-key"], headers["anthropic-version"], headers.authorization]).toEqual([
      "sk-ant-test",
      "2023-06-01",
      undefined,
    ]);
    expect(bodies(calls)[0]).toEqual({
      model: "claude-sonnet-5-5",
      max_tokens: 1200 + REASONING_ROOM,
      system: "Explain briefly.",
      messages: [{ role: "user", content: [{ type: "text", text: "Warum die?" }] }],
      stream: true,
      output_config: { effort: "low" },
    });
  });

  test("an older model gets no effort and no room; one refusing the effort is asked again without it", async () => {
    const { client: c, calls } = client((_, init) =>
      JSON.parse(init.body as string).output_config
        ? Response.json(
            {
              type: "error",
              error: {
                type: "invalid_request_error",
                message: "output_config.effort: not supported",
              },
            },
            { status: 400 },
          )
        : reply(textBlock(0, "ok"), end("end_turn")),
    );
    const ask = (model: string) =>
      collect(
        c.chat({
          model,
          messages: [{ role: "user", content: "?" }],
          reasoning: false,
          maxTokens: 500,
        }),
      );
    expect(await ask("claude-haiku-4-5-20251001")).toBe("ok");
    expect(bodies(calls)[0]).not.toHaveProperty("output_config");
    expect(bodies(calls)[0]?.max_tokens).toBe(500);
    expect(await ask("claude-opus-4-5")).toBe("ok");
    expect(
      bodies(calls)
        .slice(1)
        .map((b) => !!b.output_config),
    ).toEqual([true, false]);
  });

  test("tool use: the call assembled from its JSON pieces, run, and answered with the turn's blocks and a tool_result", async () => {
    const { client: c, calls } = client(() =>
      calls.length === 1
        ? reply(
            [
              event({
                type: "content_block_start",
                index: 0,
                content_block: { type: "thinking", thinking: "", signature: "" },
              }),
              event({
                type: "content_block_delta",
                index: 0,
                delta: { type: "thinking_delta", thinking: "Check." },
              }),
              event({
                type: "content_block_delta",
                index: 0,
                delta: { type: "signature_delta", signature: "sig==" },
              }),
              event({ type: "content_block_stop", index: 0 }),
            ],
            textBlock(1, "Ich schaue nach. "),
            toolBlock(2, "toolu_1", "get_progress", '{"less', 'on": "0.2"}'),
            end("tool_use"),
          )
        : reply(textBlock(0, "Du bist in Lektion 0.2."), end("end_turn")),
    );
    const ran: unknown[] = [];
    const text = await collect(
      c.chat({
        model: "claude-sonnet-4-5",
        messages: [
          { role: "system", content: "Tutor" },
          { role: "user", content: "Wo bin ich?" },
        ],
        tools: TOOLS,
        toolNotes: ["Call tools for the learner's data."],
        runTool: async (name, args) => {
          ran.push([name, args]);
          return { lesson: "0.2" };
        },
      }),
    );
    expect(text).toBe("Ich schaue nach. Du bist in Lektion 0.2.");
    expect(ran).toEqual([["get_progress", { lesson: "0.2" }]]);
    const [first, second] = bodies(calls);
    expect(first?.system).toBe("Tutor\n\nCall tools for the learner's data.");
    expect(first?.tools).toEqual([
      {
        name: "get_progress",
        description: "The learner's progress",
        input_schema: { type: "object" },
      },
    ]);
    expect(first).not.toHaveProperty("tool_choice");
    expect(second?.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Wo bin ich?" }] },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Check.", signature: "sig==" },
          { type: "text", text: "Ich schaue nach. " },
          { type: "tool_use", id: "toolu_1", name: "get_progress", input: { lesson: "0.2" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"lesson":"0.2"}' }],
      },
    ]);
  });

  test("a model that keeps calling tools: told to answer with the last results, then asked without tools (still named)", async () => {
    const { client: c, calls } = client((_, init) => {
      const body = JSON.parse(init.body as string);
      return body.tool_choice
        ? reply(textBlock(0, "Fertig."), end("end_turn"))
        : reply(toolBlock(0, `toolu_${calls.length}`, "get_progress", "{}"), end("tool_use"));
    });
    const text = await collect(
      c.chat({
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: "?" }],
        tools: TOOLS,
        runTool: async () => ({ done: 1 }),
      }),
    );
    expect(text).toBe("Fertig.");
    const sent = bodies(calls);
    expect(sent).toHaveLength(4);
    expect(sent[3]?.tool_choice).toEqual({ type: "none" });
    expect(sent[3]?.tools).toHaveLength(1);
    // The note rides in the learner's turn with the tool results: turns still alternate.
    const last = (
      (sent[3]?.messages ?? []) as Array<{ role: string; content: Array<{ type: string }> }>
    ).at(-1);
    expect(last?.role).toBe("user");
    expect(last?.content.map((b) => b.type)).toEqual(["tool_result", "text"]);
  });

  test("structured output: the schema in the system prompt, read whole, one repair", async () => {
    const replies = ['Sure: {"verdict": 3}', '{"verdict": "good"}'];
    const { client: c, calls } = client(() =>
      Response.json({
        type: "message",
        role: "assistant",
        content: [
          { type: "thinking", thinking: "", signature: "s" },
          { type: "text", text: replies[calls.length - 1] },
        ],
        stop_reason: "end_turn",
      }),
    );
    const result = await runStructured(c, "claude-opus-4-8", {
      name: "check",
      schema: z.object({ verdict: z.enum(["good", "bad"]) }),
      request: {
        messages: [
          { role: "system", content: "Check it. Reply with the JSON object only." },
          { role: "user", content: "<text>Hallo</text>" },
        ],
        maxTokens: 1000,
        reasoning: false,
      },
    });
    expect(result).toEqual({ verdict: "good" });
    const [first, second] = bodies(calls);
    expect(first?.stream).toBe(false);
    expect(first?.system).toContain("matching this JSON Schema");
    expect(first?.system).toContain('"verdict"');
    expect(first?.output_config).toEqual({ effort: "low" });
    expect(((second?.messages ?? []) as Array<{ role: string }>).map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
  });

  test("models: every page read by its last id; names and context told", async () => {
    const { client: c, calls } = client((url) =>
      url.includes("after_id")
        ? Response.json({
            data: [{ type: "model", id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5" }],
            has_more: false,
            last_id: "claude-haiku-4-5",
          })
        : Response.json({
            data: [
              {
                type: "model",
                id: "claude-opus-5-5",
                display_name: "Claude Opus 5.5",
                max_input_tokens: 1_000_000,
              },
            ],
            has_more: true,
            last_id: "claude-opus-5-5",
          }),
    );
    expect(await c.models()).toEqual([
      { id: "claude-opus-5-5", name: "Claude Opus 5.5", contextLength: 1_000_000, tools: true },
      { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", tools: true },
    ]);
    expect(calls.map((x) => x.url)).toEqual([
      "https://api.anthropic.com/v1/models?limit=1000",
      "https://api.anthropic.com/v1/models?limit=1000&after_id=claude-opus-5-5",
    ]);
  });

  test("errors: key, rate limit with its wait, overloaded, a bad request, an unknown model; an error in the stream", async () => {
    const failure = async (respond: () => Response) => {
      const error = await client(respond)
        .client.models()
        .catch((e: LlmError) => e);
      return error instanceof LlmError ? [error.code, error.retryAfter] : error;
    };
    const apiError = (status: number, type: string, headers?: Record<string, string>) => () =>
      Response.json({ type: "error", error: { type, message: type } }, { status, headers });
    expect(await failure(apiError(401, "authentication_error"))).toEqual([
      "unauthorized",
      undefined,
    ]);
    expect(await failure(apiError(403, "permission_error"))).toEqual(["unauthorized", undefined]);
    expect(await failure(apiError(429, "rate_limit_error", { "retry-after": "7" }))).toEqual([
      "rate_limited",
      7,
    ]);
    expect(await failure(apiError(529, "overloaded_error"))).toEqual(["overloaded", undefined]);
    expect(await failure(apiError(400, "invalid_request_error"))).toEqual([
      "bad_response",
      undefined,
    ]);
    expect(await failure(apiError(404, "not_found_error"))).toEqual(["model_not_found", undefined]);
    const { client: c } = client(() =>
      reply(textBlock(0, "Weil"), [
        event({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }),
      ]),
    );
    const streamed = await collect(
      c.chat({ model: "claude-haiku-4-5", messages: [{ role: "user", content: "?" }] }),
    ).catch((e: LlmError) => e);
    expect((streamed as LlmError).code).toBe("overloaded");
  });

  test("the chat in its shape: system apart, same roles merged, the learner first and last", () => {
    expect(
      anthropicMessages([
        { role: "system", content: "Rules" },
        { role: "assistant", content: "Hallo! Ich bin Anna." },
        { role: "user", content: "Hallo" },
        { role: "user", content: "Wie geht's?" },
        { role: "assistant", content: "Gut." },
        { role: "system", content: "More rules" },
        { role: "assistant", content: "" },
      ]),
    ).toEqual({
      system: "Rules\n\nMore rules",
      messages: [
        { role: "user", content: [{ type: "text", text: "(begin)" }] },
        { role: "assistant", content: [{ type: "text", text: "Hallo! Ich bin Anna." }] },
        {
          role: "user",
          content: [
            { type: "text", text: "Hallo" },
            { type: "text", text: "Wie geht's?" },
          ],
        },
        { role: "assistant", content: [{ type: "text", text: "Gut." }] },
        { role: "user", content: [{ type: "text", text: "(go on)" }] },
      ],
    });
  });

  test("the prompt viewer: the messages endpoint, the system prompt as the first message", () => {
    const preview = providerRequest(preset, preset.baseUrl, {
      model: "claude-sonnet-5-5",
      messages: [
        { role: "system", content: "Rules" },
        { role: "user", content: "Hi" },
      ],
      maxTokens: 800,
      reasoning: false,
    });
    expect(preview).toEqual({
      url: "https://api.anthropic.com/v1/messages",
      body: {
        model: "claude-sonnet-5-5",
        max_tokens: 800 + REASONING_ROOM,
        stream: true,
        output_config: { effort: "low" },
        messages: [
          { role: "system", content: "Rules" },
          { role: "user", content: "Hi" },
        ],
      },
    });
  });
});
