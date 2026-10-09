// Builds the speech engines for this machine (08; native/CLAUDE.md), each at the version pinned in its
// folder's VERSION, as one self-contained file written to <engine>/out/<program>-<target triple>, where
// the server finds it and build:cli copies it beside the binary:
// - whisper.cpp's `whisper-server` (recognition): static, Metal on macOS with its shaders embedded;
// - sherpa-onnx's `sherpa-onnx-offline-tts` (reading aloud with Piper voices): static, ONNX Runtime in.
// The sources and builds live in ~/.cache/sprachanker, out of the repository (their own tests must not
// run with ours). Needs git, cmake and a C++ toolchain.
//   bun native/scripts/build.ts [whisper|piper]
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

const cache = join(homedir(), ".cache", "sprachanker");
const triple = `${process.arch === "arm64" ? "aarch64" : "x86_64"}-${
  process.platform === "darwin"
    ? "apple-darwin"
    : process.platform === "win32"
      ? "pc-windows-msvc"
      : "unknown-linux-gnu"
}`;

/** The pinned sources of an engine, cloned aside and moved into place when whole (an interrupted
 *  clone is not taken for the sources). */
async function sources(repo: string, name: string, version: string) {
  const src = join(cache, `${name}-${version}`);
  if (!existsSync(src)) {
    mkdirSync(cache, { recursive: true });
    const part = `${src}.part`;
    rmSync(part, { recursive: true, force: true });
    await $`git clone --depth 1 --branch ${version} ${repo} ${part}`;
    renameSync(part, src);
  }
  return src;
}

/** Builds one target of an engine and puts it in the engine's out/ folder. */
async function build(engine: string, repo: string, target: string, flags: string[]) {
  const root = join(import.meta.dir, "..", engine);
  const version = readFileSync(join(root, "VERSION"), "utf8").trim();
  const src = await sources(repo, repo.split("/").at(-1) ?? engine, version);
  await $`cmake -S ${src} -B ${join(src, "build")} -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF ${flags}`;
  await $`cmake --build ${join(src, "build")} --config Release --target ${target} -j`;
  mkdirSync(join(root, "out"), { recursive: true });
  const out = join(root, "out", `${target}-${triple}`);
  copyFileSync(join(src, "build", "bin", target), out);
  console.log(`${target} ${version} → ${out}`);
}

const only = process.argv[2];
if (!only || only === "whisper")
  await build("whisper", "https://github.com/ggml-org/whisper.cpp", "whisper-server", [
    "-DWHISPER_BUILD_SERVER=ON",
    "-DWHISPER_BUILD_EXAMPLES=ON",
    "-DWHISPER_BUILD_TESTS=OFF",
    "-DWHISPER_SDL2=OFF",
    ...(process.platform === "darwin" ? ["-DGGML_METAL=ON", "-DGGML_METAL_EMBED_LIBRARY=ON"] : []),
  ]);
if (!only || only === "piper")
  await build("piper", "https://github.com/k2-fsa/sherpa-onnx", "sherpa-onnx-offline-tts", [
    "-DSHERPA_ONNX_ENABLE_PYTHON=OFF",
    "-DSHERPA_ONNX_ENABLE_TESTS=OFF",
    "-DSHERPA_ONNX_ENABLE_CHECK=OFF",
    "-DSHERPA_ONNX_ENABLE_PORTAUDIO=OFF",
    "-DSHERPA_ONNX_ENABLE_WEBSOCKET=OFF",
    "-DSHERPA_ONNX_ENABLE_BINARY=ON",
  ]);
