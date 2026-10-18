// Builds the speech engines for this machine (native/CLAUDE.md), each at the version pinned in its
// folder's VERSION, as one self-contained file written to <engine>/out/<program>-<target triple>, where
// the server finds it and build:cli copies it beside the binary:
// - whisper.cpp's `whisper-server` (recognition): static, Metal on macOS with its shaders embedded;
// - sherpa-onnx's `sherpa-onnx-offline-tts` (reading aloud with Piper voices): static, ONNX Runtime in;
// - qwentts.cpp's `tts-server` (reading aloud with Qwen3-TTS): static, Metal on macOS with its shaders
//   embedded; pinned by commit (the project has no tags).
// The sources and builds live in ~/.cache/sprachanker, out of the repository (their own tests must not
// run with ours). Needs git, cmake and a C++ toolchain.
//   bun native/scripts/build.ts [whisper|piper|qwen]
// For an Android phone (arm64, the NDK's toolchain: ANDROID_NDK_HOME or the SDK's newest): Piper's and
// Qwen3-TTS's programs, stripped, to <engine>/out/<program>-aarch64-linux-android — the phone app
// carries them as libraries and runs them as the server runs them here (apps/mobile/CLAUDE.md);
// Whisper runs in the app's own process there.
//   bun native/scripts/build.ts android [piper|qwen]
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { availableParallelism, homedir } from "node:os";
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

const android = process.argv[2] === "android";
/** The phone's target triple, as Rust names it. */
const ANDROID = "aarch64-linux-android";

/** The Android NDK: ANDROID_NDK_HOME, else the newest in the SDK. */
function ndk() {
  const sdk = join(homedir(), "Library", "Android", "sdk", "ndk");
  const found =
    process.env.ANDROID_NDK_HOME ??
    (existsSync(sdk) ? join(sdk, readdirSync(sdk).sort().at(-1) ?? "") : "");
  if (!found || !existsSync(found)) throw new Error("no Android NDK (set ANDROID_NDK_HOME)");
  return found;
}

/** Builds an engine's program and puts it in the engine's out/ folder — for a phone built in
 *  build-android-arm64 with the NDK's toolchain, stripped; `env`: what its build needs besides. */
async function build(
  engine: EngineName,
  repo: string,
  flags: string[],
  env: (src: string, dir: string) => Promise<Record<string, string>> = async () => ({}),
) {
  const { folder, program: target } = ENGINES[engine];
  const root = join(import.meta.dir, "..", folder);
  const version = readFileSync(join(root, "VERSION"), "utf8").trim();
  const src = await sources(repo, repo.split("/").at(-1) ?? engine, version);
  const dir = join(src, android ? "build-android-arm64" : "build");
  const phone = android
    ? [
        `-DCMAKE_TOOLCHAIN_FILE=${join(ndk(), "build", "cmake", "android.toolchain.cmake")}`,
        "-DANDROID_ABI=arm64-v8a",
        "-DANDROID_PLATFORM=android-28",
        // Phones with 16 KB memory pages run them too.
        "-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON",
      ]
    : [];
  const vars = { ...process.env, ...(await env(src, dir)) };
  await $`cmake -S ${src} -B ${dir} -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF ${phone} ${flags}`.env(
    vars,
  );
  // As many compilers as cores: a bare -j starts them all at once (a CI runner's memory runs out).
  await $`cmake --build ${dir} --config Release --target ${target} -j ${availableParallelism()}`.env(
    vars,
  );
  mkdirSync(join(root, "out"), { recursive: true });
  const out = join(root, "out", `${target}-${android ? ANDROID : triple}`);
  const built = [join(dir, "bin", target), join(dir, target)].find(existsSync);
  if (!built) throw new Error(`${target} not found in ${dir}`);
  if (android) {
    const hosts = join(ndk(), "toolchains", "llvm", "prebuilt");
    await $`${join(hosts, readdirSync(hosts)[0] ?? "", "bin", "llvm-strip")} -o ${out} ${built}`;
  } else copyFileSync(built, out);
  console.log(`${target} ${version} → ${out}`);
}

/** The sha256 of ONNX Runtime's static library for Android, by version (a prebuilt archive). */
const ONNX_RUNTIME_SHA256: Record<string, string> = {
  "1.28.2": "bc68410f35f13df82c260830bf476ee5565f5efd0ec7622297829a929613c6c0",
};

