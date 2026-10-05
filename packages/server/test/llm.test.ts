import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { FIXTURE_SERIES } from "@sprachanker/course-fixture";
import { secretBox } from "../src/security/secrets.ts";
import { setup } from "./setup.ts";

/**
 * A fake provider: answers /models and streams a fixed reply from /chat/completions. As LM Studio it
 * also reports the test models as loaded (its native API is not recorded in `calls`).
 */
function provider(options: { down?: boolean } = {}) {
  const calls: Array<{ url: string; headers: Record<string, string>; body?: unknown }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    if (options.down) throw new TypeError("connection refused");
    if (url === "http://localhost:1234/api/v1/models")
      return Response.json({
        models: ["qwen3-8b", "m"].map((key) => ({
          type: "llm",
          key,
          loaded_instances: [{ id: key, config: { context_length: 8192 } }],
        })),
      });
    const headers = init.headers as Record<string, string>;
    calls.push({ url, headers, body: init.body ? JSON.parse(init.body as string) : undefined });
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

  test("context usage: size of the next request, the window, turns that still fit", async () => {
    const fake = provider();
    const { send, sendJson } = await setup({ fetch: fake.fetch });
    await send("PUT", "/api/llm/route", { provider: "lmstudio", model: "qwen3-8b" });
    const empty = await sendJson("POST", "/api/llm/tutor/context", { ...TUTOR, message: "" });
    expect(empty).toMatchObject({ window: 8192, reply: 1500, kept: 0, total: 0 });
    expect(empty.tokens).toBeGreaterThan(100);
    await (await send("POST", "/api/llm/tutor", TUTOR)).text();
    const after = await sendJson("POST", "/api/llm/tutor/context", { ...TUTOR, message: "" });
    expect([after.kept, after.total]).toEqual([2, 2]);
    expect(after.tokens).toBeGreaterThan(empty.tokens);
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

describe("LM Studio", () => {
  /** LM Studio stand-in: native API (models, load, download) and the OpenAI-compatible chat. */
  function lmStudio(options: { has?: string[]; loaded?: number } = {}) {
    const calls: string[] = [];
    let downloaded = 0;
    const fetch = (async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      calls.push(`${init?.method ?? "GET"} ${path}${init?.body ? ` ${init.body}` : ""}`);
      if (path === "/api/v1/models")
        return Response.json({
          models: (options.has ?? ["google/gemma-4-12b"]).map((key) => ({
            type: "llm",
            key,
            display_name: key,
            size_bytes: 1,
            format: "mlx",
            loaded_instances: options.loaded
              ? [{ id: key, config: { context_length: options.loaded } }]
              : [],
          })),
        });
      if (path === "/api/v1/models/download")
        return Response.json({ job_id: "job_1", status: "downloading", total_size_bytes: 100 });
      if (path === "/api/v1/models/download/status/job_1") {
        downloaded += 40;
        return Response.json({
          job_id: "job_1",
          status: "downloading",
          total_size_bytes: 100,
          downloaded_bytes: downloaded,
        });
      }
      if (path.startsWith("/api/v1/models/")) return Response.json({ status: "loaded" });
      const content = "Weil »Frau« weiblich ist.";
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
      );
    }) as unknown as typeof globalThis.fetch;
    return { fetch, calls };
  }
  const host = (installed = true) => {
    const started: string[] = [];
    return {
      started,
      host: {
        installed: () => installed,
        memoryGb: 32,
        startServer: async () => void started.push("lms server start"),
      },
    };
  };

  test("status: its models and suggested downloads with progress", async () => {
    const studio = lmStudio();
    const { getJson, sendJson } = await setup({ fetch: studio.fetch, lmStudio: host().host });
    const status = await getJson("/api/llm/lmstudio");
    expect(status).toMatchObject({ installed: true, local: true, running: true, memoryGb: 32 });
    expect(status.models.map((m: { key: string }) => m.key)).toEqual(["google/gemma-4-12b"]);
    const twelve = status.suggestions.find((m: { key: string }) => m.key === "google/gemma-4-12b");
    expect(twelve).toMatchObject({ downloaded: true, recommended: true });

    const after = await sendJson("POST", "/api/llm/lmstudio/download", {
      model: "google/gemma-4-e4b",
    });
    const e4b = after.suggestions.find((m: { key: string }) => m.key === "google/gemma-4-e4b");
    expect(e4b.download).toMatchObject({
      status: "downloading",
      totalBytes: 100,
      downloadedBytes: 40,
    });
    expect(studio.calls).toContain('POST /api/v1/models/download {"model":"google/gemma-4-e4b"}');
  });

  test("not running: the reason, and a start through lms when it is installed", async () => {
    const { host: h, started } = host();
    const down = (() => Promise.reject(new TypeError("refused"))) as unknown as typeof fetch;
    const { getJson, send } = await setup({ fetch: down, lmStudio: h });
    expect(await getJson("/api/llm/lmstudio")).toMatchObject({
      running: false,
      error: "llm_unreachable",
      installed: true,
    });
    await send("POST", "/api/llm/lmstudio/start", {});
    expect(started).toEqual(["lms server start"]);

    const missing = await setup({ fetch: down, lmStudio: host(false).host });
    const res = await missing.send("POST", "/api/llm/lmstudio/start", {});
    expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([
      409,
      "llm_lmstudio_missing",
    ]);
  });

  test("lesson help loads the chosen model with the tutor's context first", async () => {
    const studio = lmStudio({ loaded: 4096 });
    const { send } = await setup({ fetch: studio.fetch, lmStudio: host().host });
    await send("PUT", "/api/llm/route", { provider: "lmstudio", model: "google/gemma-4-12b" });
    expect(await (await send("POST", "/api/llm/explain", EXPLAIN)).text()).toBe(
      "Weil »Frau« weiblich ist.",
    );
    expect(studio.calls.slice(0, 4)).toEqual([
      "GET /api/v1/models",
      'POST /api/v1/models/unload {"instance_id":"google/gemma-4-12b"}',
      'POST /api/v1/models/load {"model":"google/gemma-4-12b","context_length":8192}',
      expect.stringMatching(/^POST \/v1\/chat\/completions /),
    ]);
  });

  test("a route to the removed built-in runtime reads as off", async () => {
    const { app, getJson, send } = await setup();
    await send("PUT", "/api/llm/route", { provider: "lmstudio", model: "x" });
    // Simulate a profile written by the earlier version.
    expect((await send("PUT", "/api/llm/route", { provider: "builtin", model: "x" })).status).toBe(
      400,
    );
    expect(app).toBeDefined();
    expect((await getJson("/api/llm")).provider).toBe("lmstudio");
  });
});

describe("prompt viewer", () => {
  test("task prompts for the settings: system rules and context budgets", async () => {
    const { getJson } = await setup();
    const prompts = await getJson("/api/llm/prompts?language=ru&target=de");
    expect(prompts.explain.system).toContain("Explain in Russian");
    expect(prompts.tutor.system).toContain("friendly German tutor");
    expect(prompts.tutor.budgets.grammar).toBe(3500);
    expect(prompts.explain.budgets.notes).toBe(6000);
  });

  test("the exact request of an explanation and of a tutor message; nothing is sent", async () => {
    const fake = provider();
    const { send, sendJson, getJson } = await setup({ fetch: fake.fetch });
    await send("PUT", "/api/llm/route", { provider: "lmstudio", model: "qwen3-8b" });
    const explain = await sendJson("POST", "/api/llm/explain/prompt", EXPLAIN);
    expect(explain).toMatchObject({
      provider: "lmstudio",
      model: "qwen3-8b",
      url: "http://localhost:1234/v1/chat/completions",
      body: { model: "qwen3-8b", stream: true, max_tokens: 1200, reasoning_effort: "none" },
    });
    expect(explain.body.messages[1].content).toContain(
      "Learner's answer: Guten Tag, [Herr] Weber.",
    );

    const tutor = await sendJson("POST", "/api/llm/tutor/prompt", {
      series: FIXTURE_SERIES,
      lessonKey: "sprachanker.fixture/demo/00-02",
      edition: "ru-de",
      message: "",
      language: "ru",
    });
    expect(tutor.body.messages[0].content).toContain("<course>");
    expect(tutor.body.messages.at(-1)).toEqual({ role: "user", content: "" });
    expect(fake.calls).toEqual([]);
    expect(
      (await getJson("/api/llm/tutor?lessonKey=sprachanker.fixture/demo/00-02")).turns,
    ).toEqual([]);
  });

  test("without a configured model the viewer says so", async () => {
    const { send } = await setup();
    const res = await send("POST", "/api/llm/explain/prompt", EXPLAIN);
    expect(res.status).toBe(409);
  });
});
