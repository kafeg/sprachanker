# native/

Platform builds of C/C++ engines used as sidecars. Specs: `docs/spec/08-speech.md`, `docs/spec/07-llm.md`.

## Layout (target)

```
whisper/   # whisper.cpp pinned as a git submodule or fetched by tag; CMake presets: metal, cuda, cpu → whisper-server
piper/     # Piper release binaries per platform + voices manifest (URLs, sha256)
scripts/   # build-all.ts: builds for current platform, writes binaries with target-triple suffix
```

## Rules

- Pin exact upstream versions; record them in each folder's `VERSION` file.
- Builds are reproducible from scripts; CI builds per platform on tags.
- Model and voice files are downloaded at runtime by the server, never committed or bundled.
- llama.cpp needs no build here: the server downloads the pinned official release
  (`packages/server/src/sidecars/llama-release.ts`). Own builds come here only if a backend is missing.
- The server talks to these binaries only over their HTTP/stdio interfaces.