/** ONNX Runtime's static library for Android at the version the pinned sherpa-onnx's own Android
 *  build takes (its build-android-arm64-v8a.sh), from where that script downloads it, checked
 *  against its sha256 (a new version: add its sum above). */
async function onnxRuntimeAndroid(src: string, dir: string) {
  const script = readFileSync(join(src, "build-android-arm64-v8a.sh"), "utf8");
  const version = script.match(/SHERPA_ONNX_ONNXRUNTIME_VERSION:-([\d.]+)/)?.[1];
  if (!version) throw new Error("ONNX Runtime's version not found in sherpa-onnx's Android build");
  const name = `onnxruntime-android-arm64-v8a-static_lib-${version}`;
  const lib = join(dir, name);
  if (!existsSync(join(lib, "lib", "libonnxruntime.a"))) {
    mkdirSync(dir, { recursive: true });
    const zip = join(dir, `${name}.zip`);
    await $`curl -fsSL -o ${zip} https://github.com/csukuangfj/onnxruntime-libs/releases/download/v${version}/${name}.zip`;
    const sum = (await $`shasum -a 256 ${zip}`.text()).split(" ")[0];
    if (sum !== ONNX_RUNTIME_SHA256[version]) {
      rmSync(zip);
      throw new Error(`ONNX Runtime ${version}: sha256 ${sum}, not the one pinned`);
    }
    await $`unzip -q -o ${zip} -d ${dir}`;
    rmSync(zip);
  }
  return {
    SHERPA_ONNXRUNTIME_LIB_DIR: join(lib, "lib"),
    SHERPA_ONNXRUNTIME_INCLUDE_DIR: join(lib, "include"),
  };
}

const only = process.argv[android ? 3 : 2];
// macOS 13 and later, as the binary (else the macOS building them is the oldest they run on).
const macos =
  process.platform === "darwin" && !android ? ["-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0"] : [];
const metal = macos.length ? [...macos, "-DGGML_METAL=ON", "-DGGML_METAL_EMBED_LIBRARY=ON"] : [];
// A phone's ggml: ARM's dot product and fp16 (every arm64 phone of recent years; Whisper's alike).
const phoneGgml = [
  "-DGGML_OPENMP=OFF",
  "-DGGML_NATIVE=OFF",
  "-DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16",
];
if (!android && (!only || only === "whisper"))
  await build("whisper", "https://github.com/ggml-org/whisper.cpp", [
    "-DWHISPER_BUILD_SERVER=ON",
    "-DWHISPER_BUILD_EXAMPLES=ON",
    "-DWHISPER_BUILD_TESTS=OFF",
    "-DWHISPER_SDL2=OFF",
    ...metal,
  ]);
if (!only || only === "piper")
  await build(
    "piper",
    "https://github.com/k2-fsa/sherpa-onnx",
    [
      "-DSHERPA_ONNX_ENABLE_PYTHON=OFF",
      "-DSHERPA_ONNX_ENABLE_TESTS=OFF",
      "-DSHERPA_ONNX_ENABLE_CHECK=OFF",
      "-DSHERPA_ONNX_ENABLE_PORTAUDIO=OFF",
      "-DSHERPA_ONNX_ENABLE_WEBSOCKET=OFF",
      "-DSHERPA_ONNX_ENABLE_BINARY=ON",
      ...(android
        ? [
            // As sherpa-onnx's own Android build: its static ONNX Runtime has no NNAPI headers, which
            // its sources include from Android 27 on (the last -D given counts).
            "-DANDROID_PLATFORM=android-21",
            "-DSHERPA_ONNX_ENABLE_JNI=OFF",
            "-DSHERPA_ONNX_ENABLE_C_API=OFF",
            "-DSHERPA_ONNX_ENABLE_SPEAKER_DIARIZATION=OFF",
            "-DBUILD_PIPER_PHONMIZE_EXE=OFF",
            "-DBUILD_ESPEAK_NG_EXE=OFF",
          ]
        : macos),
    ],
    android ? onnxRuntimeAndroid : undefined,
  );
if (!only || only === "qwen")
  await build(
    "qwen",
    "https://github.com/ServeurpersoCom/qwentts.cpp",
    android ? phoneGgml : metal,
  );
