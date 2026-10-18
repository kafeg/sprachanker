# apps/desktop

The desktop app (Tauri 2), macOS on Apple Silicon for now: a window around the `sprachanker` server it
bundles and runs. Knows only the binary (built from `apps/cli`), its CLI flags and what it leaves on
disk (`server.pid`, the installer's LaunchAgent); no business logic.
Why it is so (the app is the server, no signing): `docs/decisions.md`, its lines on the desktop app.

## Layout

```
src-tauri/
  src/main.rs          # the server started on ~/SprachAnker beside this program, restarted if it stops,
                       # stopped (SIGTERM) when the app quits; the installer's LaunchAgent for the folder
                       # taken over (its port and address kept in desktop.json there; else 4580, all
                       # addresses), a server left on the folder stopped; the window: the start page,
                       # then the server's once this app's server answers /api/health (its pid the
                       # folder's server.pid), the start page with why when it keeps stopping; other
                       # sites in the browser, downloads to Downloads; closed, it hides (tray: open, in
                       # the browser, quit); started at login from Applications, hidden; a second start
                       # shows the first
  build.rs             # Tauri's build; the shell's words: the web catalogs' `desktop` section, embedded
  tauri.conf.json      # app.sprachanker.desktop (its version given by the build: the binary's); externalBin: the binary and the
                       # engines; signed ad hoc
  Info.plist           # the microphone's question (English; the build adds each catalog's language)
  icons/               # from icons/app-icon.png (apps/web/scripts/icons.ts: macOS's grid), `tauri icon`
www/index.html         # the start page: the name and a spinner; why the server did not start (after #)
scripts/build.ts       # the .app from apps/cli/dist (build:bin's) — the sidecars copied into
                       # src-tauri/binaries first, not committed —, each catalog's microphone question
                       # and build:bin's THIRD_PARTY_NOTICES.txt (Contents/Resources) in it, signed ad
                       # hoc, then dist/: SprachAnker-<version>-macos-<arch>.zip, .dmg
```

## Build and run

- `bun run build:desktop` (root): the binary, then the app. Needs Rust (rustup) and the speech
  engines built once (`bun run build:speech`); Tauri's command line comes from package.json.
- `SPRACHANKER_HOME`, `SPRACHANKER_PORT`, `SPRACHANKER_HOST` move the server (as the installer reads
  them). A run with `SPRACHANKER_HOME` set (a test's: `SprachAnker.app/Contents/MacOS/sprachanker-desktop`
  with it) is a second app: no single instance, no login start, the installer's LaunchAgent left alone.
- `"experimental": true` in `<home>/desktop.json` starts the server with `--experimental` (kept when
  the LaunchAgent is taken over; `SPRACHANKER_EXPERIMENTAL=1` reaches the server too).
- The server's log: `~/Library/Logs/SprachAnker/serve.log`.
- A release (`.github/workflows/release.yml`) builds the app on the e2e's build and attaches the zip
  and the dmg; `deploy-local` replaces `/Applications/SprachAnker.app` when it is there.

## Rules

- Keep Rust minimal: process start/stop, window, tray. Everything else via the local API.
- The server refuses a port something answers on at 127.0.0.1 (a dev server beside the app would
  otherwise share it and take the window); the window trusts only its own server's answer.
- Supervising the speech engines (whisper-server, Qwen3-TTS's tts-server; Piper runs per text) is
  the server's job, so headless `serve` has the same features.
- The main binary is `sprachanker-desktop`: macOS's file names ignore case, and `SprachAnker` would be
  the server's `sprachanker`.
- Never bundle model files or course content.

## Planned

- Windows and Linux (the engines built there; `docs/plan.md`, "Releases").
- Updates from the app.
