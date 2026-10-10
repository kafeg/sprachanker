# Architecture

How SprachAnker fits together. The spec (`docs/spec/`) says what each part must do and why; this file
shows the parts, their dependencies and the mechanisms that cross them. The remaining work is in
`docs/plan.md`; how to work in each folder, in its CLAUDE.md.

## Runtime

```
browser ──localhost or a LAN name (phones over Tailscale: planned)──┐
                                                                   ▼
              sprachanker serve  (apps/cli, one compiled Bun binary with the web build inside)
                 ├─ Hono app: /api/* routes → services   (packages/server)
                 ├─ web build: the React app (apps/web), SPA fallback
                 ├─ /library/<series>/media/* with Range
                 ├─ whisper-server and Qwen3-TTS's tts-server on 127.0.0.1 (native/, beside the
                 │  binary), started on demand by the supervisor, stopped when idle
                 └─ Piper (sherpa-onnx-offline-tts), run once per text read aloud
                        │
<data root> (~/SprachAnker) ── library/<series>/…         courses (02), written only by the importers
                            ├─ models/                    speech models, voices/ Piper's voices, engines.pid (08)
                            ├─ cache/tts/                 texts read aloud by Piper and Qwen3-TTS
                            ├─ server.sqlite, server.pid  profiles, devices signed in; one server per root
                            └─ profiles/<id>/             each learner's profile.sqlite (runs, events,
                                                          cards, settings) and recordings/
```

Each database is copied beside itself once a day (a week kept) and before a migration.

Model calls go from the server to the provider the learner configured (LM Studio, OpenRouter, any
OpenAI-compatible server, or a command-line agent); nothing else leaves the machine. The desktop app
(planned) only starts the same binary and opens a window on it.

## Modules and dependencies

```
apps/cli ──► packages/server ──► packages/engine ───────► packages/schema
                │                 packages/llm ─────────► packages/schema
                │                 packages/course-kit ──► packages/schema
                └───────────────► courses/<provider> ───► course-kit, schema
apps/web ──► packages/engine, packages/schema, and a type-only import of the server's AppType
```

Enforced by dependency-cruiser (`.dependency-cruiser.cjs`, proven by `scripts/boundaries.test.ts`):
nothing imports `apps/*`; no cycles; `engine` is pure (no I/O, time and randomness are parameters);
`llm` never imports `server`; `course-kit` never imports a course; in the web app `ui/` is presentational
(no API, no features) and `lesson/` never imports the optional `llm/` folder.

| Module | Owns |
|---|---|
| `packages/schema` | zod schemas of every stored format and API payload, keys (`keys.ts`), event payloads |
| `packages/course-kit` | library read/write, fetcher, media store, the provider contract (`CourseProvider`), exercises drafted and checked, the key map, `verify`, vocab rules |
| `courses/<provider>` | fetch a source politely into `raw/`, normalise deterministically into canonical + locale |
| `packages/engine` | checking answers, text normalisation and diff, the lesson's steps and progress, mistakes, FSRS and Anki's study queue |
| `packages/llm` | providers, streamed and structured calls, time limits, prompts and tasks, tutor tools |
| `packages/server` | HTTP API, SQLite with migrations and backups, services, downloads, the speech engines and their supervisor, security |
| `apps/web` | screens for desktop and phone; checks answers locally with the engine for instant feedback |
| `apps/cli` | `serve`, `import`, `verify`, `profiles` |

## Server inside

`createServices()` (`services/index.ts`) wires the shared services once (content, downloads, profiles,
devices) and each profile's own services on first use (`of(id)`). `app.ts` mounts the route
files: the profile list and signing in first, then the session check — the device's cookie names the
profile and puts its services in the request's context (`c.var.s`) — then every profile route
(`routes/{profiles,courses,runs,exams,cards,settings,notebook,recordings,speech,llm}.ts`), each thin:
validate, call a service, return its typed result or one of schema's `ERROR_CODES`. The web client
gets the types through Hono RPC (`AppType`), no codegen.

- **Content**: `content` reads the library through course-kit with a cache; `downloads` queues course
  installs (one at a time, progress, resume after restart) through the providers' importers.
- **Learner data**: one module per table group — `run-store` is the only code on `runs` and `events`,
  `card-store` the only code on `cards` and `card_state`. Services build on them: `runs` (lesson runs,
  progress, reset), `exams` (exam runs: mock exams and practice), `cards` (cards from a lesson's words, relinking), `study` (Anki's decks, queue,
  ratings, undo, bury, suspend, flags, marks), `words` (My words), `notebook` (study days, passes),
  `mistakes`, `settings`.
