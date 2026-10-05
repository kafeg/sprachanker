import { describe, expect, test } from "bun:test";
import { type ChatRequest, LlmError, openAiCompatible } from "../src/client.ts";
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
    expect(await client.models()).toEqual([{ id: "qwen3-8b" }, { id: "x/y", name: "Y" }]);
    expect(calls[0]?.url).toBe("http://h/v1/models");
    const headers = calls[0]?.init.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBe("Bearer k");
  });

  test("streams deltas split across network chunks and stops at [DONE]", async () => {
    const body = `${delta("Hal")}${delta("lo ")}data: [DONE]\n\n${delta("ignored")}`;
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
