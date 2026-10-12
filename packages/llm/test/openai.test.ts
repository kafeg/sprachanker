// OpenAI's own API through the OpenAI-compatible client: what sets it apart.
import { describe, expect, spyOn, test } from "bun:test";
import { chatBody, REASONING_ROOM } from "../src/client.ts";
import type { LlmError } from "../src/errors.ts";
import { PROVIDERS, providerClient, providerRequest } from "../src/providers.ts";
import { bodies, collect, fakeFetch, sse } from "./fake-http.ts";

const openai = PROVIDERS.openai;
const endpoint = { baseUrl: openai.baseUrl, apiKey: "sk-test" };
const delta = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
const toolDelta = (part: unknown) =>
  `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [part] } }] })}\n\n`;
const refusal = (message: string) =>
  Response.json({ error: { message, type: "invalid_request_error" } }, { status: 400 });

describe("OpenAI", () => {
  test("lists chat models only: no Responses-only, realtime, audio, image or legacy models", async () => {
    const ids = [
      "gpt-5",
      "gpt-4.1-mini",
      "o3",
      "chatgpt-4o-latest",
      "gpt-5-pro",
      "o3-deep-research",
      "gpt-5-codex",
      "gpt-4o-realtime-preview",
      "gpt-4o-mini-transcribe",
      "gpt-4o-mini-tts",
      "gpt-4o-search-preview",
      "gpt-image-1",
      "dall-e-3",
      "davinci-002",
      "gpt-3.5-turbo-instruct",
      "omni-moderation-latest",
      "text-embedding-3-small",
      "whisper-1",
      "sora-2",
      "computer-use-preview",
      "o1",
      "o1-mini",
      "o1-preview-2024-09-12",
      "gpt-5.1-chat-latest",
    ];
    const { fn, calls } = fakeFetch(() =>
      Response.json({ data: ids.map((id) => ({ id, object: "model", owned_by: "openai" })) }),
    );
    const models = await providerClient(openai, endpoint, fn).models();
    expect(models.map((m) => m.id)).toEqual([
      "gpt-5",
      "gpt-4.1-mini",
      "o3",
      "chatgpt-4o-latest",
      "o1",
      "gpt-5.1-chat-latest",
    ]);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/models");
    expect((calls[0]?.init.headers as Record<string, string> | undefined)?.authorization).toBe(
      "Bearer sk-test",
    );
  });

  test("the body: max_completion_tokens; a reasoning model without temperature, with room to think and the least reasoning", () => {
    const request = {
      messages: [{ role: "user" as const, content: "hi" }],
      maxTokens: 800,
      reasoning: false,
    };
    const reasoner = chatBody({ ...request, model: "gpt-5-mini" }, openai);
    expect(reasoner).toMatchObject({
      max_completion_tokens: 800 + REASONING_ROOM,
      reasoning_effort: "minimal",
    });
    expect(reasoner).not.toHaveProperty("temperature");
    expect(reasoner).not.toHaveProperty("max_tokens");
    // A model that does not reason: its temperature, the task's limit, no switch.
    const plain = chatBody({ ...request, model: "gpt-4.1" }, openai);
    expect(plain).toMatchObject({ temperature: 0.3, max_completion_tokens: 800 });
    expect(plain).not.toHaveProperty("reasoning_effort");
    // The prompt viewer shows the same.
    expect(providerRequest(openai, openai.baseUrl, { ...request, model: "o4-mini" })).toMatchObject(
      {
        url: "https://api.openai.com/v1/chat/completions",
        body: { max_completion_tokens: 800 + REASONING_ROOM, reasoning_effort: "low" },
      },
    );
  });

  test.each([
    ["gpt-5", "minimal"],
    ["gpt-5-mini-2025-08-07", "minimal"],
    ["gpt-5-nano", "minimal"],
    ["gpt-5.1", "none"],
    ["gpt-5.2-2025-12-11", "none"],
    ["o1", "low"],
    ["o3", "low"],
    ["o4-mini", "low"],
  ])("the least reasoning of %s's family: %s, no temperature", (model, effort) => {
    const body = chatBody({ model, messages: [], reasoning: false }, openai);
    expect(body).toMatchObject({ reasoning_effort: effort });
    expect(body).not.toHaveProperty("temperature");
  });

  test.each(["gpt-5-chat-latest", "gpt-5.1-chat-latest", "gpt-4.1"])(
    "%s does not reason: a temperature, no effort",
    (model) => {
      const body = chatBody({ model, messages: [], reasoning: false, maxTokens: 100 }, openai);
      expect(body).toMatchObject({ temperature: 0.3, max_completion_tokens: 100 });
      expect(body).not.toHaveProperty("reasoning_effort");
    },
  );

  test("streams a reply with a tool round", async () => {
    const { fn, calls } = fakeFetch(() =>
      calls.length === 1
        ? sse([
            toolDelta({
              index: 0,
              id: "call_1",
              function: { name: "get_progress", arguments: "" },
            }),
            toolDelta({ index: 0, function: { arguments: "{}" } }),
            "data: [DONE]\n\n",
          ])
        : sse([delta("Lektion "), delta("3"), "data: [DONE]\n\n"]),
    );
    const ran: string[] = [];
    const text = await collect(
      providerClient(openai, endpoint, fn).chat({
        model: "gpt-5",
        messages: [
          { role: "system", content: "Tutor" },
          { role: "user", content: "Wo bin ich?" },
        ],
        maxTokens: 1500,
        reasoning: false,
        tools: [{ name: "get_progress", description: "d", parameters: { type: "object" } }],
        runTool: async (name) => {
          ran.push(name);
          return { lesson: 3 };
        },
      }),
    );
    expect([text, ran]).toEqual(["Lektion 3", ["get_progress"]]);
    const [first, second] = bodies(calls);
    expect(first).toMatchObject({
      stream: true,
      max_completion_tokens: 1500 + REASONING_ROOM,
      reasoning_effort: "minimal",
    });
    expect(first).not.toHaveProperty("temperature");
    expect((second?.messages as unknown[] | undefined)?.slice(-2)).toEqual([
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "get_progress", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: '{"lesson":3}' },
    ]);
  });

  test("a model that refuses the temperature is asked again without it, and later rounds go without", async () => {
    const { fn, calls } = fakeFetch((_, init) => {
      const body = JSON.parse(init.body as string);
      if ("temperature" in body)
        return refusal(
          "Unsupported value: 'temperature' does not support 0.3 with this model. Only the default (1) value is supported.",
        );
      return body.messages.length === 1
        ? sse([
            toolDelta({ index: 0, id: "c1", function: { name: "get_progress", arguments: "{}" } }),
            "data: [DONE]\n\n",
          ])
        : sse([delta("ok"), "data: [DONE]\n\n"]);
    });
    const text = await collect(
      providerClient(openai, endpoint, fn).chat({
        model: "gpt-6-preview",
        messages: [{ role: "user", content: "?" }],
        tools: [{ name: "get_progress", description: "d", parameters: { type: "object" } }],
        runTool: async () => ({}),
      }),
    );
    expect(text).toBe("ok");
    // Refused, asked again, then the second round straight without it; tools kept throughout.
    expect(bodies(calls).map((b) => ["temperature" in b, !!b.tools])).toEqual([
      [true, true],
      [false, true],
      [false, true],
    ]);
  });

  test("a refusal is refused; a reply cut at its limit keeps its text, never runs its calls, and is logged", async () => {
    const declined = await providerClient(
      openai,
      endpoint,
      fakeFetch(() =>
        Response.json({
          choices: [{ message: { content: null, refusal: "I can't help with that." } }],
        }),
      ).fn,
    )
      .complete({ model: "gpt-4.1", messages: [{ role: "user", content: "?" }] })
      .catch((e: LlmError) => e);
    expect((declined as LlmError).code).toBe("refused");
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const ran: unknown[] = [];
    const cut = await collect(
      providerClient(
        openai,
        endpoint,
        fakeFetch(() =>
          sse([
            delta("Ich schaue "),
            toolDelta({ index: 0, id: "c1", function: { name: "find", arguments: '{"wo' } }),
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] })}\n\n`,
            "data: [DONE]\n\n",
          ]),
        ).fn,
      ).chat({
        model: "gpt-4.1",
        messages: [{ role: "user", content: "?" }],
        tools: [{ name: "find", description: "d", parameters: { type: "object" } }],
        runTool: async () => ran.push(1),
      }),
    );
    expect([cut, ran]).toEqual(["Ich schaue ", []]);
    expect(String(warn.mock.calls[0]?.[0])).toContain("gpt-4.1's reply reached its token limit");
    warn.mockRestore();
  });

  test("a schema strict mode cannot take is sent again not strict, before going without", async () => {
    const { fn, calls } = fakeFetch((_, init) => {
      const body = JSON.parse(init.body as string);
      return body.response_format?.json_schema.strict
        ? refusal(
            "Invalid schema for response_format 'check': In context=(), 'required' is required to be supplied and to be an array including every key in properties. Missing 'note'.",
          )
        : Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
    });
    const reply = await providerClient(openai, endpoint, fn).complete({
      model: "gpt-4.1",
      messages: [{ role: "user", content: "?" }],
      jsonSchema: { name: "check", schema: { type: "object" } },
    });
    expect(reply).toBe('{"ok":true}');
    expect(
      bodies(calls).map(
        (b) => (b.response_format as { json_schema: { strict: boolean } })?.json_schema.strict,
      ),
    ).toEqual([true, false]);
  });
});