- **AI**: `llm` (providers, LM Studio, prompt previews, `structured`: one path for a task's call and
  its timing), `explain`, `tutor` (+ `tutor-tools`), `writing`, `speaking` (an answer said aloud),
  `scene`, `examples` (a card's word), `lesson-context` (what tasks know of a lesson). `in-flight`
  keeps what a model is doing per lesson, so structured calls run to their end and a page opened
  meanwhile shows them as waiting.
- **Speech**: `speech` (whisper-server and its models) and `qwen-tts` (Qwen3-TTS's tts-server, its
  models) on `sidecar`, the supervisor of local engines (06, "Sidecars"); `read-aloud` (Piper's voices,
  a text read as a WAV); `recordings` (the learner's audio per profile).
- **Profiles** (`profiles`, `devices`): every profile equal, never nameless; a device signs in by
  choosing a profile and keeps a revocable token; server matters are the `sprachanker profiles`
  command's (06).
- **Security** (`security/`): Host check, CSP and headers, the client header on mutations (CSRF), API
  keys sealed with AES-GCM, tokens hashed (WebCrypto).

## Mechanisms that cross modules

- **Content pipeline**: provider fetch → `raw/` → normalise → `canonical/` (language-independent) +
  `locale/<edition>/` (learner-language texts) → validated on write and on read → `content` → web.
  Keys (02) are stable across editions and kept by source id when a source reorders (DW: the key
  map); course content is never generated by a model. Each provider is a `CourseProvider`, tested
  against the contract together.
- **One history rule**: everything the learner does is an event in a run (05). Lesson passes, review
  days, exam runs (a mock exam or practice: its plan, each answer an event, its result), tutor chats
  and scenes are runs; one-off model verdicts (explain, writing, speaking, word
  examples) are `llm_verdict` events, typed by task. Events are append-only and only grow; statistics
  are pure functions over `TypedEvent`s (engine). How histories are read: `packages/server/CLAUDE.md`.
- **Lesson flow**: the engine turns a lesson into steps (overview, words, grammar, exercises, culture, AI
  practice, summary; `compose/steps.ts`); the web's `use-flow` moves through them and records
  `page_shown` (with the exercise's key: resume and snapshots follow the exercise) / `step_done`
  through the run's outbox; the server re-checks every answer and stores its own outcome.
- **Cards and review**: a card is a lexeme in a translation language (04); its faces carry FSRS state
  written together with each `card_review` event. The engine builds Anki's queue (limits, a day that
  starts at the hour set in Review settings — `srs.dayStartHour`, default 4 —, learning steps,
  learn-ahead) and `answersLeft`; the same reviewer (`study/`) serves Review and the lesson's "Words"
  step.
- **Model calls**: every answer records `model` and `latencyMs`; JSON outputs are validated with one
  repair attempt; streamed replies (tutor, explanations) end with their connection, structured ones
  outlive the page (07).
- **Optional AI in the web**: `apps/web/src/llm/` plugs into the player through slots
  (`lesson/slots.ts`) and into the onboarding as its AI step; removing the folder and its mount points
  (the router, the settings page) leaves a working app.
- **The app's gate** (web `routes/router.tsx`): no session → "Who is studying?"; a profile not yet
  onboarded → its onboarding; else the app. A 401 `no_session` anywhere returns to the gate.

## Tests

| Layer | Where | Runs on |
|---|---|---|
| Unit | each package's `test/` (`bun test`) | pure functions, checkers, queue, prompts |
| Server | `packages/server/test` | `createApp().request()` on a temporary data root with the fixture course and a signed-in profile; fake `fetch` for models |
| Migrations | `packages/server/test/db.test.ts` | each migration upgrades a database of the version before it, with rows |
| Web | `apps/web/test` | happy-dom on an origin no server listens on; screens rendered with a filled query cache — a request fails the test |
| End to end | `e2e/` (Playwright) | the compiled binary, the fixture course, a fake OpenAI-compatible server, a profile signed in by a setup project; desktop and phone, Chromium and WebKit |
| Repository | `scripts/` | dependency rules, paths named in CLAUDE.md files and their Layout trees |

`bun run check` runs typecheck, lint, boundaries and all tests; `bun run e2e` builds the binary first.
