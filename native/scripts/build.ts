// Builds the speech engines for this machine (08; native/CLAUDE.md), each at the version pinned in its
// folder's VERSION, as one self-contained file written to <engine>/out/<program>-<target triple>, where
// the server finds it and build:cli copies it beside the binary:
// - whisper.cpp's `whisper-server` (recognition): static, Metal on macOS with its shaders embedded;
// - sherpa-onnx's `sherpa-onnx-offline-tts` (reading aloud with Piper voices): static, ONNX Runtime in;
// - qwentts.cpp's `tts-server` (reading aloud with Qwen3-TTS): static, Metal on macOS with its shaders
//   embedded; pinned by commit (the project has no tags).
// The sources and builds live in ~/.cache/sprachanker, out of the repository (their own tests must not
// run with ours). Needs git, cmake and a C++ toolchain.
//   bun native/scripts/build.ts [whisper|piper|qwen]
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
// The engines (folder, program) and the target triple, as the server finds them.
import { ENGINES, type EngineName, triple } from "../../packages/server/src/runtime/engines.ts";

const cache = join(homedir(), ".cache", "sprachanker");

/** The pinned sources of an engine (a tag, or a commit), with their submodules, cloned aside and
 *  moved into place when whole (an interrupted clone is not taken for the sources). */
async function sources(repo: string, name: string, version: string) {
  const commit = /^[0-9a-f]{40}$/.test(version);
  const src = join(cache, `${name}-${commit ? version.slice(0, 7) : version}`);
  if (!existsSync(src)) {
    mkdirSync(cache, { recursive: true });
    const part = `${src}.part`;
    rmSync(part, { recursive: true, force: true });
    if (commit) {
      await $`git clone ${repo} ${part}`;
      await $`git -C ${part} checkout -q ${version}`;
    } else await $`git clone --depth 1 --branch ${version} ${repo} ${part}`;
    await $`git -C ${part} submodule update --init --recursive -q`;
    renameSync(part, src);
  }
  return src;
}

/** Builds an engine's program and puts it in the engine's out/ folder. */
async function build(engine: EngineName, repo: string, flags: string[]) {
  const { folder, program: target } = ENGINES[engine];
  const root = join(import.meta.dir, "..", folder);
  const version = readFileSync(join(root, "VERSION"), "utf8").trim();
  const src = await sources(repo, repo.split("/").at(-1) ?? engine, version);
  await $`cmake -S ${src} -B ${join(src, "build")} -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF ${flags}`;
  await $`cmake --build ${join(src, "build")} --config Release --target ${target} -j`;
  mkdirSync(join(root, "out"), { recursive: true });
  const out = join(root, "out", `${target}-${triple}`);
  const built = [join(src, "build", "bin", target), join(src, "build", target)].find(existsSync);
  if (!built) throw new Error(`${target} not found in ${join(src, "build")}`);
  copyFileSync(built, out);
  console.log(`${target} ${version} → ${out}`);
}

const only = process.argv[2];
const metal =
  process.platform === "darwin" ? ["-DGGML_METAL=ON", "-DGGML_METAL_EMBED_LIBRARY=ON"] : [];
if (!only || only === "whisper")
  await build("whisper", "https://github.com/ggml-org/whisper.cpp", [
    "-DWHISPER_BUILD_SERVER=ON",
    "-DWHISPER_BUILD_EXAMPLES=ON",
    "-DWHISPER_BUILD_TESTS=OFF",
    "-DWHISPER_SDL2=OFF",
    ...metal,
  ]);
if (!only || only === "piper")
  await build("piper", "https://github.com/k2-fsa/sherpa-onnx", [
    "-DSHERPA_ONNX_ENABLE_PYTHON=OFF",
    "-DSHERPA_ONNX_ENABLE_TESTS=OFF",
    "-DSHERPA_ONNX_ENABLE_CHECK=OFF",
    "-DSHERPA_ONNX_ENABLE_PORTAUDIO=OFF",
    "-DSHERPA_ONNX_ENABLE_WEBSOCKET=OFF",
    "-DSHERPA_ONNX_ENABLE_BINARY=ON",
  ]);
if (!only || only === "qwen")
  await build("qwen", "https://github.com/ServeurpersoCom/qwentts.cpp", metal);
