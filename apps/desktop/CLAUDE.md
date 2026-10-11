# apps/desktop

Tauri 2 shell (planned). Spec: `docs/spec/06-server.md` (desktop shell section).
Knows only the `sprachanker` binary (built from `apps/cli`) and its CLI flags; contains no business logic.

## Planned (plan, "Desktop app")

```
src-tauri/
  tauri.conf.json      # externalBin: `sprachanker` + native sidecar binaries per target triple
  src/main.rs          # run `sprachanker serve`, wait for /api/health, open window, tray, quit handling
  binaries/            # build outputs copied here by scripts (not committed)
scripts/
  bundle-sidecars.ts   # run `bun run build:cli` (the app: the speech engines and the binary), copy it and native builds with target suffixes
```

## Rules

- Keep Rust minimal: process start/stop, window, tray, updater. Everything else via the local API.
- Supervising the speech engines (whisper-server, Qwen3-TTS's tts-server; Piper runs per text) is
  the server's job, so headless `serve` has the same features.
- Never bundle model files or course content.
