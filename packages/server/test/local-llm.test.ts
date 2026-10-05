import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocalModel } from "@sprachanker/llm";
import { DownloadError, download, partFile, partSize } from "../src/jobs/download.ts";
import type { Engine } from "../src/sidecars/engines/engine.ts";
import { llamaEngine } from "../src/sidecars/engines/llama.ts";
import { mlxEngine, mlxSupported } from "../src/sidecars/engines/mlx.ts";
import { createLocalLlm } from "../src/sidecars/local-llm.ts";
import { createModelServer } from "../src/sidecars/model-server.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "sprachanker-llm-"));
const FAKE = [process.execPath, join(import.meta.dir, "fixtures/fake-llama-server.ts")];
const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
const sha = createHash("sha256").update(bytes).digest("hex");

/** Serves `bytes`; honours Range unless told not to; can cut the body after `cutAt` bytes. */
function server(options: { ranges?: boolean; cutAt?: number } = {}) {
  const requests: Array<string | null> = [];
  const fetch = (async (_url: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get("range");
    requests.push(range);
    const from = range && options.ranges !== false ? Number(/bytes=(\d+)-/.exec(range)?.[1]) : 0;
    const body = bytes.slice(from, options.cutAt ?? bytes.length);
    const parts = [body.slice(0, body.length / 2), body.slice(body.length / 2)];
    return new Response(
      new ReadableStream({
        pull(c) {
          const next = parts.shift();
          if (next) c.enqueue(next);
          else if (options.cutAt) c.error(new Error("connection reset"));
          else c.close();
        },
      }),
      { status: from > 0 ? 206 : 200 },
    );
  }) as unknown as typeof globalThis.fetch;
  return { fetch, requests };
}

describe("download", () => {
  const options = (dest: string, fetch: typeof globalThis.fetch) => ({
    url: "https://example.test/model.gguf",
    dest,
    size: bytes.length,
    sha256: sha,
    fetch,
  });

  test("verified file appears under its name; progress reported", async () => {
    const dest = join(tmp(), "m.gguf");
    const seen: number[] = [];
    await download({ ...options(dest, server().fetch), onProgress: (n) => seen.push(n) });
    expect(existsSync(dest)).toBe(true);
    expect(seen.at(-1)).toBe(bytes.length);
  });

  test("an interrupted download resumes with a range request", async () => {
    const dest = join(tmp(), "m.gguf");
    await expect(download(options(dest, server({ cutAt: 40_000 }).fetch))).rejects.toThrow();
    expect(partSize(dest)).toBe(40_000);
    const s = server();
    await download(options(dest, s.fetch));
    expect(s.requests).toEqual(["bytes=40000-"]);
    expect(existsSync(dest)).toBe(true);
  });

  test("a server ignoring ranges: start over", async () => {
    const dest = join(tmp(), "m.gguf");
    writeFileSync(partFile(dest), bytes.slice(0, 10));
    const s = server({ ranges: false });
    await download(options(dest, s.fetch));
    expect(s.requests).toEqual(["bytes=10-", null]);
    expect(existsSync(dest)).toBe(true);
  });

  test("a checksum mismatch leaves nothing behind", async () => {
    const dest = join(tmp(), "m.gguf");
    await expect(
      download({ ...options(dest, server().fetch), sha256: "0".repeat(64) }),
    ).rejects.toBeInstanceOf(DownloadError);
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(partFile(dest))).toBe(false);
  });
});

const launch = (path: string, alias: string) => (port: number) => ({
  argv: [...FAKE, "-m", path, "--port", String(port), "--alias", alias],
  cwd: tmpdir(),
  requestModel: alias,
});

