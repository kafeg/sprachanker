# 06 — Server, network, desktop shell, CLI

## Server (`packages/server`)

One process (Bun) started by `sprachanker serve`. The `sprachanker` binary is built from `apps/cli` with
`bun build --compile` (runtime included); the desktop app bundles this same binary. The server:

- serves the web app (static build of `apps/web`) and the JSON API;
- owns `server.sqlite` and all `profile.sqlite` files (05);
- serves library media with HTTP Range support (video seeking);
- runs jobs (course import, model downloads, rebuilds) with progress via Server-Sent Events;
- supervises sidecar processes: `whisper-server`, Piper, `llama-server` (built-in LLM runtime);
- talks to LLM and speech providers through `packages/llm` and `packages/speech`.

Framework: Hono + zod validation; Drizzle on `bun:sqlite`. Code stays runtime-agnostic so the server
can run on Node with a different SQLite driver if Bun causes problems on some platform.

**Headless mode**: `sprachanker serve --data <root> --listen …` runs the same server without the
desktop shell (home server, Mac mini, Linux box). Process supervision lives in the server, not in the
shell, so headless mode has all features.

## API outline

REST-ish JSON under `/api`, typed with zod schemas shared via `packages/schema`; streaming via SSE.

- `auth`: list profiles (names only), create profile (if registration enabled), login (profile + PIN),
  pair device (token), logout, current profile.
- `catalog`: entries, installed state, install/update/add-edition/remove (owner) → job.
- `lessons/:key` → composed lesson (04) for the current profile and its edition.
- `runs`: start (lesson / exam / review / practice / scene / chat), append events (batched, idempotent by
  event id), finish, abandon, take over (move to this device), **resume** (latest active run of a context
  with its position — continues on any device, also after iOS unloads the PWA).
- `exams/:key/start` → run with drawn questions in `plan_json`; the server enforces the time limit and
  finishes the run with `timeout`.
- `review/start` → run with the session's cards and weak-rule items in `plan_json`.
- `practice` → create a practice run from a selection (`itemKeys[]`, `ruleIds[]`, period) with
  `parent_run_id`.
- `notebook`: lessons with their runs; run detail with events and snapshots; item history
  (`item_stats` + answers); rule history; word history; recordings.
- `cards`, `decks`: CRUD, import/export `.apkg`, image candidates; `stats`: rule mastery, lexemes,
  can-do, study days.
- `llm`: check answer, scene turn, chat turn (SSE streaming), handoff prompt; `llm/providers` test.
- `speech`: transcribe (upload WAV, `lang`), synthesise (text segments with language) → audio URL.
- `settings`: profile settings, secrets (write-only), routes; `server/*`: owner-only settings, models,
  sidecar status, network, logs.
- `media/*`: library blobs and profile media, Range-enabled.
- `jobs/:id/events`: SSE progress.

## Profiles and access

- Profiles are separation, not security. Optional 4–8 digit PIN, rate-limited attempts.
- **Owner** = the first profile, created through the owner setup link (below) at first start.
  Owner-only: library path, course install and removal, network exposure, registration toggle, models
  and sidecars, other profiles' deletion. Owner screens are available on the **owner device** (the desktop
  app, which receives its device token from the server at start-up) and on other devices only after
  entering the owner PIN. Access is never granted by source address: `tailscale serve` and reverse
  proxies make remote requests look local. A headless server requires an owner PIN.
- Registration from the PWA ("new profile": name + optional PIN) is allowed by default on a
  freshly-configured server; the owner can disable it.
- Devices get a long-lived token (HTTP-only cookie). Pairing a phone: QR code on desktop encodes server
  URL + one-time pairing code.
- API keys are write-only through the API; stored encrypted (05); only the server uses them.

## Network and HTTPS

