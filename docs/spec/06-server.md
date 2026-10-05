# 06 — Server, network, desktop shell, CLI

## Server (`packages/server`)

One Bun process started by `sprachanker serve`. The `sprachanker` binary is built from `apps/cli` with
`bun build --compile`; the desktop app (stage 12) bundles the same binary. The server:

- serves the web app (static build of `apps/web`) and the JSON API;
- owns `server.sqlite` and all `profile.sqlite` files (05);
- serves library media with HTTP Range support;
- runs jobs (course import, model downloads) with progress via Server-Sent Events;
- supervises sidecar processes (`whisper-server`, TTS, later `llama-server`);
- talks to LLM providers through `packages/llm` and to speech sidecars through its speech module (08).

Hono + zod; Drizzle on `bun:sqlite`. Bun-specific APIs stay behind an adapter so a Node fallback stays
possible. Headless (`--data <root>`) and desktop modes have the same features.

## API outline

JSON under `/api`, typed with schemas from `packages/schema`; streaming via SSE. Exact endpoints are
fixed in the stage that builds them.

- `GET /api/health` → `{ "status": "ok" }` (desktop shell and tests wait for it). Unknown `/api/*`
  paths return a JSON 404, never the web app.
- Every other path serves the web build: existing files as they are (`/assets/*` hashed and
  `immutable`, the rest `no-cache`), extension-less paths fall back to `index.html` (client routes).

- `auth`: list profiles (names), create profile, login (profile + PIN) → device token, logout.
- `catalog`: entries, installed state, install / update / remove (owner) → job.
- `lessons/:key` → composed lesson for the current profile.
- `runs`: start, append events (batched, idempotent), finish, abandon, resume.
- `exams`, `review`, `practice`: start runs with a fixed `plan_json`; the server enforces exam time limits.
- `notebook`, `cards`, `stats`; `llm` (check, scene turn, chat turn via SSE); `speech` (transcribe,
  synthesise); `settings` (profile) and `server/*` (owner); `media/*`; `jobs/:id/events`.

## Profiles and access

- Profiles are separation, not security. Optional 4–8 digit PIN, rate-limited attempts.
- **Owner** = the first profile, created through the owner setup link (Security). Owner-only: library,
  course install and removal, network, registration toggle, sidecars and models, deleting other
  profiles. Owner screens need the owner device cookie or the owner PIN; access is never granted by
  source address (`tailscale serve` makes remote requests look local). The owner profile has a PIN
  whenever the server is reachable from other devices.
- New profiles can be created from the PWA (name + optional PIN) while registration is on; the owner
  can switch it off. The owner can reset another profile's PIN.
- Devices get a long-lived token (HTTP-only cookie).

## Network and HTTPS

- Default: listen on `127.0.0.1:4580` (`--host`, `--port`; later stored in config; a changed address is a
  new origin for the phone).
- Phone access options:
  1. **Tailscale** (recommended): `tailscale serve` publishes the local server over HTTPS at
     `https://<machine>.<tailnet>.ts.net`; the server can stay localhost-only.
  2. **Own domain / VPN** with a valid certificate or reverse proxy.
  3. **Plain HTTP on LAN**: works, but no secure context — no microphone; the UI says so and disables
     speech.
- PWA: installable (manifest, icons). Offline use is out of scope; the UI shows "server unreachable".
  Unsent events are kept in the client's IndexedDB and retried with the same ids.

## Sidecars and models

- `whisper-server` (whisper.cpp) started on demand, kept warm while in use; models in `<data-root>/models`.
- TTS engine (08), started on demand.
- Built-in LLM runtime (07): two engines, installed on first use into `<data-root>/engines/` —
  llama.cpp (pinned official release, unpacked with the system `tar`) and, on Apple Silicon with
  macOS 14+, mlx-lm (a private Python 3.12 environment set up by a pinned `uv` from a hashed lock;
  served offline). One model server at a time, started on the first request, replaced when another
  model or engine is chosen, stopped after 20 minutes without use and with the server. A start
  failure is shown with the engine's error line; the next request tries again.
