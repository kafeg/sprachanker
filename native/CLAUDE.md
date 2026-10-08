# native/

Platform builds of C/C++ engines used as sidecars. Spec: `docs/spec/08-speech.md`.

## Layout

```
whisper/   # VERSION (the whisper.cpp tag); out/ (the binary, whisper-server-<target triple>) is not
           # committed; the clone and its build are in ~/.cache/sprachanker
scripts/   # build.ts (`bun run build:speech`): clones the pinned tag, builds whisper-server static with
           # Metal and embedded shaders on macOS, writes it to whisper/out/; build:cli copies it beside
           # the sprachanker binary
```

## Planned

- A server-side TTS engine, Piper or Qwen3-TTS, with its voices manifest (URLs, sha256): plan,
  "Speech: synthesis".

## Rules

- Pin exact upstream versions; record them in each folder's `VERSION` file.
- Builds are reproducible from scripts.
- Model and voice files are downloaded at runtime by the server, never committed or bundled.
- The server talks to these binaries only over their HTTP/stdio interfaces.