describe("model server", () => {
  test("starts on demand, reuses the process, switches models, restarts after a stop", async () => {
    const server = createModelServer();
    const a = await server.endpoint("llama:a", "a", launch("/models/a.gguf", "a"));
    expect(a.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    expect(a.model).toBe("a");
    expect(server.state()).toEqual({ model: "a", state: "ready" });
    expect(await server.endpoint("llama:a", "a", launch("/models/a.gguf", "a"))).toEqual(a);

    const b = await server.endpoint("mlx:a", "a", launch("/models/a", "default_model"));
    expect(b.baseUrl).not.toBe(a.baseUrl);
    expect(b.model).toBe("default_model");
    expect(await fetch(`${a.baseUrl.replace("/v1", "")}/health`).catch(() => "gone")).toBe("gone");

    await server.stop();
    expect(server.state()).toBeNull();
    expect((await server.endpoint("mlx:a", "a", launch("/models/a", "x"))).baseUrl).toMatch(
      /^http/,
    );
    await server.stop();
  });

  test("a model that fails to load reports the server's error", async () => {
    const server = createModelServer();
    await expect(server.endpoint("x", "x", launch("/models/broken.gguf", "x"))).rejects.toThrow(
      "failed to load model",
    );
    expect(server.state()).toMatchObject({ model: "x", state: "failed" });
  });
});

describe("engines", () => {
  test("llama.cpp: the release is downloaded, unpacked with its symlinks, installed once", async () => {
    const root = tmp();
    mkdirSync(join(root, "build/bin"), { recursive: true });
    writeFileSync(join(root, "build/bin/llama-server"), "#!/bin/sh\n");
    writeFileSync(join(root, "build/bin/libllama.0.6.0.dylib"), "lib");
    symlinkSync("libllama.0.6.0.dylib", join(root, "build/bin/libllama.0.dylib"));
    const archive = join(tmp(), "llama.tar.gz");
    expect(Bun.spawnSync(["tar", "-czf", archive, "-C", root, "build"]).exitCode).toBe(0);
    const data = new Uint8Array(readFileSync(archive));
    let requests = 0;
    const engines = tmp();
    const engine = llamaEngine(engines, {
      url: "https://example.test/llama.tar.gz",
      file: "llama.tar.gz",
      size: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
    });
    expect(engine.installed()).toBe(false);
    const phases: string[] = [];
    await engine.install({
      fetch: (async () => {
        requests++;
        return new Response(data);
      }) as unknown as typeof fetch,
      signal: new AbortController().signal,
      onProgress: (p) => phases.push(p.phase),
    });
    expect(engine.installed()).toBe(true);
    expect(requests).toBe(1);
    expect(phases.at(-1)).toBe("setup");
    const { argv, cwd, requestModel } = engine.serve("/m.gguf", 1234, "gemma");
    expect(argv[0]).toEndWith("build/bin/llama-server");
    expect(argv).toContain("--reasoning");
    expect(readlinkSync(join(cwd, "libllama.0.dylib"))).toBe("libllama.0.6.0.dylib");
    expect(requestModel).toBe("gemma");
  });

  test("mlx-lm: Apple Silicon with macOS 14+ only; served offline as default_model", () => {
    expect(mlxSupported("darwin", "arm64", "24.3.0")).toBe(true);
    expect(mlxSupported("darwin", "arm64", "22.6.0")).toBe(false);
    expect(mlxSupported("darwin", "x64", "24.3.0")).toBe(false);
    expect(mlxSupported("linux", "arm64", "6.1.0")).toBe(false);
    const launched = mlxEngine(tmp(), true).serve("/models/gemma", 4321, "gemma");
    expect(launched.argv.slice(1, 4)).toEqual(["-m", "mlx_lm", "server"]);
    expect(launched.argv).toContain('{"enable_thinking":false}');
    expect(launched.env?.HF_HUB_OFFLINE).toBe("1");
    expect(launched.requestModel).toBe("default_model");
  });
});

describe("built-in runtime", () => {
  const ggufFile = { path: "tiny.gguf", size: bytes.length, sha256: sha };
  const model: LocalModel = {
    id: "tiny",
    title: "Tiny",
    ramGb: 1,
    gguf: { repo: "test/tiny-gguf", files: [ggufFile] },
    mlx: {
      repo: "test/tiny-mlx",
      files: [
        { path: "config.json", size: 2, sha256: createHash("sha256").update("{}").digest("hex") },
        { path: "model.safetensors", size: bytes.length, sha256: sha },
      ],
    },
  };

  /** An engine that installs instantly and serves through the fake server. */
  function fakeEngine(id: "llama" | "mlx", available = true): Engine & { installs: number } {
    let installed = false;
    const engine = {
      id,
      format: id === "mlx" ? ("mlx" as const) : ("gguf" as const),
      version: "1",
      installSize: 1,
      downloadSize: 1,
      available,
      installs: 0,
      installed: () => installed,
      async install() {
        engine.installs++;
        installed = true;
      },
      serve: (path: string, port: number, alias: string) =>
        launch(path, id === "mlx" ? "default_model" : alias)(port),
    };
    return engine;
  }

  /** Hub stand-in: config.json and the model bytes, counting requests. */
  function hub() {
    const urls: string[] = [];
    const files = server();
    const fetchFn = ((url: string, init?: RequestInit) => {
      urls.push(url);
      return url.endsWith("config.json")
        ? Promise.resolve(new Response("{}"))
        : files.fetch(url, init);
    }) as unknown as typeof globalThis.fetch;
    return { fetch: fetchFn, urls };
  }

  const settle = async (local: ReturnType<typeof createLocalLlm>, engine: "llama" | "mlx") => {
    while (local.status(engine).models[0]?.state === "downloading") await Bun.sleep(5);
  };

  test("engines: the first available one is recommended; models follow the engine's format", () => {
    const local = createLocalLlm({
      modelsDir: tmp(),
      enginesDir: tmp(),
      fetch: hub().fetch,
      memoryGb: 8,
      engines: [fakeEngine("mlx", false), fakeEngine("llama")],
      models: [model],
    });
    expect(local.recommendedEngine()).toBe("llama");
    expect(local.status("llama").models[0]?.sizeBytes).toBe(bytes.length);
    expect(local.status("mlx")).toMatchObject({ engine: null, models: [] });
  });

  test("download → ready → running → removed (MLX build: a folder of files)", async () => {
    const h = hub();
    const mlx = fakeEngine("mlx");
    const modelsDir = tmp();
    const local = createLocalLlm({
      modelsDir,
      enginesDir: tmp(),
      fetch: h.fetch,
      memoryGb: 8,
      engines: [mlx, fakeEngine("llama")],
      models: [model],
      lmStudioDir: tmp(),
    });
    expect(local.status("mlx").models[0]?.state).toBe("absent");
    local.download("tiny", "mlx");
    await settle(local, "mlx");
    expect(local.status("mlx").models[0]).toMatchObject({
      state: "ready",
      received: bytes.length + 2,
    });
    expect(existsSync(join(modelsDir, "tiny-mlx", "model.safetensors"))).toBe(true);
    expect(h.urls).toEqual([
      "https://huggingface.co/test/tiny-mlx/resolve/main/config.json",
      "https://huggingface.co/test/tiny-mlx/resolve/main/model.safetensors",
    ]);
    expect(mlx.installs).toBe(1);
    // The other engine's format is not downloaded.
    expect(local.status("llama").models[0]?.state).toBe("absent");

    const endpoint = await local.endpoint("tiny", "mlx");
    expect(endpoint.model).toBe("default_model");
    expect(local.status("mlx").running).toEqual({ model: "tiny", state: "ready" });

    await local.remove("tiny", "mlx");
    expect(local.status("mlx").models[0]?.state).toBe("absent");
    expect(existsSync(join(modelsDir, "tiny-mlx"))).toBe(false);
    expect(local.status("mlx").running).toBeNull();
  });

  test("a build LM Studio already has is copied, not downloaded; a mismatching copy is not used", async () => {
    const lmStudio = tmp();
    mkdirSync(join(lmStudio, "test/tiny-mlx"), { recursive: true });
    writeFileSync(join(lmStudio, "test/tiny-mlx/config.json"), "{}");
    writeFileSync(join(lmStudio, "test/tiny-mlx/model.safetensors"), bytes);
    const h = hub();
    const local = createLocalLlm({
      modelsDir: tmp(),
      enginesDir: tmp(),
      fetch: h.fetch,
      memoryGb: 8,
      engines: [fakeEngine("mlx")],
      models: [model],
      lmStudioDir: lmStudio,
    });
    expect(local.status("mlx").models[0]?.inLmStudio).toBe(true);
    local.download("tiny", "mlx");
    await settle(local, "mlx");
    expect(local.status("mlx").models[0]?.state).toBe("ready");
    expect(h.urls).toEqual([]);

    // Same size, other bytes: verified, rejected, downloaded instead.
    writeFileSync(join(lmStudio, "test/tiny-mlx/config.json"), "[]");
    const h2 = hub();
    const other = createLocalLlm({
      modelsDir: tmp(),
      enginesDir: tmp(),
      fetch: h2.fetch,
      memoryGb: 8,
      engines: [fakeEngine("mlx")],
      models: [model],
      lmStudioDir: lmStudio,
    });
    other.download("tiny", "mlx");
    await settle(other, "mlx");
    expect(other.status("mlx").models[0]?.state).toBe("ready");
    expect(h2.urls).toEqual(["https://huggingface.co/test/tiny-mlx/resolve/main/config.json"]);
  });

  test("a cancelled download is paused and shows what is on disk", async () => {
    const modelsDir = tmp();
    writeFileSync(partFile(join(modelsDir, "tiny.gguf")), bytes.slice(0, 500));
    const local = createLocalLlm({
      modelsDir,
      enginesDir: tmp(),
      fetch: hub().fetch,
      memoryGb: 8,
      engines: [fakeEngine("llama")],
      models: [model],
    });
    expect(local.status("llama").models[0]).toMatchObject({ state: "paused", received: 500 });
  });
});
