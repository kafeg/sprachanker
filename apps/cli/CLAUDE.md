# apps/cli

The `sprachanker` binary. Depends on `packages/server` only; commands call the server's programmatic API.

## Layout

```
src/main.ts         # serve (--experimental or $SPRACHANKER_EXPERIMENTAL=1: docs/decisions.md), import, verify, profiles (the server's profile matters: list, registration
                    # on|off, delete; a profile exported to a file, a file imported — the server's
                    # refusals in words), courses (those installed; one exported to a file, or
                    # every one with --all: a file a group, checked that each course is in one; a file
                    # imported, each course of it said; one removed — the server's refusals in words), practice
                    # (a course's AI practice made for every lesson by a profile's model: steps,
                    # count 1–3; --status), heard (a course's recordings of the source's answers heard
                    # by Whisper into it; --again), backup, version; main(argv, embedded?) — also
                    # runs from sources
src/version.ts      # the version reported: set when compiled, counted from git from the sources
install.sh          # the installer published with each release (curl … | bash): a Mac with Apple Silicon
                    # or Linux on x64; the program into ~/SprachAnker/bin, a LaunchAgent or a systemd
                    # user unit, a backup before an update; run again it keeps the folder, port and
                    # address it set (the update command About shows; README's Install; docs/decisions.md)
scripts/version.ts  # the app's version: MAJOR.MINOR of package.json, the commit count third (printed when run;
                    # the desktop's and the phone's builds take it too)
scripts/build.ts    # bun run build:bin (build:cli after build:speech): embeds the web build, compiles dist/sprachanker
                    # (sprachanker.exe on Windows) with the version
                    # (the server's profile-db Worker a second entry, its name handed in), copies the
                    # speech engines built in native/ beside it (whisper-server, Piper's
                    # sherpa-onnx-offline-tts, Qwen3-TTS's tts-server); THIRD_PARTY_NOTICES.txt
                    # (scripts/notices) written into the web build first, then beside the binary
```

## Planned

- `normalise <series>`, `enrich check` (plan).

## Rules

- Commands stay thin: parse flags, call `@sprachanker/server`, print the result.
- Anything the binary needs at runtime is embedded, never read relative to the binary or the working
  directory (the one exception: the speech engines, separate programs beside it): the web build by importing it `with { type: "file" }` from the generated entry,
  migrations through the server's own text imports. `bun run e2e` proves this by starting the binary
  from a temp folder.
- Bun stores embedded files under `/$bunfs/root/` with a hash in the name; pass the import's path
  value on, never construct embedded paths.
- `bun run cli -- <command>` runs from sources; `serve` then reads the last web build from disk.
