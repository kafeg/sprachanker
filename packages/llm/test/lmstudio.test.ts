import { describe, expect, test } from "bun:test";
import { LlmError } from "../src/errors.ts";
import { lmStudioApi, recommendedLmStudioModel } from "../src/lmstudio.ts";

/** LM Studio stand-in: its /api/v1 answers, recording calls. */
function lmStudio(models: unknown[]) {
  const calls: string[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push(`${init?.method ?? "GET"} ${path}${init?.body ? ` ${init.body}` : ""}`);
    if (path === "/api/v1/models") return Response.json({ models });
    if (path === "/api/v1/models/download")
      return Response.json({ job_id: "job_1", status: "downloading", total_size_bytes: 100 });
    if (path === "/api/v1/models/download/status/job_1")
      return Response.json({
        job_id: "job_1",
        status: "downloading",
        total_size_bytes: 100,
        downloaded_bytes: 40,
      });
    return Response.json({ status: "loaded" });
  }) as unknown as typeof fetch;
  return { api: lmStudioApi({ baseUrl: "http://localhost:1234/v1/" }, fetchFn), calls };
}

const model = (loaded: Array<{ id: string; config: { context_length: number } }> = []) => ({
  type: "llm",
  key: "google/gemma-4-12b",
  display_name: "Gemma 4 12B",
  size_bytes: 6_800_000_000,
  format: "mlx",
  quantization: { name: "4bit" },
  loaded_instances: loaded,
});

describe("LM Studio API", () => {
  test("lists chat models, without embedding models", async () => {
    const { api, calls } = lmStudio([model(), { type: "embedding", key: "nomic" }]);
    expect(await api.models()).toEqual([
      {
        key: "google/gemma-4-12b",
        title: "Gemma 4 12B",
        sizeBytes: 6_800_000_000,
        format: "mlx",
        quantization: "4bit",
        loaded: [],
      },
    ]);
    expect(calls).toEqual(["GET /api/v1/models"]);
  });

  test("loads a model with the needed context; a smaller JIT load is replaced", async () => {
    const fresh = lmStudio([model()]);
    await fresh.api.ensureLoaded("google/gemma-4-12b");
    expect(fresh.calls[1]).toBe(
      'POST /api/v1/models/load {"model":"google/gemma-4-12b","context_length":8192}',
    );

    const small = lmStudio([
      model([{ id: "google/gemma-4-12b", config: { context_length: 4096 } }]),
    ]);
    await small.api.ensureLoaded("google/gemma-4-12b");
    expect(small.calls.slice(1)).toEqual([
      'POST /api/v1/models/unload {"instance_id":"google/gemma-4-12b"}',
      'POST /api/v1/models/load {"model":"google/gemma-4-12b","context_length":8192}',
    ]);

    const ready = lmStudio([
      model([{ id: "google/gemma-4-12b", config: { context_length: 8192 } }]),
    ]);
    await ready.api.ensureLoaded("google/gemma-4-12b");
    expect(ready.calls).toEqual(["GET /api/v1/models"]);
  });

  test("a model LM Studio does not have is reported as such", async () => {
    const { api } = lmStudio([]);
    const error = await api.ensureLoaded("google/gemma-4-12b").catch((e) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).code).toBe("model_not_found");
  });

  test("downloads and their progress", async () => {
    const { api } = lmStudio([]);
    expect(await api.download("google/gemma-4-12b")).toEqual({
      jobId: "job_1",
      status: "downloading",
      totalBytes: 100,
      downloadedBytes: undefined,
    });
    expect((await api.downloadStatus("job_1")).downloadedBytes).toBe(40);
  });

  test("the suggested model follows the computer's memory", () => {
    expect(recommendedLmStudioModel(8)).toBe("google/gemma-4-e2b");
    expect(recommendedLmStudioModel(16)).toBe("google/gemma-4-e4b");
    expect(recommendedLmStudioModel(32)).toBe("google/gemma-4-12b");
    expect(recommendedLmStudioModel(64)).toBe("google/gemma-4-26b-a4b-qat");
  });
});
