import { describe, expect, test } from "bun:test";
import {
  type ChatMessage,
  type ChatRequest,
  chatBody,
  LlmError,
  openAiCompatible,
} from "../src/client.ts";
import { stripThinking } from "../src/thinking.ts";

/** A fake OpenAI-compatible server: records requests and answers with the given response. */
function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond(url, init);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const sse = (chunks: string[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
const delta = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

async function collect(stream: AsyncIterable<string>) {
  let out = "";
  for await (const chunk of stream) out += chunk;
  return out;
}

async function* chunks(...parts: string[]) {
  yield* parts;
}

describe("openAiCompatible", () => {
  test("lists chat models with the key, without embedding models", async () => {
    const { fn, calls } = fakeFetch(() =>
      Response.json({
        data: [{ id: "qwen3-8b" }, { id: "text-embedding-nomic" }, { id: "x/y", name: "Y" }],
      }),
    );
    const client = openAiCompatible({ baseUrl: "http://h/v1/", apiKey: "k" }, fn);
    expect(await client.models()).toEqual([
      { id: "qwen3-8b" },
      { id: "x/y", name: "Y", publisher: "x" },
    ]);
    expect(calls[0]?.url).toBe("http://h/v1/models");
    const headers = calls[0]?.init.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBe("Bearer k");
  });

  test("streams deltas split across network chunks and stops at [DONE]", async () => {
    const body = `${delta("Hal")}${delta("<audio|>lo<|im_end|> ")}data: [DONE]\n\n${delta("ignored")}`;
    const { fn, calls } = fakeFetch(() =>
      sse([body.slice(0, 20), body.slice(20, 50), body.slice(50)]),
    );
    const client = openAiCompatible({ baseUrl: "http://h/v1" }, fn);
    const text = await collect(
      client.chat({ model: "m", messages: [{ role: "user", content: "hi" }] }),
    );
    expect(text).toBe("Hallo ");
    const sent = JSON.parse(calls[0]?.init.body as string);
    expect(sent).toMatchObject({ model: "m", stream: true });
    const headers = calls[0]?.init.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBeUndefined();
  });

  test("maps failures to error codes", async () => {
    const code = async (respond: () => Response | Promise<Response>) => {
      const client = openAiCompatible({ baseUrl: "http://h" }, fakeFetch(respond).fn);
      try {
        await client.models();
      } catch (error) {
        return error instanceof LlmError ? error.code : "other";
      }
    };
    expect(await code(() => Promise.reject(new TypeError("refused")))).toBe("unreachable");
    expect(
      await code(() => Response.json({ error: { message: "bad key" } }, { status: 401 })),
    ).toBe("unauthorized");
    expect(await code(() => new Response("nope", { status: 500 }))).toBe("bad_response");
    expect(await code(() => Response.json({}))).toBe("bad_response");
  });

  test("an error inside the stream is raised", async () => {
    const client = openAiCompatible(
      { baseUrl: "http://h" },
      fakeFetch(() => sse([`data: {"error":{"message":"model unloaded"}}\n\n`])).fn,
    );
    await expect(collect(client.chat({ model: "m", messages: [] }))).rejects.toThrow(
      "model unloaded",
    );
  });
});

describe("failures while a reply is read", () => {
  /** A stream that sends `first`, then waits `pause` ms before the rest (or errors, or hangs). */
  const slow = (first: string, then: "rest" | "break" | "hang", pause = 30) =>
    new Response(
      new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode(first));
          if (then === "hang") return;
          await new Promise((r) => setTimeout(r, pause));
          if (then === "break") return controller.error(new TypeError("socket closed"));
          controller.enqueue(enc.encode(`${delta(" mehr")}data: [DONE]\n\n`));
          controller.close();
        },
      }),
    );
  const chat = (res: () => Response, limits = { firstMs: 1000, idleMs: 100 }) =>
    collect(
      openAiCompatible({ baseUrl: "http://x/v1" }, fakeFetch(res).fn, limits).chat({
        model: "m",
        messages: [],
      }),
    );

  test("a slow model is not cut off while it keeps writing: the limit runs between chunks", async () => {
    // 150 ms in all, never 100 ms of silence.
    expect(await chat(() => slow(delta("Erst"), "rest", 60), { firstMs: 100, idleMs: 100 })).toBe(
      "Erst mehr",
    );
  });

  test("silence mid-reply is a timeout; a dropped connection is unreachable", async () => {
    const code = (p: Promise<unknown>) => p.catch((e: LlmError) => e.code);
    expect(await code(chat(() => slow(delta("Erst"), "hang")))).toBe("timeout");
    expect(await code(chat(() => slow(delta("Erst"), "break")))).toBe("unreachable");
  });

  test("a busy server (429, 5xx) is not asked again without tools or the switch", async () => {
    const { fn, calls } = fakeFetch(() => new Response("busy", { status: 429 }));
    const client = openAiCompatible({ baseUrl: "http://x/v1", noReasoning: { think: false } }, fn);
    const error = await collect(client.chat({ model: "m", messages: [], reasoning: false })).catch(
      (e: LlmError) => e,
    );
    expect([(error as LlmError).code, (error as LlmError).status, calls.length]).toEqual([
      "bad_response",
      429,
      1,
    ]);
  });

  test("tool calls without an index; the last line without a newline", async () => {
    const call = (id: string | undefined, name: string, args: string) =>
      `data: ${JSON.stringify({
        choices: [
          { delta: { tool_calls: [{ ...(id && { id }), function: { name, arguments: args } }] } },
        ],
      })}\n\n`;
    let round = 0;
    const ran: string[] = [];
    const out = await collect(
      openAiCompatible(
        { baseUrl: "http://x/v1" },
        fakeFetch(() =>
          round++ === 0
            ? sse([
                call("c1", "progress", ""),
                call(undefined, "", "{}"),
                call("c2", "mistakes", "{}"),
              ])
            : sse([`data: ${JSON.stringify({ choices: [{ delta: { content: "Fertig" } }] })}`]),
        ).fn,
      ).chat({
        model: "m",
        messages: [],
        tools: [
          { name: "progress", description: "", parameters: {} },
          { name: "mistakes", description: "", parameters: {} },
        ],
        runTool: async (name) => {
          ran.push(name);
          return {};
        },
      }),
    );
    expect([ran, out]).toEqual([["progress", "mistakes"], "Fertig"]);
  });
});

