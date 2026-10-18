# apps/desktop

The desktop app (Tauri 2) for macOS (Apple Silicon), Windows and Linux (x64): a window around the
`sprachanker` server it bundles and runs, which updates itself. Knows only the binary (built from
`apps/cli`), its CLI flags and what it leaves on disk (`server.pid`, the installer's service); no
business logic. Why it is so (the app is the server, no signing, how it updates):
`docs/decisions.md`, its lines on the desktop app and on updates.

## Layout

```
src-tauri/
  src/main.rs          # the server started on ~/SprachAnker beside this program (SPRACHANKER_DESKTOP set:
                       # it says the app updates it), restarted if it stops, stopped when the app quits;
                       # the installer's service for the folder taken over (its port and address kept in
                       # desktop.json there; else 4580, all addresses), a server left on the folder stopped;
                       # the window: the start page, then the server's once this app's server answers
                       # /api/health (its pid the folder's server.pid), the start page with why when it keeps
                       # stopping; other sites in the browser, downloads to Downloads, the microphone for the
                       # server's page; closed, it hides (tray: open, in the browser, quit); started at login
                       # when installed, hidden; a second start shows the first
  src/system.rs        # what differs by system: home, the log's place, the installer's service (macOS: its
                       # LaunchAgent; Linux: its systemd user unit; Windows: none), a process named and
                       # stopped (SIGTERM; Windows: taskkill, no console window), whether installed
  src/update.rs        # `install_update`: Tauri's updater — latest.json at the latest release, a later
                       # version only, the file checked against the key and its signed version —, installed,
                       # the app started again (on Windows the server stopped first)
  capabilities/update.json # the page of the app's own server (127.0.0.1) may call install_update, nothing else
  build.rs             # Tauri's build (the app's command named: an app manifest); the shell's words: the web
                       # catalogs' `desktop` section, embedded
  tauri.conf.json      # app.sprachanker.desktop (its version given by the build: the binary's); externalBin: the
                       # binary and the engines; the updater's endpoint and public key; signed ad hoc on macOS
  Info.plist           # the microphone's question (English; the build adds each catalog's language)
  icons/               # from icons/app-icon.png (apps/web/scripts/icons.ts: macOS's grid), `tauri icon`
www/index.html         # the start page: the name and a spinner; why the server did not start (after #)
scripts/build.ts       # the app for this system from apps/cli/dist (build:bin's) — the sidecars copied into
                       # src-tauri/binaries first, not committed; the notices (and on macOS each catalog's
                       # microphone question) as resources —, then dist/: SprachAnker-<version>-<system>-<arch>
                       # .zip and .dmg (macOS), -setup.exe (Windows, NSIS), .deb (Linux); with
                       # TAURI_SIGNING_PRIVATE_KEY each update file signed beside it (.sig; macOS: .app.tar.gz)
scripts/latest.ts      # latest.json from a release's signed files (the release workflow's last job)
test/                  # latest.json's making
```

## Build and run

- `bun run build:desktop` (root): the binary, then the app. Needs Rust (rustup) and the speech
  engines built once (`bun run build:speech`); on Linux WebKitGTK's development files (the release
  workflow's list); Tauri's command line comes from package.json.
- `SPRACHANKER_HOME`, `SPRACHANKER_PORT`, `SPRACHANKER_HOST` move the server (as the installer reads
  them). A run with `SPRACHANKER_HOME` set (a test's: `SprachAnker.app/Contents/MacOS/sprachanker-desktop`
  with it) is a second app: no single instance, no login start, the installer's service left alone.
- The server's log: `~/Library/Logs/SprachAnker/serve.log` (Windows: `%LOCALAPPDATA%\SprachAnker`,
  Linux: `~/.local/state/sprachanker`); a test run's: `<SPRACHANKER_HOME>/serve.log`.
- The updater tried locally: a build with `--config` setting `plugins.updater.endpoints` to a local
  latest.json and `dangerousInsecureTransportProtocol: true`, never in a release. The updater refuses
  an app whose path runs through a symlink (macOS's `/tmp`: use `/private/tmp`).
- A release (`.github/workflows/release.yml`) builds the app on each system on the e2e's build;
  `deploy-local` replaces `/Applications/SprachAnker.app` when it is there.

## Rules

- Keep Rust minimal: process start/stop, window, tray, the update. Everything else via the local API.
- What differs by system goes into system.rs; main.rs stays the same everywhere.
- The server refuses a port something answers on at 127.0.0.1 (a dev server beside the app would
  otherwise share it and take the window); the window trusts only its own server's answer.
- The page may call one command, `install_update`, and only the server's page (capabilities/); a new
  command needs its own reason and capability.
- Supervising the speech engines (whisper-server, Qwen3-TTS's tts-server; Piper runs per text) is
  the server's job, so headless `serve` has the same features.
- The main binary is `sprachanker-desktop`: macOS's file names ignore case, and `SprachAnker` would be
  the server's `sprachanker`.
- macOS: no hardened runtime (an ad hoc signature; Bun's JIT and the microphone would need entitlements).
- Never bundle model files or course content.
