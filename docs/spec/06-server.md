# 06 — Server, network, desktop shell, CLI

## Server (`packages/server`)

One Bun process started by `sprachanker serve`. The `sprachanker` binary is built from `apps/cli` with
`bun build --compile`; the desktop app (stage 12) bundles the same binary. The server:

- serves the web app (static build of `apps/web`) and the JSON API;
- owns the `profile.sqlite` files (05; today one profile, `local`);
- serves library media with HTTP Range support;
- talks to LLM providers through `packages/llm`.

Course downloads run as background jobs (one at a time, queued; progress polled by the screens, no
SSE). A download is marked in its series folder while it runs (`.downloads/<course>.json`), kept with the
number of the course's media still missing or with the error it stopped on; a restart resumes only an
interrupted one, the others wait for "Continue downloading". Planned: `server.sqlite` (profiles, devices);
model downloads as jobs; supervising sidecars (`whisper-server`, TTS) and talking to them through a
speech module (08).

Hono + zod; Drizzle on `bun:sqlite`. Bun-specific APIs stay behind an adapter so a Node fallback stays
possible. Headless (`--data <root>`) and desktop modes have the same features.

## API

JSON under `/api`, validated with zod and typed for the web client through Hono RPC (`AppType`). Routes:
`packages/server/src/app.ts` and `packages/server/src/routes/llm.ts` (`/api/llm`). Exact endpoints of
later areas are fixed in the stage that builds them.

- `GET /api/health` → `{ "status": "ok", "version" }` (desktop shell and tests wait for it). Unknown `/api/*`
  paths return a JSON 404, never the web app.
- Content: `GET /api/courses` (installed courses with progress and the lesson to continue),
  `GET /api/course` (course map), `GET /api/lesson` (canonical + locale lesson),
  `GET /api/course/check` (the course verified: counts, media by kind and size, problems).
- Courses on disk: `GET /api/catalog` (every course the providers offer, with its state: available,
  queued, downloading, incomplete, ready), `GET` / `POST /api/downloads` (the jobs with progress and
  log; queue a download — first download, completing one and syncing with the source are the same
  idempotent import), `GET /api/storage` (the data folder and the space per series).
- Progress: `POST /api/progress/reset` (a course or one lesson, 05).
- Settings: `GET` / `PUT /api/settings` (one key at a time).
- Lesson runs: `POST /api/runs` (start or resume), `POST /api/runs/:id/events` (batched, idempotent;
  outcomes computed by the server), `POST /api/runs/:id/finish`.
- `/api/llm`: state, route and provider settings, models; LM Studio status, start and downloads;
  `explain`, `tutor` (streamed text), `writing`, `review`, `scene` (JSON); each task also has a
  `…/prompt` route that returns the exact request without sending it (07).
- `GET /library/:series/*` (outside `/api`): library media with Range support.
- Every other path serves the web build: existing files as they are (`/assets/*` hashed and
  `immutable`, the rest `no-cache`), extension-less paths fall back to `index.html` (client routes).

Planned areas: auth (profiles, PIN, device tokens), removing a course's files (owner),
exams, review, practice sets, notebook, cards, stats, speech, `server/*` (owner), `jobs/:id/events`.

## Profiles and access (planned, stage 4)

Today the server has one local profile and no login. Planned:

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
- Planned PWA: installable (manifest, icons). Offline use is out of scope; the UI shows "server
  unreachable". Unsent events are kept in the client's IndexedDB and retried with the same ids.

## Sidecars and models

Planned (stage 7), except LM Studio:

- `whisper-server` (whisper.cpp) started on demand, kept warm while in use; models in `<data-root>/models`.
- TTS engine (08), started on demand.
- No LLM runtime of its own: local models run in LM Studio (07); the server only starts LM Studio's
  server (`lms server start`) on request when LM Studio is installed on the same machine.
- Crash → restart with backoff (3 tries) → marked failed; dependent features show a clear message.
- How the speech binaries are obtained (own builds in `native/` or prebuilt) is decided in the stage 7
  plan.

## Desktop shell (`apps/desktop`, Tauri 2, stage 12)

Starts `sprachanker serve` as a sidecar, waits for health, opens the window on the local URL; tray;
first-run; auto-update from GitHub Releases. No business logic in the shell. Signing and notarization
are decided in stage 12.

## CLI (`apps/cli`)

Built (`apps/cli/src/main.ts`): `serve [--data] [--host] [--port]` ·
`import <provider> [--data] [--courses] [--editions] [--refresh]` · `verify [--data] [--notes]` (02).
Planned: `owner-link`, `normalise <series>`, `export-profile` / `import-profile`, `enrich check`.

The data root is `--data`, else `$SPRACHANKER_DATA`, else `<app-data>/data` (05). `import` is
idempotent: stored pages and media are not fetched again (`--refresh` re-reads pages), then every
selected edition is normalised.

**Binary build.** `bun run build:cli` builds the web app, generates an entry that imports every web
file `with { type: "file" }` and compiles it with `Bun.build({ compile })` into one binary. Embedded
files live under `/$bunfs/root/` and are found through the import values (URL path → embedded path),
so the binary works from any folder; e2e runs it from a temp folder. Migrations are bundled as text
imports (`packages/server/src/db/profile/migrations/index.ts`, generated by
`packages/server/scripts/migrations-index.ts`) and applied by the server's own migrator
(`packages/server/src/db/migrate.ts`). YAML imports are parsed at build time.

## Failure handling

| Situation | Behaviour |
|---|---|
| Import interrupted / network error | the import reports it; the next run resumes (stored pages and media are kept) |
| Source returns 403/429 | stop that host, report |
| Corrupt library file | the file fails validation when read; the screen shows the error (planned: `verify`, re-normalise or re-fetch) |
| LLM unreachable / invalid output | nothing is stored; the UI says what failed and offers a retry (07) |
| DB migration fails | rolled back; refuse to start with an explanation |
| Planned: disk full, sidecar crash, phone loses connection | job fails before writing the manifest; see Sidecars; events stay in the IndexedDB outbox and are retried |

## Security

Threat model: a home network or tailnet with trusted people; avoid accidental exposure and common web
attacks, not a determined attacker on the LAN. Built: the CSRF header, sealed secrets, sanitised course
HTML, Markdown without raw HTML, media path checks. The rest is planned with profiles (stage 4).

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
- **Secrets**: AES-256-GCM with a key file (`0600`, `<app-data>/secret.key`); write-only through the API;
  never logged.
- **Content**: course HTML sanitised at normalisation; markdown rendered with raw HTML disabled; CSP
  without inline scripts.
- **Media routes** take a series and a path inside that series' `media/` folder; anything else
  (another folder, `..`, a missing file) is refused (`mediaFile` in `packages/course-kit/src/library.ts`).
  Planned: recordings served only to their profile.
- **Downloads** (models, binaries): HTTPS, sha256 pinned, verified before use.
- **LLM**: course text and learner input are passed as delimited data; output is validated against
  schemas and never executed.

## Logging

No telemetry. Planned: structured logs to `<app-data>/logs`, rotated. Errors in the UI come with an action
("retry", "open settings"), never raw stack traces.
