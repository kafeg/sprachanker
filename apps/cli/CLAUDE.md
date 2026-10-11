# apps/cli

The `sprachanker` binary. Spec: `docs/spec/06-server.md` (CLI, binary build). Depends on
`packages/server` only; commands call the server's programmatic API.

## Layout

```
src/main.ts         # serve, import, verify, profiles (the server's profile matters: list, registration
                    # on|off, delete); main(argv, embedded?) — also runs from sources
scripts/build.ts    # bun run build:bin (build:cli after build:speech): embeds the web build, compiles dist/sprachanker, copies the
                    # speech engines built in native/ beside it (whisper-server, Piper's
                    # sherpa-onnx-offline-tts, Qwen3-TTS's tts-server)
```

## Planned

- `normalise <series>`, profile export and import, `enrich check` (plan; 06, "CLI").

## Rules

- Commands stay thin: parse flags, call `@sprachanker/server`, print the result.
- Anything the binary needs at runtime is embedded, never read relative to the binary or the working
  directory (the one exception: the speech engines, separate programs beside it, 08): the web build by importing it `with { type: "file" }` from the generated entry,
  migrations through the server's own text imports. `bun run e2e` proves this by starting the binary
  from a temp folder.
- Bun stores embedded files under `/$bunfs/root/` with a hash in the name; pass the import's path
  value on, never construct embedded paths.
- `bun run cli -- <command>` runs from sources; `serve` then reads the last web build from disk.
