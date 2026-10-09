# 06 — Server, network, desktop shell, CLI

## Server (`packages/server`)

One Bun process started by `sprachanker serve`. The `sprachanker` binary is built from `apps/cli` with
`bun build --compile`. The server:

- serves the web app (static build of `apps/web`) and the JSON API;
- owns the `profile.sqlite` files (05; one per profile, the first `local`) and `server.sqlite`;
- serves library media with HTTP Range support;
- talks to LLM providers through `packages/llm`.

Course downloads run as background jobs (one at a time, queued; progress polled by the screens, no
SSE). A download is marked in its series folder while it runs (`.downloads/<course>.json`), kept with the
number of the course's media still missing or with the error it stopped on; a restart resumes only an
interrupted one, the others wait for "Continue downloading". Sidecars: below.

Hono + zod; Drizzle on `bun:sqlite`. Bun-specific APIs stay behind an adapter so a Node fallback stays
possible. Every feature is the server's: a desktop shell (below) adds none.

## API

JSON under `/api`, validated with zod and typed for the web client through Hono RPC (`AppType`). Routes:
`packages/server/src/app.ts` and `packages/server/src/routes/*.ts`.

- `GET /api/health` → `{ "status": "ok", "version" }` (e2e waits for it). Unknown `/api/*` paths
  return a JSON 404, never the web app.
