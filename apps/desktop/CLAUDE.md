# apps/desktop

Tauri 2 shell. Spec: `docs/spec/06-server.md` (desktop shell section).
Knows only the `sprachanker` binary (built from `apps/cli`) and its CLI flags; contains no business logic.

## Layout (target)

```
src-tauri/
  tauri.conf.json      # externalBin: `sprachanker` + native sidecar binaries per target triple
  src/main.rs          # run `sprachanker serve`, wait for /health, open window, tray, quit handling
  binaries/            # build outputs copied here by scripts (not committed)
scripts/
  bundle-sidecars.ts   # compile apps/cli with `bun build --compile`, copy native builds with target suffixes
```

## Rules

- Keep Rust minimal: process start/stop, window, tray, updater. Everything else via the local API.
- Sidecar supervision (whisper, piper, llama) is the server's job so headless mode has the same features.
- Never bundle model files or course content.