describe("stripThinking", () => {
  test.each([
    [["<think>hmm</think>\n\nAnswer"], "Answer"],
    [["<thi", "nk>a</th", "ink>B", "<", "c"], "B<c"],
    [["Plain ", "text"], "Plain text"],
    [["<think>never closed"], ""],
    [["a <b> c"], "a <b> c"],
  ])("%j → %j", async (parts, expected) => {
    expect(await collect(stripThinking(chunks(...parts)))).toBe(expected);
  });
});

describe("reasoning switch", () => {
  const request: ChatRequest = { model: "m", messages: [], reasoning: false };
  test("sends the provider's fields to turn reasoning off", async () => {
    const { fn, calls } = fakeFetch(() => sse([delta("ok"), "data: [DONE]\n\n"]));
    const client = openAiCompatible(
      { baseUrl: "http://h", noReasoning: { reasoning_effort: "none" } },
      fn,
    );
    expect(await collect(client.chat(request))).toBe("ok");
    expect(JSON.parse(calls[0]?.init.body as string).reasoning_effort).toBe("none");
  });

  test("a model that rejects the switch is asked again without it", async () => {
    const { fn, calls } = fakeFetch((_, init) =>
      JSON.parse(init.body as string).reasoning
        ? Response.json({ error: { message: "reasoning is mandatory" } }, { status: 400 })
        : sse([delta("ok")]),
    );
    const client = openAiCompatible(
      { baseUrl: "http://h", noReasoning: { reasoning: { enabled: false } } },
      fn,
    );
    expect(await collect(client.chat(request))).toBe("ok");
    expect(calls).toHaveLength(2);
  });
});

test("chatBody: the posted JSON, with the provider's reasoning switch only when asked", () => {
  const request = {
    model: "m",
    messages: [{ role: "user" as const, content: "hi" }],
    maxTokens: 9,
  };
  expect(chatBody(request, { reasoning_effort: "none" })).toEqual({
    model: "m",
    messages: [{ role: "user", content: "hi" }],
    temperature: 0.3,
    max_tokens: 9,
    stream: true,
  });
  expect(chatBody({ ...request, reasoning: false }, { reasoning_effort: "none" })).toMatchObject({
    reasoning_effort: "none",
  });
});

test("tools: calls are assembled from the stream, run, and answered in a second round", async () => {
  const bodies: Array<{ messages: ChatMessage[]; tools?: unknown[] }> = [];
  const toolDelta = (part: unknown) =>
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [part] } }] })}\n\n`;
  const fetchFn = (async (_: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    bodies.push(body);
    if (bodies.length === 1)
      return sse([
        toolDelta({ index: 0, id: "c1", function: { name: "find_word", arguments: "" } }),
        toolDelta({ index: 0, function: { arguments: '{"word":' } }),
        toolDelta({ index: 0, function: { arguments: '"Taxi"}' } }),
        "data: [DONE]\n\n",
      ]);
    return sse([delta("Lektion 0.2"), "data: [DONE]\n\n"]);
  }) as unknown as typeof fetch;
  const ran: unknown[] = [];
  const client = openAiCompatible({ baseUrl: "http://h" }, fetchFn);
  const text = await collect(
    client.chat({
      model: "m",
      messages: [{ role: "user", content: "Wo war Taxi?" }],
      tools: [{ name: "find_word", description: "d", parameters: { type: "object" } }],
      runTool: async (name, args) => {
        ran.push([name, args]);
        return [{ lesson: "0.2" }];
      },
    }),
  );
  expect(text).toBe("Lektion 0.2");
  expect(ran).toEqual([["find_word", { word: "Taxi" }]]);
  expect(bodies[0]?.tools).toHaveLength(1);
  expect(bodies[1]?.messages.slice(-2)).toEqual([
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "c1",
          type: "function",
          function: { name: "find_word", arguments: '{"word":"Taxi"}' },
        },
      ],
    },
    { role: "tool", tool_call_id: "c1", content: '[{"lesson":"0.2"}]' },
  ]);
});

test("tools: a model that keeps calling tools is told to answer and does", async () => {
  const bodies: Array<{ messages: ChatMessage[]; tools?: unknown[] }> = [];
  const call = (n: number) =>
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${n}`, function: { name: "get_progress", arguments: "{}" } }] } }] })}\n\ndata: [DONE]\n\n`;
  const fetchFn = (async (_: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    bodies.push(body);
    return sse([body.tools ? call(bodies.length) : `${delta("Fertig.")}data: [DONE]\n\n`]);
  }) as unknown as typeof fetch;
  const client = openAiCompatible({ baseUrl: "http://h" }, fetchFn);
  const text = await collect(
    client.chat({
      model: "m",
      messages: [{ role: "user", content: "?" }],
      tools: [{ name: "get_progress", description: "d", parameters: { type: "object" } }],
      runTool: async () => ({ done: 1 }),
    }),
  );
  expect(text).toBe("Fertig.");
  expect(bodies).toHaveLength(4);
  expect(bodies[3]?.tools).toBeUndefined();
  expect(bodies[3]?.messages.at(-1)?.content).toContain("Answer the learner now");
});
