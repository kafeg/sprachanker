# native/

Platform builds of C/C++ engines used as sidecars. Spec: `docs/spec/08-speech.md`.

## Layout

```
whisper/   # VERSION (the whisper.cpp tag); out/ (the binary, whisper-server-<target triple>) is not
           # committed; the clone and its build are in ~/.cache/sprachanker
piper/     # VERSION (the sherpa-onnx tag: it runs Piper's voices); out/
           # (sherpa-onnx-offline-tts-<target triple>) is not committed
scripts/   # build.ts (`bun run build:speech [whisper|piper]`): clones each pinned tag, builds
           # whisper-server static with Metal and embedded shaders on macOS and sherpa-onnx-offline-tts
           # static, writes them to <engine>/out/; build:cli copies them beside the sprachanker binary
```

## Planned

- Qwen3-TTS, a native GGML build: plan, "Speech: synthesis".

## Rules

- Pin exact upstream versions; record them in each folder's `VERSION` file.
- Builds are reproducible from scripts.
- Model and voice files are downloaded at runtime by the server, never committed or bundled.
- The server talks to these binaries only over their HTTP/stdio interfaces.
