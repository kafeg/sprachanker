// mlx-lm: Apple's MLX runtime (MLX models, Apple Silicon with macOS 14+). It is a Python package, so the
// engine is a private Python environment: the pinned `uv` binary installs Python 3.12 and the hashed lock
// (mlx-requirements.txt) into the data root; nothing touches a system Python.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";
import { download } from "../../jobs/download.ts";
import { type Engine, engineDir, findFile, run, untar } from "./engine.ts";
import lock from "./mlx-requirements.txt" with { type: "text" };

export const MLX_LM_VERSION = "0.32.0";

const UV = {
  version: "0.12.23",
  file: "uv-aarch64-apple-darwin.tar.gz",
  size: 17044217,
  sha256: "50487ae565ccd96e499056b4674d438f4c53170202617b4c759defe0c6a1b544",
};

/** Apple Silicon with macOS 14 (Darwin 23) or newer: what the MLX wheels are built for. */
export const mlxSupported = (
  platform = process.platform,
  arch = process.arch,
  darwin = release(),
) => platform === "darwin" && arch === "arm64" && Number(darwin.split(".")[0]) >= 23;

export function mlxEngine(root: string, available = mlxSupported()): Engine {
  const dir = engineDir(root, "mlx-lm", MLX_LM_VERSION);
  const marker = join(dir, ".installed");
  const python = join(dir, "venv", "bin", "python");
  return {
    id: "mlx",
    format: "mlx",
    version: MLX_LM_VERSION,
    installSize: 350e6,
    downloadSize: UV.size,
    available,
    installed: () => existsSync(marker),
    async install({ fetch, signal, onProgress }) {
      if (!available) throw new Error("MLX needs Apple Silicon with macOS 14 or newer");
      // Built in place (the venv records absolute paths); `.installed` is written last, so an
      // interrupted install is started again from scratch.
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const archive = join(dir, UV.file);
      await download({
        url: `https://github.com/astral-sh/uv/releases/download/${UV.version}/${UV.file}`,
        dest: archive,
        size: UV.size,
        sha256: UV.sha256,
        fetch,
        signal,
        onProgress: (received) => onProgress({ received, phase: "download" }),
      });
      onProgress({ received: UV.size, phase: "setup" });
      await untar(archive, dir);
      const uvPath = findFile(dir, "uv");
      if (!uvPath) throw new Error(`${UV.file}: no uv inside`);
      const uv = join(dir, uvPath);
      // Everything uv fetches (Python, packages, its cache) stays inside the engine folder.
      const env = {
        UV_PYTHON_INSTALL_DIR: join(dir, "python"),
        UV_CACHE_DIR: join(dir, "cache"),
        UV_NO_CONFIG: "1",
      };
      await run([uv, "venv", "--python", "3.12", "--managed-python", join(dir, "venv")], env);
      writeFileSync(join(dir, "requirements.txt"), lock);
      await run(
        [
          uv,
          "pip",
          "install",
          "--python",
          join(dir, "venv", "bin", "python"),
          "--require-hashes",
          "--no-deps",
          "-r",
          join(dir, "requirements.txt"),
        ],
        env,
      );
      rmSync(join(dir, "cache"), { recursive: true, force: true });
      rmSync(archive, { force: true });
      writeFileSync(marker, `${MLX_LM_VERSION}\n`);
    },
    serve(model, port) {
      return {
        argv: [
          python,
          "-m",
          "mlx_lm",
          "server",
          "--model",
          model,
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          "--max-tokens",
          "2048",
          "--chat-template-args",
          JSON.stringify({ enable_thinking: false }),
        ],
        cwd: dir,
        // Only the model folder given here is served; never fetch models from the Hub.
        env: { HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" },
        // mlx_lm.server's name for the model given on the command line.
        requestModel: "default_model",
      };
    },
  };
}
