import { expect, test } from "bun:test";
import { modelInfo } from "../src/models.ts";
import { openRouterKey } from "../src/openrouter.ts";

test("a model's metadata as an OpenRouter-style list tells it; non-text models are left out", () => {
  expect(
    modelInfo({
      id: "maker/talker-7b",
      name: "Maker: Talker 7B",
      context_length: 128_000,
      pricing: { prompt: "0.0000001", completion: "0.0000005" },
      architecture: { output_modalities: ["text"] },
      supported_parameters: ["max_tokens", "response_format", "tools"],
    }),
  ).toEqual({
    id: "maker/talker-7b",
    name: "Maker: Talker 7B",
    price: { input: 0.1, output: 0.5 },
    contextLength: 128_000,
    json: true,
    tools: true,
    publisher: "maker",
  });
  // Free: a ":free" variant or a price of nothing.
  expect(modelInfo({ id: "maker/small:free" })?.free).toBe(true);
  expect(modelInfo({ id: "maker/zero", pricing: { prompt: "0", completion: "0" } })?.free).toBe(
    true,
  );
  // An image or audio generator, and an embedding model, are no chat models.
  expect(
    modelInfo({ id: "maker/painter", architecture: { output_modalities: ["image", "text"] } }),
  ).toBeUndefined();
  expect(
    modelInfo({ id: "maker/voice", architecture: { output_modalities: ["text", "audio"] } }),
  ).toBeUndefined();
  expect(modelInfo({ id: "text-embedding-3" })).toBeUndefined();
  // Groq and Gemini: the context and the maker from their own fields; speech, safety and image models
  // left out by their ids.
  expect(
    modelInfo({ id: "llama-3.3-70b-versatile", owned_by: "Meta", context_window: 131_072 }),
  ).toEqual({ id: "llama-3.3-70b-versatile", publisher: "Meta", contextLength: 131_072 });
  expect(modelInfo({ id: "qwen/qwen3-32b", owned_by: "Alibaba Cloud" })?.publisher).toBe("qwen");
  for (const id of [
    "whisper-large-v3",
    "canopylabs/orpheus-v1-english",
    "meta-llama/llama-prompt-guard-2-22m",
    "gemini-2.5-flash-preview-tts",
    "gemini-2.5-flash-image",
    "imagen-4.0-generate-001",
    "veo-3.0-generate-001",
    "gemini-embedding-001",
  ])
    expect(modelInfo({ id })).toBeUndefined();
  expect(modelInfo({ id: "gemini-2.5-flash", owned_by: "google" })?.publisher).toBe("google");
  // A plain server tells only the id.
  expect(modelInfo({ id: "qwen3-8b" })).toEqual({ id: "qwen3-8b" });
});

test("OpenRouter's key state: free tier, usage, limit and rate limit, as far as it tells", async () => {
  const seen: string[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push(`${url} ${headers.authorization}`);
    return Response.json({
      data: {
        label: "sk-or-…",
        usage: 0.42,
        limit: 5,
        limit_remaining: 4.58,
        is_free_tier: false,
        rate_limit: { requests: 20, interval: "1m" },
      },
    });
  }) as typeof fetch;
  expect(
    await openRouterKey({ baseUrl: "https://router.test/api/v1", apiKey: "k" }, fetchFn),
  ).toEqual({
    freeTier: false,
    usage: 0.42,
    limit: 5,
    remaining: 4.58,
    rateLimit: { requests: 20, interval: "1m" },
  });
  expect(seen).toEqual(["https://router.test/api/v1/key Bearer k"]);
  // A key without a limit: only what is told.
  const bare = (async () => Response.json({ data: { usage: 0, is_free_tier: true } })) as never;
  expect(await openRouterKey({ baseUrl: "https://router.test/api/v1", apiKey: "k" }, bare)).toEqual(
    {
      freeTier: true,
      usage: 0,
    },
  );
});
