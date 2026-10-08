// Builds the speech engines for this machine (08; native/CLAUDE.md): whisper.cpp's `whisper-server`
// at the version pinned in whisper/VERSION — static, with Metal on macOS and its shaders embedded, so
// it is one file — written to whisper/out/whisper-server-<target triple>, where the server finds it
// (and the desktop app will bundle it). The sources and the build live in ~/.cache/sprachanker, out of
// the repository (its own tests must not run with ours). Needs git, cmake and a C++ toolchain.
//   bun native/scripts/build.ts
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

const root = join(import.meta.dir, "..", "whisper");
const version = readFileSync(join(root, "VERSION"), "utf8").trim();
const cache = join(homedir(), ".cache", "sprachanker");
const src = join(cache, `whisper.cpp-${version}`);
const triple = `${process.arch === "arm64" ? "aarch64" : "x86_64"}-${
  process.platform === "darwin"
    ? "apple-darwin"
    : process.platform === "win32"
      ? "pc-windows-msvc"
      : "unknown-linux-gnu"
}`;

// Cloned aside and moved into place when whole: an interrupted clone is not taken for the sources.
if (!existsSync(src)) {
  mkdirSync(cache, { recursive: true });
  const part = `${src}.part`;
  rmSync(part, { recursive: true, force: true });
  await $`git clone --depth 1 --branch ${version} https://github.com/ggml-org/whisper.cpp ${part}`;
  renameSync(part, src);
}
const metal =
  process.platform === "darwin" ? ["-DGGML_METAL=ON", "-DGGML_METAL_EMBED_LIBRARY=ON"] : [];
await $`cmake -S ${src} -B ${join(src, "build")} -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_SERVER=ON -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_BUILD_TESTS=OFF -DWHISPER_SDL2=OFF ${metal}`;
await $`cmake --build ${join(src, "build")} --config Release --target whisper-server -j`;
const out = join(root, "out");
mkdirSync(out, { recursive: true });
const target = join(out, `whisper-server-${triple}`);
copyFileSync(join(src, "build", "bin", "whisper-server"), target);
console.log(`whisper-server ${version} → ${target}`);