- Content: `GET /api/courses` (installed courses with progress and the lesson to continue),
  `GET /api/course` (course map), `GET /api/lesson` (canonical + locale lesson),
  `GET /api/course/check` (the course verified: counts, media by kind and size, problems — each its
  kind, place and the finding in English: the app names the kind in the interface's language).
- Courses on disk: `GET /api/catalog` (every course the providers offer, with its state: available,
  queued, downloading, incomplete, ready), `GET` / `POST /api/downloads` (the jobs with progress and
  log; queue a download — first download, completing one and syncing with the source are the same
  idempotent import), `GET /api/storage` (the data folder, the space per series, the free space on the disk).
- Progress: `POST /api/progress/reset` (a course or one lesson, 05).
- Profiles (without a session): `GET` / `POST /api/profiles` (who is studying and registration; a new
  profile, signed in), `GET` / `POST` / `DELETE /api/session` (this device's profile; signing in by
  choosing; signing out). With a session: `PUT /api/profile` (name, colour, onboarded),
  `GET /api/profile/devices`,
  `DELETE /api/profile/devices/:id`.
- Speech (08): `GET /api/speech` (the engine, its models with downloads, the profile's recognition and
  model), `POST` / `DELETE /api/speech/models/:id`, `POST /api/speech/warm`,
  `POST /api/speech/transcribe?lang=` (a 16 kHz WAV as the body); reading aloud: `GET
  /api/speech/voices` (Piper's engine and voices with downloads), `POST` / `DELETE
  /api/speech/voices/:id`, `POST /api/speech/say` (`{text, lang, voice?}` → a WAV with the profile's
  voice and speed; `voice` to hear another installed one); `GET /api/speech/qwen` (Qwen3-TTS's engine,
  models with downloads, languages, speakers and each language's default), `POST` / `DELETE
  /api/speech/qwen/models/:id`, `POST /api/speech/qwen/warm`.
- Recordings (08): `GET /api/recordings` (count and size), `POST /api/recordings` (the audio as the
  body, its type in Content-Type), `GET /api/recordings/:id` (with ranges), `DELETE /api/recordings`.
- Notebook (09): `GET /api/notebook` (the last study days with how much was done, the courses with
  the lessons worked on), `GET /api/notebook/lesson?lessonKey=` (a lesson's passes),
  `GET /api/notebook/passes/:id` (a pass in full), `GET /api/notebook/item?itemKey=` (an item across
  passes). Read only; a pass is a lesson run with work in it.
- Cards (04): `POST /api/cards/lesson` (cards of a lesson's words), `GET /api/cards/decks` (each
  language with its courses and their counts), `GET /api/cards/decks/offers` (each installed course's
  words as a deck to take), `POST /api/cards/decks/take|leave` (a course's deck taken whole, or left),
  `POST /api/cards/decks/more` (more new cards today in a deck), `GET /api/cards/study?scope=` (the
  counts, the current face with its due time per rating, why a finished deck is finished, whether there is an answer to
  take back), `POST /api/cards/:id/review` (a rating), `POST /api/cards/undo`, `POST /api/cards/:id/bury`,
  `POST /api/cards/unbury`, `PUT /api/cards/:id/suspend|flag|mark`, `GET /api/cards` (My words: the
  learner's words with their language, course, state and next due), `GET /api/cards/:id` (the word sheet:
  each face's state and the answers given, newest first, those taken back left out). A rating carries its event id (sent again, it is not applied twice) and the
  face's review count as shown (a face rated meanwhile on another device is refused: 409 `card_changed`).
- Settings: `GET` / `PUT /api/settings` (one key at a time): only the learner's preferences, each
  checked against its schema (`packages/schema/src/settings.ts`); the assistant's endpoints and prompts
  are changed only through `/api/llm`.
- Lesson runs: `GET /api/runs/lesson` (the run a lesson shows), `POST /api/runs` (start or resume;
  checked before anything is written),
  `POST /api/runs/:id/events` (batched: checked whole, then stored in one transaction — all or
  nothing; idempotent by id, an event sent again returns its stored outcome; outcomes computed by the
  server), `POST /api/runs/:id/finish` (only an active run finishes). These take lesson runs only.
- Errors: `{error: <code>}`, the code one of `ERROR_CODES` (`schema/src/errors.ts`; the web has words
  for each, tested), with 400 (input; a request that does not validate is `invalid_request` with a
  `detail`, the AI's routes included), 403 (`missing_client_header`, `registration_closed`), 404
  (`not_installed` for a course, lesson or file that is not in the library; unknown ids), 409 (state:
  a run not active, an assistant not set up, a model already busy with the same thing), 413, 415, 421
  (a host name this machine is not reached by), 502 (the LLM provider, the speech engine); services raise `ServiceError(code, status)` (`src/errors.ts`). Anything else, a
  stored row that no longer parses included, is a 500 (`server_error`).
- `/api/llm` (`routes/llm.ts`): `GET /` (state), `PUT route`, `PUT providers/:id`, `GET models`,
  `GET key` (OpenRouter's key state); `GET lmstudio`, `POST lmstudio/start|download`; tasks —
  `explain` and `tutor` (streamed text), `speaking`, `examples`, `writing`, `scene/start|turn` (JSON),
  each with a `…/prompt` route (`scene/prompt`, `tutor/prompt`) that returns the exact request without
  sending it (07); what is kept — `GET explanations?lessonKey=&runId=`, `GET speaking?lessonKey=&runId=`,
  `GET examples?cardId=`, `GET writing`, `GET scene`, `GET tutor`; `POST tutor/context` (how full the
  next request is), `POST tutor/reset`, `GET tutor/chats`, `GET` / `DELETE tutor/chats/:id`; a tutor
  message with `newChat` opens a new chat (the current one ends once the reply has come; a failed call
  changes nothing); `GET prompts` lists the system prompts and `PUT prompts/:task` sets or clears the
  learner's own one.
- `GET /library/:series/*` (outside `/api`): library media with Range support.
- Every other path serves the web build: existing files as they are (`/assets/*` hashed and
  `immutable`, the rest `no-cache`), extension-less paths fall back to `index.html` (client routes).

## Profiles and access

Profiles are separation, not security (owner, 2026-10-07): **every profile is equal** in the app — no
owner, no admin screens; server matters are the `sprachanker profiles` command's (below).

- `server.sqlite` holds the profiles (name — never empty —, colour, onboarded), the
  devices signed in to them, and the server's settings; each profile's learning data is its own file
  `profiles/<id>/profile.sqlite`. The single profile from before (`profiles/local`) becomes the first
  profile, not yet onboarded (its data kept; it gets its name in the onboarding, which cannot end
  without one).
- A device without a session sees **"Who is studying?"**: the interface language, the profiles and
  "+ New profile" while registration is open (on by default). A new profile is named first, then made,
  signed in at once and taken through the onboarding (09).
- **Signing in**: a profile opens when chosen. No PINs, passwords or passkeys (owner, 2026-10-08:
  profiles keep people's learning apart; on a home server they need no lock).
- **Devices**: a 256-bit random token in an HttpOnly cookie, its SHA-256 in `devices` (not a JWT: one
  server decides, and signing a device out is a row); a year, extended with use. The profile lists its
  devices and signs any out; "Switch profile" signs this device out.
- Every `/api` route but health, the profile list and signing in needs a session (401 `no_session`);
  the session check names the profile, whose services (opened on first use) the routes then use.
- **The command** `sprachanker profiles`: list them; `registration on|off`; `delete <id>` (the profile
  with its data).

## Network and HTTPS

- Default: listen on `127.0.0.1:4580` (`--host`, `--port`).
- Only local host names are accepted (Security, "Host check"): a `*.ts.net` Host is refused with 421.
  Phones over HTTPS through `tailscale serve`: plan, "Phones".
- Plain HTTP on the LAN works without a secure context: no microphone (the UI says why, 08).
- The PWA is installable (manifest, icons). No offline use: a request that fails shows its error with
  "Try again"; a lesson's unsent events stay in memory and are sent again (05, "Sending").

## Sidecars and models

- One supervisor for local engines (`services/sidecar.ts`): a process on a free 127.0.0.1 port, one
  at a time per kind, for one setup (a model); started once however many requests arrive together,
  ready when its health check answers, stopped after a while without requests, started again after
  it exits; a request for another setup waits for those in flight before the process is replaced.
  The runtime stops the engines with the server (exit and stop signals) and keeps their pids in
  `<data-root>/models/engines.pid`, so one left by a server killed outright is stopped when the
  next one starts. An engine stopped while it starts is not left running; an engine that fails a
  request with its own failure is replaced on the next one.
- One server per data root: `serve` makes `<data-root>/server.pid` (only where there is none, so two
  started at once cannot both have it) and refuses to start while the server named there runs — a
  live SprachAnker process, not another program given its pid after a restart; `profiles delete`
  refuses while one does.
- `whisper-server` (whisper.cpp, built in `native/`, 08) on that supervisor; models in
  `<data-root>/models`, downloaded and checked from Settings.
- Qwen3-TTS (`tts-server`, 08) on the same supervisor (health `/health`, start 180 s, idle stop 10
  min). Piper is no sidecar: `sherpa-onnx-offline-tts` runs once per text (a time limit of 60 s), its
  WAV kept. The engines' pids are kept in `<data-root>/models/engines.pid`.
- No LLM runtime of its own: local models run in LM Studio (07); the server only starts LM Studio's
  server (`lms server start`) on request when LM Studio is installed on the same machine.
- One that does not answer its health check within its start time (whisper-server 2 min, Qwen3-TTS
  3 min) fails that request
  (`speech_engine_failed`), and the feature says so; so does a transcription that takes over a
  minute.

## Desktop shell (`apps/desktop`)

Planned (plan, "Desktop app"). Decided: the shell knows only the `sprachanker` binary and its flags —
it starts `serve`, waits for `/api/health` and opens a window on the local URL; no business logic in
it, so headless `serve` has every feature.

## CLI (`apps/cli`)

Built (`apps/cli/src/main.ts`): `serve [--data] [--host] [--port]` ·
`import <provider> [--data] [--courses] [--editions] [--refresh]` · `verify [--data] [--notes]` (02).
`profiles` (above). Planned: `normalise <series>`, profile export and import, `enrich check` (plan).

The data root is `--data`, else `$SPRACHANKER_DATA`, else `<app-data>/data` (05). `import` is
idempotent: stored pages and media are not fetched again (`--refresh` re-reads pages), then every
selected edition is normalised. Exit codes: `import` fails (1) when media failed, a file failed
validation, or no course matched `--courses` / `--editions`; `verify` fails when a course has
problems or none is installed. A failure (an unknown provider, a port in use, a held lock, a failed
migration, a bad option) is one line, `sprachanker: <message>`, never a stack trace.

**Binary build.** `bun run build:cli` builds the web app, generates an entry that imports every web
file `with { type: "file" }` and compiles it with `Bun.build({ compile })` into one binary. Embedded
files live under `/$bunfs/root/` and are found through the import values (URL path → embedded path),
so the binary works from any folder; e2e runs it from a temp folder. Migrations are bundled as text
imports (`packages/server/src/db/profile/migrations/index.ts`,
`packages/server/src/db/server/migrations/index.ts`, generated by
`packages/server/scripts/migrations-index.ts`) and applied by the server's own migrator
(`packages/server/src/db/migrate.ts`).

## Failure handling

| Situation | Behaviour |
|---|---|
| Import interrupted / network error | the import reports it; the next run resumes (stored pages and media are kept) |
| Source returns 403/429 | stop that host, report |
| Corrupt library file | the file fails validation when read; the screen shows the error; `verify` and the course page's integrity check report it |
| LLM unreachable / invalid output | nothing is stored; the UI says what failed and offers a retry (07) |
| DB migration fails | rolled back; refuse to start with an explanation |
| Speech engine exits or hangs | see Sidecars |
| Server not reached | the request's error with "Try again"; a lesson's events stay in memory and are sent again (05, "Sending") |

## Security

Threat model: a home network or tailnet with trusted people; avoid accidental exposure and common web
attacks, not a determined attacker on the LAN. Built: the Host check, the CSRF header, security
headers and CSP, sealed secrets, sanitised course HTML, Markdown without raw HTML, media path checks,
profiles with device tokens (above).

- **Host check** (`src/security/host.ts`): requests are accepted only for the names this machine is
  reached by — `localhost`, an IP address, a `.local` name, its host name, the address it listens on —
  else 421 (DNS-rebinding protection: a page on another site cannot rebind its name to this server).
  The tailnet's name: plan, "Phones". No CORS (same-origin only).
- **Cookies**: `HttpOnly`, `SameSite=Strict`, `Secure` on HTTPS addresses. Mutating requests require the
  header `X-SprachAnker: 1`.
- **Tokens**: device tokens 256-bit random, stored hashed (SHA-256), revocable.
- **Secrets**: AES-256-GCM with a key file (`0600`, `<app-data>/secret.key`); write-only through the API;
  never logged.
- **Content**: course HTML sanitised at normalisation; markdown rendered with raw HTML disabled. Every
  response has a CSP that loads scripts, styles, images, media and connections from this server only
  (images also `data:`/`blob:`, media `blob:`; inline styles allowed, `style-src 'unsafe-inline'`),
  no inline scripts, `frame-ancestors 'none'` (also `X-Frame-Options`), `nosniff` and `no-referrer`: model output cannot make the browser send data to another host.
- **Media routes** take a series and a path inside that series' `media/` folder; anything else (a
  series that is not a series key, another folder, `..`, a malformed escape, a missing file) is
  refused (`mediaFile` in `packages/course-kit/src/library.ts`). The library reader takes series,
  course and edition names only when they are keys, so nothing from a request points outside it.
  Recordings are served only to their profile (`/api/recordings/:id` behind the session check, ids
  are ULIDs, files named by the server).
- **Downloads** (speech models): HTTPS, sha256 pinned, verified before use.
- **LLM**: course text and learner input are passed as delimited data; output is validated against
  schemas and never executed.

## Logging

No telemetry. Planned: structured logs (plan). Errors in the UI come with an action ("retry", "open
settings"), never raw stack traces.
