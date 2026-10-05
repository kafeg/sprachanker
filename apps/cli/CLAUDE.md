# apps/cli

The `sprachanker` binary. Spec: `docs/spec/06-server.md` (CLI, binary build). Depends on
`packages/server` only; commands call the server's programmatic API.

## Layout

```
src/main.ts         # serve, import; main(argv, embedded?) — also runs from sources
scripts/build.ts    # bun run build:cli: embeds the web build, compiles dist/sprachanker
```

## Rules

- Commands stay thin: parse flags, call `@sprachanker/server`, print the result.
- Anything the binary needs at runtime (web build, later migrations and YAML) is embedded by
  importing it `with { type: "file" }` from the generated entry, never read relative to the binary
  or the working directory. `bun run e2e` proves this by starting the binary from a temp folder.
- Bun stores embedded files under `/$bunfs/root/` with a hash in the name; pass the import's path
  value on, never construct embedded paths.
- `bun run cli -- <command>` runs from sources; `serve` then reads the last web build from disk.
