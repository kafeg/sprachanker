import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { secretBox } from "../src/security/secrets.ts";
import type { LocalLlm } from "../src/services/llm.ts";
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

// biome-ignore lint/suspicious/noExplicitAny: test responses are inspected structurally.
const byId = (state: any, id: string) => state.providers.find((p: { id: string }) => p.id === id);

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
      ["builtin", ""],
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
    expect(byId(state, "openrouter").hasKey).toBe(true);
    expect(await (await get("/api/llm")).text()).not.toContain("sk-or-secret");
    expect(await (await get("/api/settings")).text()).not.toContain("sk-or-secret");
    const stored = new Database(join(root, "profiles/local/profile.sqlite"))
      .query<{ value_encrypted: string }, []>("SELECT value_encrypted FROM secrets")
      .get();
    expect(stored?.value_encrypted).not.toContain("sk-or-secret");
    const removed = await sendJson("PUT", "/api/llm/providers/openrouter", { apiKey: null });
    expect(byId(removed, "openrouter").hasKey).toBe(false);
  });

  test("endpoints: editable for local servers, validated, reset with null", async () => {
    const { send, sendJson } = await setup();
    const set = await sendJson("PUT", "/api/llm/providers/lmstudio", {
      baseUrl: "http://192.168.1.5:1234/v1",
    });
    expect(byId(set, "lmstudio").baseUrl).toBe("http://192.168.1.5:1234/v1");
    expect((await send("PUT", "/api/llm/providers/lmstudio", { baseUrl: "ftp://x" })).status).toBe(
      400,
    );
    expect((await send("PUT", "/api/llm/providers/nope", {})).status).toBe(400);
    const reset = await sendJson("PUT", "/api/llm/providers/lmstudio", { baseUrl: null });
    expect(byId(reset, "lmstudio").baseUrl).toBe("http://localhost:1234/v1");
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

describe("lesson tutor", () => {
  const TUTOR = {
    series: FIXTURE_SERIES,
    lessonKey: "sprachanker.fixture/demo/00-02",
    edition: "ru-de",
    message: "Дай пример",
    language: "ru",
  };
  const prompt = (call: { body?: unknown } | undefined) =>
    (call?.body as { messages: Array<{ role: string; content: string }> } | undefined)?.messages ??
    [];

  test("a chat per lesson: replies are streamed and stored with the question", async () => {
    const fake = provider();
    const { send, sendJson, getJson } = await setup({ fetch: fake.fetch });
    await send("PUT", "/api/llm/route", { provider: "lmstudio", model: "qwen3-8b" });
    const first = await send("POST", "/api/llm/tutor", TUTOR);
    expect(await first.text()).toBe("Weil »Frau« weiblich ist.");
    const system = prompt(fake.calls[0])[0]?.content ?? "";
    // The second lesson knows the first one: its title and words.
    expect(system).toContain("Earlier lessons: ");
    expect(system).toContain("der Kaffee");

    await (await send("POST", "/api/llm/tutor", { ...TUTOR, message: "Ещё" })).text();
    expect(prompt(fake.calls[1]).map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);

    const { turns } = await getJson(`/api/llm/tutor?lessonKey=${TUTOR.lessonKey}`);
    expect(turns.map((t: { role: string; text: string }) => [t.role, t.text])).toEqual([
      ["user", "Дай пример"],
      ["assistant", "Weil »Frau« weiblich ist."],
      ["user", "Ещё"],
      ["assistant", "Weil »Frau« weiblich ist."],
    ]);
    expect(turns[1].model).toBe("qwen3-8b");

    expect(await sendJson("POST", "/api/llm/tutor/reset", { lessonKey: TUTOR.lessonKey })).toEqual({
      ok: true,
    });
    expect((await getJson(`/api/llm/tutor?lessonKey=${TUTOR.lessonKey}`)).turns).toEqual([]);
    // Chats do not count as lesson progress.
    const courses = await getJson("/api/courses");
    expect(courses[0].done).toBe(0);
  });

  test("the exercise on screen is part of the context", async () => {
    const fake = provider();
    const { send } = await setup({ fetch: fake.fetch });
    await send("PUT", "/api/llm/route", { provider: "lmstudio", model: "m" });
    await (
      await send("POST", "/api/llm/tutor", {
        ...TUTOR,
        lessonKey: "sprachanker.fixture/demo/00-01",
        exerciseKey: EXPLAIN.exerciseKey,
      })
    ).text();
    expect(prompt(fake.calls[0])[0]?.content).toContain("Answer: Guten Tag, [Frau] Weber.");
  });

  test("nothing is stored when the model is not reachable", async () => {
    const { send, getJson } = await setup({ fetch: provider({ down: true }).fetch });
    await send("PUT", "/api/llm/route", { provider: "lmstudio", model: "m" });
    expect((await send("POST", "/api/llm/tutor", TUTOR)).status).toBe(502);
    expect((await getJson(`/api/llm/tutor?lessonKey=${TUTOR.lessonKey}`)).turns).toEqual([]);
  });
});

describe("built-in model", () => {
  /** A LocalLlm stand-in: one downloaded model whose llama-server answers at a fixed URL. */
  function local(ready: boolean, fail = false) {
    const calls: string[] = [];
    const model = {
      id: "gemma-4-e4b",
      title: "Gemma 4 E4B",
      sizeBytes: 1,
      ramGb: 6.5,
      recommended: true,
      state: ready ? ("ready" as const) : ("absent" as const),
      received: 0,
    };
    const llm: LocalLlm = {
      status: () => ({
        available: true,
        engine: { build: "b1", state: "ready", received: 1, size: 1 },
        memoryGb: 16,
        models: [model],
        running: null,
      }),
      download: (id) => void calls.push(`download ${id}`),
      cancel: (id) => void calls.push(`cancel ${id}`),
      remove: async (id) => void calls.push(`remove ${id}`),
      endpoint: async (id) => {
        calls.push(`endpoint ${id}`);
        if (fail) throw new Error("failed to load model");
        return "http://127.0.0.1:9999/v1";
      },
      stop: async () => {},
    };
    return { llm, calls };
  }

  test("catalog and download controls", async () => {
    const { llm, calls } = local(false);
    const { getJson, send } = await setup({ localLlm: llm });
    expect((await getJson("/api/llm/local")).models[0].id).toBe("gemma-4-e4b");
    await send("POST", "/api/llm/local/gemma-4-e4b/download", {});
    await send("POST", "/api/llm/local/gemma-4-e4b/cancel", {});
    await send("DELETE", "/api/llm/local/gemma-4-e4b", {});
    expect((await send("POST", "/api/llm/local/nope/download", {})).status).toBe(400);
    expect(calls).toEqual(["download gemma-4-e4b", "cancel gemma-4-e4b", "remove gemma-4-e4b"]);
  });

  test("models are the downloaded ones; lesson help goes to the started llama-server", async () => {
    const fake = provider();
    const { llm, calls } = local(true);
    const { send, getJson } = await setup({ fetch: fake.fetch, localLlm: llm });
    expect((await getJson("/api/llm/models?provider=builtin")).models).toEqual([
      { id: "gemma-4-e4b", name: "Gemma 4 E4B" },
    ]);
    await send("PUT", "/api/llm/route", { provider: "builtin", model: "gemma-4-e4b" });
    const res = await send("POST", "/api/llm/explain", EXPLAIN);
    expect(await res.text()).toBe("Weil »Frau« weiblich ist.");
    expect(calls).toEqual(["endpoint gemma-4-e4b"]);
    expect(fake.calls[0]?.url).toBe("http://127.0.0.1:9999/v1/chat/completions");
  });

  test("a model not downloaded, or an engine that does not start, gives clear errors", async () => {
    const missing = await setup({ fetch: provider().fetch, localLlm: local(false).llm });
    await missing.send("PUT", "/api/llm/route", { provider: "builtin", model: "gemma-4-e4b" });
    const a = await missing.send("POST", "/api/llm/explain", EXPLAIN);
    expect([a.status, ((await a.json()) as { error: string }).error]).toEqual([
      409,
      "llm_model_missing",
    ]);

    const broken = await setup({ fetch: provider().fetch, localLlm: local(true, true).llm });
    await broken.send("PUT", "/api/llm/route", { provider: "builtin", model: "gemma-4-e4b" });
    const b = await broken.send("POST", "/api/llm/explain", EXPLAIN);
    expect([b.status, ((await b.json()) as { error: string }).error]).toEqual([
      502,
      "llm_engine_failed",
    ]);

    const none = await setup({ fetch: provider().fetch });
    await none.send("PUT", "/api/llm/route", { provider: "builtin", model: "gemma-4-e4b" });
    expect(
      ((await (await none.send("POST", "/api/llm/explain", EXPLAIN)).json()) as { error: string })
        .error,
    ).toBe("llm_builtin_unavailable");
  });
});
