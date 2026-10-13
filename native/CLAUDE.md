# native/

Platform builds of C/C++ engines used as sidecars.

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
           # shaders on macOS and sherpa-onnx-offline-tts static, writes them to <engine>/out/;
           # build:cli runs it and copies them beside the sprachanker binary. The engines (folder, program) and
           # the target triple are the server's (packages/server/src/runtime/engines.ts); macOS 13
           # and later. tag.ts: the GitHub release an engine's build is kept in (its version and
           # build.ts's hash) — `.github/workflows/engines.yml` builds an engine only while its
           # release is missing, the Release workflow downloads them
```

## Rules

- Pin exact upstream versions; record them in each folder's `VERSION` file.
- A new whisper.cpp (`whisper/VERSION`): measure the silence thresholds again (`bun run speech:levels`,
  `e2e/speech/levels.ts`) — `avg_logprob` is whisper.cpp's own computation (the non-special tokens'
  log probabilities summed, over all tokens) and the server's thresholds are set by it
  (`packages/server/src/services/silence.ts`).
- Builds are reproducible from scripts.
- Model and voice files are downloaded at runtime by the server, never committed or bundled.
- The server talks to these binaries only over their HTTP/stdio interfaces.
