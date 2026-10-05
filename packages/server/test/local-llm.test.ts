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
import type { EngineAsset } from "../src/sidecars/llama-release.ts";
import { createLlamaServer } from "../src/sidecars/llama-server.ts";
import { createLocalLlm, installEngine } from "../src/sidecars/local-llm.ts";

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

describe("llama-server supervisor", () => {
  test("starts on demand, reuses the process, switches models, restarts after a crash", async () => {
    const llama = createLlamaServer({ binary: "unused", cwd: tmp(), command: FAKE });
    const url = await llama.endpoint("a", "/models/a.gguf");
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    expect(llama.state()).toEqual({ model: "a", state: "ready" });
    expect(await llama.endpoint("a", "/models/a.gguf")).toBe(url);

    const other = await llama.endpoint("b", "/models/b.gguf");
    expect(other).not.toBe(url);
    expect(await fetch(`${url.replace("/v1", "")}/health`).catch(() => "gone")).toBe("gone");

    await llama.stop();
    expect(llama.state()).toBeNull();
    expect(await llama.endpoint("b", "/models/b.gguf")).toMatch(/^http/);
    await llama.stop();
  });

  test("a model that fails to load reports llama-server's error", async () => {
    const llama = createLlamaServer({ binary: "unused", cwd: tmp(), command: FAKE });
    await expect(llama.endpoint("x", "/models/broken.gguf")).rejects.toThrow(
      "failed to load model",
    );
    expect(llama.state()).toMatchObject({ model: "x", state: "failed" });
  });
});

describe("built-in runtime", () => {
  const model: LocalModel = {
    id: "tiny",
    title: "Tiny",
    repo: "test/tiny",
    file: "tiny.gguf",
    sizeBytes: bytes.length,
    sha256: sha,
    ramGb: 1,
  };

  /** A release archive like ggml-org's: build/bin/llama-server plus a library symlink. */
  function engineArchive() {
    const root = tmp();
    mkdirSync(join(root, "build/bin"), { recursive: true });
    writeFileSync(join(root, "build/bin/llama-server"), "#!/bin/sh\n");
    writeFileSync(join(root, "build/bin/libllama.0.6.0.dylib"), "lib");
    symlinkSync("libllama.0.6.0.dylib", join(root, "build/bin/libllama.0.dylib"));
    const file = join(tmp(), "llama-b1-bin-test.tar.gz");
    expect(Bun.spawnSync(["tar", "-czf", file, "-C", root, "build"]).exitCode).toBe(0);
    const data = new Uint8Array(readFileSync(file));
    const asset: EngineAsset = {
      build: "b1",
      platform: "test-x64",
      url: "https://example.test/llama-b1-bin-test.tar.gz",
      file: "llama-b1-bin-test.tar.gz",
      size: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
    };
    let requests = 0;
    const fetchFn = (async () => {
      requests++;
      return new Response(data);
    }) as unknown as typeof globalThis.fetch;
    return { asset, fetch: fetchFn, requests: () => requests };
  }

  test("the engine is downloaded, unpacked with its symlinks, and installed once", async () => {
    const { asset, fetch: fetchFn, requests } = engineArchive();
    const dir = tmp();
    const binary = await installEngine(asset, dir, fetchFn);
    expect(binary).toBe(join(dir, "llama.cpp-b1-test-x64/build/bin/llama-server"));
    expect(readlinkSync(join(binary, "../libllama.0.dylib"))).toBe("libllama.0.6.0.dylib");
    expect(existsSync(join(dir, asset.file))).toBe(false);
    expect(await installEngine(asset, dir, fetchFn)).toBe(binary);
    expect(requests()).toBe(1);
  });

  test("download → ready → running → removed", async () => {
    const archive = engineArchive();
    const hub = server();
    const local = createLocalLlm({
      engine: archive.asset,
      modelsDir: tmp(),
      enginesDir: tmp(),
      // The engine archive and the model come from different hosts.
      fetch: ((url: string, init?: RequestInit) =>
        url === archive.asset.url
          ? archive.fetch(url, init)
          : hub.fetch(url, init)) as unknown as typeof globalThis.fetch,
      memoryGb: 8,
      command: FAKE,
      models: [model],
    });
    expect(local.status().models[0]?.state).toBe("absent");
    expect(local.status().engine.state).toBe("absent");
    local.download("tiny");
    while (
      local.status().models[0]?.state === "downloading" ||
      local.status().engine.state === "downloading"
    )
      await Bun.sleep(5);
    expect(local.status().models[0]).toMatchObject({ state: "ready", received: bytes.length });
    expect(local.status().engine.state).toBe("ready");

    const url = await local.endpoint("tiny");
    expect(local.status().running).toEqual({ model: "tiny", state: "ready" });
    const reply = await fetch(`${url}/chat/completions`, { method: "POST", body: "{}" });
    expect(await reply.text()).toContain("hello from tiny");

    await local.remove("tiny");
    expect(local.status().models[0]?.state).toBe("absent");
    expect(local.status().running).toBeNull();
  });

  test("a cancelled download is paused and can be resumed", async () => {
    const modelsDir = tmp();
    writeFileSync(partFile(join(modelsDir, "tiny.gguf")), bytes.slice(0, 500));
    const local = createLocalLlm({
      engine: null,
      modelsDir,
      enginesDir: tmp(),
      fetch: server().fetch,
      memoryGb: 8,
      models: [model],
    });
    expect(local.status()).toMatchObject({
      available: false,
      models: [{ state: "paused", received: 500 }],
    });
  });
});
