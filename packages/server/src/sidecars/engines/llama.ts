// llama.cpp: the pinned official ggml-org release for the platform (GGUF models, every platform).
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { download } from "../../jobs/download.ts";
import { type Engine, engineDir, findFile, untar } from "./engine.ts";

export const LLAMA_BUILD = "b11430";

export interface LlamaAsset {
  url: string;
  file: string;
  size: number;
  sha256: string;
}

const ASSETS: Record<string, { name: string; size: number; sha256: string }> = {
  "darwin-arm64": {
    name: "macos-arm64.tar.gz",
    size: 11971255,
    sha256: "74887f462706d17b01ae701f1e3aa571afa7f629628445d9cdfac923b4fe5b74",
  },
  "darwin-x64": {
    name: "macos-x64.tar.gz",
    size: 11487400,
    sha256: "6fb60072de5c082c5d3fc5e20b7b2c30f6496a36757d6c70a541c55bd7a6803f",
  },
  "linux-x64": {
    name: "ubuntu-x64.tar.gz",
    size: 17693360,
    sha256: "1b898a3b23df35cc6c3e93c3adba5c63ec31d48bee8e5f30639e9372836ec2f2",
  },
  "linux-arm64": {
    name: "ubuntu-arm64.tar.gz",
    size: 13682382,
    sha256: "bf79c63d0bedebf3b26dcede1992ab65585dd2280e54a5d60196e7dd47a43f89",
  },
  "win32-x64": {
    name: "win-cpu-x64.zip",
    size: 19399499,
    sha256: "b608455b0109793f774537d63d15d4cf2098ddbc5b200ebc9a648e1d85369666",
  },
  "win32-arm64": {
    name: "win-cpu-arm64.zip",
    size: 12228804,
    sha256: "9e6620fd545c78f2f55bad508ee082b993c3065e7284e8ef5341936085320319",
  },
};

export function llamaAsset(
  platform = process.platform,
  arch = process.arch,
): LlamaAsset | undefined {
  const asset = ASSETS[`${platform}-${arch}`];
  if (!asset) return undefined;
  const file = `llama-${LLAMA_BUILD}-bin-${asset.name}`;
  return {
    url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}/${file}`,
    file,
    size: asset.size,
    sha256: asset.sha256,
  };
}

/** Context window the server is started with (enough for the tutor's lesson context). */
const CONTEXT = 8192;

export function llamaEngine(root: string, asset: LlamaAsset | undefined = llamaAsset()): Engine {
  const dir = engineDir(root, "llama.cpp", LLAMA_BUILD);
  const marker = join(dir, ".installed");
  const binary = () => join(dir, readFileSync(marker, "utf8").trim());
  return {
    id: "llama",
    format: "gguf",
    version: LLAMA_BUILD,
    installSize: 30e6,
    downloadSize: asset?.size ?? 0,
    available: !!asset,
    installed: () => existsSync(marker),
    async install({ fetch, signal, onProgress }) {
      if (!asset) throw new Error("no llama.cpp build for this platform");
      mkdirSync(root, { recursive: true });
      const archive = join(root, asset.file);
      if (!existsSync(archive)) {
        await download({
          ...asset,
          dest: archive,
          fetch,
          signal,
          onProgress: (received) => onProgress({ received, phase: "download" }),
        });
      }
      onProgress({ received: asset.size, phase: "setup" });
      const work = `${dir}.unpacking`;
      rmSync(work, { recursive: true, force: true });
      mkdirSync(work, { recursive: true });
      await untar(archive, work);
      const exe = process.platform === "win32" ? "llama-server.exe" : "llama-server";
      const found = findFile(work, exe);
      if (!found) throw new Error(`${asset.file}: no ${exe} inside`);
      rmSync(dir, { recursive: true, force: true });
      renameSync(work, dir);
      writeFileSync(marker, `${found}\n`);
      rmSync(archive, { force: true });
    },
    serve(model, port, alias) {
      const exe = binary();
      return {
        argv: [
          exe,
          "-m",
          model,
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          "-c",
          String(CONTEXT),
          // Learners get the answer at once; thinking would only add waiting (07).
          "--reasoning",
          "off",
          "--no-webui",
          "--alias",
          alias,
        ],
        cwd: dirname(exe),
        requestModel: alias,
      };
    },
  };
}
