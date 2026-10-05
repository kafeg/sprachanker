import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { secretBox } from "../src/security/secrets.ts";
import { setup } from "./setup.ts";

/** A fake provider: answers /models and streams a fixed reply from /chat/completions. */
function provider(options: { down?: boolean } = {}) {
  const calls: Array<{ url: string; headers: Record<string, string>; body?: unknown }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({ url, headers, body: init.body ? JSON.parse(init.body as string) : undefined });
    if (options.down) throw new TypeError("connection refused");
    if (url.endsWith("/models")) return Response.json({ data: [{ id: "qwen3-8b" }] });
    const sse = ["<think>hmm</think>Weil ", "»Frau« weiblich ist."]
      .map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
      .join("");
    return new Response(`${sse}data: [DONE]\n\n`);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const EXPLAIN = {
  series: FIXTURE_SERIES,
  lessonKey: "sprachanker.fixture/demo/00-01",
  edition: "ru-de",
  exerciseKey: "sprachanker.fixture/demo/00-01/ex-06",
  index: 0,
  answer: { g1: "a" },
  language: "ru",
};

describe("llm setup", () => {
  test("off by default; providers with their default endpoints", async () => {
    const { getJson } = await setup();
    const state = await getJson("/api/llm");
    expect(state.provider).toBeNull();
    expect(state.providers.map((p: { id: string; baseUrl: string }) => [p.id, p.baseUrl])).toEqual([
      ["lmstudio", "http://localhost:1234/v1"],
      ["openrouter", "https://openrouter.ai/api/v1"],
      ["custom", ""],
    ]);
  });

  test("API keys are write-only and sealed at rest", async () => {
    const { root, sendJson, get } = await setup();
    const state = await sendJson("PUT", "/api/llm/providers/openrouter", {
      apiKey: "sk-or-secret",
    });
    expect(state.providers[1].hasKey).toBe(true);
    expect(await (await get("/api/llm")).text()).not.toContain("sk-or-secret");
    expect(await (await get("/api/settings")).text()).not.toContain("sk-or-secret");
    const stored = new Database(join(root, "profiles/local/profile.sqlite"))
      .query<{ value_encrypted: string }, []>("SELECT value_encrypted FROM secrets")
      .get();
    expect(stored?.value_encrypted).not.toContain("sk-or-secret");
    const removed = await sendJson("PUT", "/api/llm/providers/openrouter", { apiKey: null });
    expect(removed.providers[1].hasKey).toBe(false);
  });

  test("endpoints: editable for local servers, validated, reset with null", async () => {
    const { send, sendJson } = await setup();
    const set = await sendJson("PUT", "/api/llm/providers/lmstudio", {
      baseUrl: "http://192.168.1.5:1234/v1",
    });
    expect(set.providers[0].baseUrl).toBe("http://192.168.1.5:1234/v1");
    expect((await send("PUT", "/api/llm/providers/lmstudio", { baseUrl: "ftp://x" })).status).toBe(
      400,
    );
    expect((await send("PUT", "/api/llm/providers/nope", {})).status).toBe(400);
    const reset = await sendJson("PUT", "/api/llm/providers/lmstudio", { baseUrl: null });
    expect(reset.providers[0].baseUrl).toBe("http://localhost:1234/v1");
  });

  test("connection test lists models and sends the key", async () => {
    const fake = provider();
    const { send, sendJson, get, getJson } = await setup({ fetch: fake.fetch });
    expect((await get("/api/llm/models?provider=openrouter")).status).toBe(409);
    await send("PUT", "/api/llm/providers/openrouter", { apiKey: "sk-or-secret" });
    const result = await getJson("/api/llm/models?provider=openrouter");
    expect(result.models).toEqual([{ id: "qwen3-8b" }]);
    expect(fake.calls[0]?.url).toBe("https://openrouter.ai/api/v1/models");
    expect(fake.calls[0]?.headers.authorization).toBe("Bearer sk-or-secret");
    const route = await sendJson("PUT", "/api/llm/route", { provider: "lmstudio", model: "m" });
    expect([route.provider, route.model]).toEqual(["lmstudio", "m"]);
  });

  test("an unreachable server is a 502 with a code", async () => {
    const { get } = await setup({ fetch: provider({ down: true }).fetch });
    const res = await get("/api/llm/models?provider=lmstudio");
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe("llm_unreachable");
  });
});

describe("explain a mistake", () => {
  test("needs a configured route", async () => {
    const { send } = await setup({ fetch: provider().fetch });
    const res = await send("POST", "/api/llm/explain", EXPLAIN);
    expect(res.status).toBe(409);
  });

  test("streams the explanation without thinking; the prompt carries the item and lesson", async () => {
    const fake = provider();
    const { send } = await setup({ fetch: fake.fetch });
    await send("PUT", "/api/llm/route", { provider: "lmstudio", model: "qwen3-8b" });
    const res = await send("POST", "/api/llm/explain", EXPLAIN);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Weil »Frau« weiblich ist.");
    const body = fake.calls[0]?.body as { model: string; messages: Array<{ content: string }> };
    expect(fake.calls[0]?.url).toBe("http://localhost:1234/v1/chat/completions");
    expect(body.model).toBe("qwen3-8b");
    expect(body.messages[0]?.content).toContain("Explain in Russian");
    expect(body.messages[1]?.content).toContain("Learner's answer: Guten Tag, [Herr] Weber.");
  });

  test("an unknown exercise item is refused", async () => {
    const { send } = await setup({ fetch: provider().fetch });
    await send("PUT", "/api/llm/route", { provider: "lmstudio", model: "m" });
    const res = await send("POST", "/api/llm/explain", { ...EXPLAIN, index: 9 });
    expect(res.status).toBe(409);
  });
});

test("secret box: round trip; another key or damaged data opens to nothing", async () => {
  const box = secretBox(new Uint8Array(32).fill(1));
  const sealed = await box.seal("sk-123");
  expect(await box.open(sealed)).toBe("sk-123");
  expect(await box.seal("sk-123")).not.toBe(sealed);
  expect(await secretBox(new Uint8Array(32).fill(2)).open(sealed)).toBeUndefined();
  expect(await box.open("garbage")).toBeUndefined();
});