- Crash → restart with backoff (3 tries) → marked failed; dependent features show a clear message.
- How binaries are obtained (own builds in `native/` or prebuilt) is decided in the stage 7 plan.

## Desktop shell (`apps/desktop`, Tauri 2, stage 12)

Starts `sprachanker serve` as a sidecar, waits for health, opens the window on the local URL; tray;
first-run; auto-update from GitHub Releases. No business logic in the shell. Signing and notarization
are decided in stage 12.

## CLI (`apps/cli`)

`serve [--data]` · `owner-link` · `import <provider> [--data] [--courses] [--editions] [--refresh]` · `verify [<series>]` ·
`normalise <series>` · `export-profile` / `import-profile` · `enrich check` ·
`prompts test --route <provider:model>` (07).

The data root is `--data`, else `$SPRACHANKER_DATA`, else `<app-data>/data` (05). `import` is
idempotent: stored pages and media are not fetched again (`--refresh` re-reads pages), then every
selected edition is normalised.

**Binary build.** `bun run build:cli` builds the web app, generates an entry that imports every web
file `with { type: "file" }` and compiles it with `Bun.build({ compile })` into one binary. Embedded
files live under `/$bunfs/root/` and are found through the import values (URL path → embedded path),
so the binary works from any folder; e2e runs it from a temp folder. Files that must keep their names
and folder (Drizzle migrations with `meta/_journal.json`) are embedded with
`naming.asset: "[dir]/[name].[ext]"`; `readdir`/`readFile` work inside `/$bunfs`, so the Drizzle
migrator can read the folder as is (verified in the stage 0 spike). YAML imports are parsed at build
time.

## Failure handling

| Situation | Behaviour |
|---|---|
| Import interrupted / network error | job `failed` with report; next run resumes; nothing visible until normalise + verify pass |
| Source returns 403/429 | stop that host, report |
| Disk full | job fails before writing the manifest; temporary files removed on next start |
| Corrupt library file | edition marked broken by `verify`; offer re-normalise or re-fetch |
| Sidecar crash | see Sidecars |
| LLM unreachable / invalid output | the answer is stored; graceful degradation (07); the verdict can be retried |
| DB migration fails | restore the pre-migration copy; refuse to start with an explanation |
| Phone loses connection | events stay in the IndexedDB outbox and are retried; UI shows "offline — reconnecting" |

## Security

Threat model: a home network or tailnet with trusted people; avoid accidental exposure and common web
attacks, not a determined attacker on the LAN.

- **Owner bootstrap**: when no owner exists, or on `sprachanker owner-link`, the server creates a
  one-time secret (15 minutes) and prints `http://127.0.0.1:<port>/owner/<secret>`. Opening it creates
  the owner profile (or re-attaches the owner) and sets the owner device cookie. The desktop app does
  this automatically.
- **Host check**: requests are accepted only for `localhost`, `127.0.0.1` and the configured public
  URLs (DNS-rebinding protection). No CORS (same-origin only).
- **Cookies**: `HttpOnly`, `SameSite=Strict`, `Secure` on HTTPS addresses. Mutating requests require the
  header `X-SprachAnker: 1`.
- **Tokens and PINs**: device tokens 256-bit random, stored hashed, revocable; PINs hashed with argon2id,
  attempts rate-limited.
- **Secrets**: AES-256-GCM with a key file (`0600`) in app-data; write-only through the API; never logged.
- **Content**: course HTML sanitised at normalisation; markdown rendered with raw HTML disabled; CSP
  without inline scripts.
- **Media routes** take a series and a manifest-listed media path (anything else is refused) or a file id; recordings are served only to their profile.
- **Downloads** (models, binaries): HTTPS, sha256 pinned, verified before use.
- **LLM**: course text and learner input are passed as delimited data; output is validated against
  schemas and never executed.

## Logging

Structured logs to `<app-data>/logs`, rotated. No telemetry. Errors in the UI come with an action
("retry", "open settings"), never raw stack traces.