- Default: listen on `127.0.0.1` only. The owner enables network access explicitly.
- Options shown in onboarding and settings (none is required; a built-in local CA option is "later"):
  1. **Tailscale**: `tailscale serve` publishes the local server over HTTPS at
     `https://<machine>.<tailnet>.ts.net` (valid certificate, works anywhere in the tailnet). It proxies to
     `127.0.0.1`, so the server itself can stay localhost-only. Recommended.
  2. **Own domain / VPN**: user-provided certificate (e.g. Let's Encrypt) or reverse proxy.
  3. **Plain HTTP on LAN**: the app opens and can be added to the Home Screen, but there is no secure
     context: **no microphone**, no service worker (and no notifications later). The UI warns and
     disables speech features.
- A self-signed certificate that the device does not trust is not a valid option (no secure context).
- Permissions (microphone) are per origin: each address is a different app for the phone; onboarding asks
  the user to pick one primary address.
- PWA: installable (manifest, icons, minimal service worker for app shell). Offline use is out of scope
  for v1; the UI shows a clear "server unreachable" state.

## Models and sidecars

- **whisper-server** (whisper.cpp): started on demand, kept warm; model files in `<app-data>/models`.
- **Piper**: started on demand; voices downloaded per language.
- **llama-server** (llama.cpp, built-in LLM runtime, optional, after MVP): the Models screen lists recommended GGUF
  models with size and memory needs, downloads from Hugging Face, starts/stops, unloads on idle. Only one
  local LLM runtime is loaded at a time; if the user routes tasks to an external provider (LM Studio,
  Ollama…), the built-in runtime stays stopped. MLX models are used via LM Studio in v1; a built-in MLX
  runtime is "later".
- Status endpoint: running, model, memory (RSS), last latency, errors. The UI warns when the chosen set
  exceeds available memory.
- Binaries are platform-specific builds from `native/` (08), bundled with the desktop app.

## Desktop shell (`apps/desktop`, Tauri 2)

- Starts `sprachanker serve` as a sidecar with the data root, waits for health, opens the window on the
  local URL. Stops it on quit (option: keep running in the tray as a server).
- Tray: status, open in browser, show phone QR, quit.
- First-run: choose data root (default under app-data), create owner profile, then onboarding (09).
- Auto-update via Tauri updater from GitHub Releases (stage 12).
- The shell holds no business logic.

## CLI (`apps/cli`)

`sprachanker <command>` — one binary for headless serving and tools; no UI.

- `serve` (headless) · `import <provider> [--courses] [--editions]` · `verify [<series>]`
- `normalise <series>` (rebuild canonical/locale from raw, offline)
- `export-profile`, `import-profile`, `export-anki <deck>`
- `rebuild <profile>` (derived tables)
- Authoring: `enrich draft <lessonKey>` (LLM drafts enrichment from installed content for human review),
  `enrich check` (keys and fingerprints of all enrichment match the installed library),
  `prompts test --route <provider:model>` (golden tests, 07)

## Failure handling

| Situation | Behaviour |
|---|---|
| Import interrupted / network error | job ends `failed` with report; partial downloads resume next time; nothing becomes visible until normalise + verify pass |
| Source returns 403/429 | stop that host, report, suggest running from a home connection / later |
| Disk full | job fails before writing manifests; temporary files removed on next start; UI shows free space needed |
| Sidecar crash | supervisor restarts with backoff (3 tries), then marks it failed; features depending on it degrade with a clear message |
| LLM unreachable / invalid output | fallback route, then graceful degradation (07); the answer is stored, the verdict can be retried later |
| Corrupt library file | edition marked broken by `verify`; offer re-normalise (offline) or re-fetch |
| DB migration fails | restore the pre-migration backup automatically; refuse to start with an explanation |
| Phone loses connection mid-lesson | client keeps unsent events in memory and retries with the same ids; UI shows "offline — reconnecting" |

## Security

Threat model: a home network or tailnet with trusted people; the goal is to avoid accidental exposure and
common web attacks, not to resist a determined attacker on the LAN.

- **Owner bootstrap** (one mechanism for MVP and desktop): when no owner device exists, or on
  `sprachanker owner-link`, the server creates a random one-time secret (valid 15 minutes) and prints an
  owner setup link `http://127.0.0.1:<port>/owner/<secret>` to the console. Opening it creates the owner
  profile on first start (name, optional PIN, languages) or re-attaches the owner, and sets the owner
  device cookie. The desktop app does the same automatically: it passes the secret to `sprachanker serve`
  via environment variable and opens the window on that link. No owner access without this link or the
  owner PIN.
- **Cookies**: `HttpOnly`, `Secure` (when HTTPS), `SameSite=Strict`. Mutating requests also require a
  custom header (`X-SprachAnker: 1`) — CSRF protection; CORS allows only the app's own origin.
- **Device tokens**: 256-bit random, stored hashed, listed and revocable in settings. Pairing codes are
  one-time and expire after 5 minutes.
- **PIN**: hashed with argon2id; attempts rate-limited per profile and client (exponential backoff).
- **Secrets**: AES-256-GCM; key from the OS keychain when available (macOS Keychain via the desktop
  shell), otherwise a key file with `0600` permissions in app-data.
- **Content rendering**: course HTML is sanitised at normalisation (allow-list, 02) and rendered
  without scripts; markdown from enrichment and LLM output is rendered with raw HTML disabled; CSP
  forbids inline scripts.
- **Media routes** accept only blob hashes and profile file ids — never paths — so traversal is
  impossible.
- **Downloads** (models, voices, native binaries): HTTPS only, sha256 pinned in manifests, verified
  before use.
- **LLM**: course text and learner input are passed as delimited data, never as instructions; chat tools
  are scoped to the current profile and write tools need confirmation in the UI (07); LLM output is
  validated against schemas and never executed.

## Logging and errors

Structured logs to `<app-data>/logs`, rotated. No telemetry. Errors shown in UI with an action
("retry", "open settings"), never raw stack traces.
