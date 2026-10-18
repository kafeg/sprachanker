# native/

Platform builds of C/C++ engines used as sidecars — on the computer (macOS, Windows, Linux), and
Piper's and Qwen3-TTS's for Android phones (the phone app runs them as programs; its Whisper is linked
into the app).

## Layout

```
whisper/   # VERSION (the whisper.cpp tag); out/ (the binary, whisper-server-<target triple>) is not
           # committed; the clone and its build are in ~/.cache/sprachanker
piper/     # VERSION (the sherpa-onnx tag: it runs Piper's voices); out/
           # (sherpa-onnx-offline-tts-<target triple>) is not committed
qwen/      # VERSION (a qwentts.cpp commit: it has no tags); out/ (tts-server-<target triple>) is not
           # committed
scripts/   # build.ts (`bun run build:speech [whisper|piper|qwen]`): clones each pinned tag or commit
           # with submodules, builds whisper-server and tts-server static with Metal and embedded
           # shaders on macOS (on the CPU on Windows and Linux: x64 for any CPU with AVX2, no OpenMP,
           # Windows' C runtime linked in, `.exe`) and sherpa-onnx-offline-tts static, writes them to
           # <engine>/out/;
           # build:cli runs it and copies them beside the sprachanker binary. The engines (folder, program) and
           # the target triple are the server's (packages/server/src/runtime/engines.ts); macOS 13
           # and later. `build.ts android [whisper|piper|qwen]`: Whisper's static libraries (the app
           # links them; with Ninja, in build-android-arm64) and the same programs for arm64 phones with the
           # NDK (stripped, <program>-aarch64-linux-android, 16 KB pages too; sherpa-onnx with the
           # static ONNX Runtime its own Android build takes, its sha256 pinned; ggml with dot
           # product and fp16). tag.ts: the GitHub release an engine's build is kept in (its
           # version and build.ts's hash; a file per system) — `.github/workflows/engines.yml` builds
           # an engine on each system while its release lacks that system's file, the Release
           # workflow downloads them
```

## Rules

- Pin exact upstream versions; record them in each folder's `VERSION` file. A new version (or a new
  dependency of its build): its entry in `scripts/notices/inventory.ts` too — what it links, each
  licence text from its sources; `bun run check` fails until they match.
- A new whisper.cpp (`whisper/VERSION`): measure the silence thresholds again (`bun run speech:levels`,
  `e2e/speech/levels.ts`) — `avg_logprob` is whisper.cpp's own computation (the non-special tokens'
  log probabilities summed, over all tokens) and the server's thresholds are set by it
  (`packages/server/src/services/silence.ts`).
- Builds are reproducible from scripts.
- sherpa-onnx links a prebuilt static ONNX Runtime: on Linux x64 built for glibc 2.17 with the old C++ ABI
  (so Piper is compiled with `_GLIBCXX_USE_CXX11_ABI=0` there, else it aborts on its first reading); on
  Windows built with a newer Visual Studio than 17.12 (an older one cannot link it; the runners' can).
- The x64 engines need AVX2: on a CPU without it (an old PC, a VM whose CPU type hides it) they stop at
  their first model.
- Model and voice files are downloaded at runtime by the server, never committed or bundled.
- The server talks to these binaries only over their HTTP/stdio interfaces.
