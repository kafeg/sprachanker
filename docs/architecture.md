# Architecture

How SprachAnker fits together. The spec (`docs/spec/`) says what each part must do and why; this file
shows the parts, their dependencies and the mechanisms that cross them. The remaining work is in
`docs/plan.md`; how to work in each folder, in its CLAUDE.md.

## Runtime

```
phone / browser ──HTTPS (tailscale serve) or localhost──┐
                                                        ▼
              sprachanker serve  (apps/cli, one compiled Bun binary with the web build inside)
                 ├─ Hono app: /api/* routes → services   (packages/server)
                 ├─ web build: the React app (apps/web), SPA fallback
                 └─ /library/<series>/media/* with Range
                        │
<data root> (~/SprachAnker) ── library/<series>/…         downloaded courses (02), read-only to the app
                            ├─ server.sqlite              profiles, devices signed in
                            └─ profiles/<id>/profile.sqlite   each learner's runs, events, cards, settings
```

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
| `packages/course-kit` | library read/write, fetcher, media store, provider contract, `verify`, vocab rules |
| `courses/<provider>` | fetch a source politely into `raw/`, normalise deterministically into canonical + locale |
| `packages/engine` | checking answers, text normalisation and diff, the lesson's steps and progress, mistakes, FSRS and Anki's study queue |
| `packages/llm` | providers, streamed and structured calls, time limits, prompts and tasks, tutor tools |
| `packages/server` | HTTP API, SQLite with migrations and backups, services, downloads, security |
| `apps/web` | screens for desktop and phone; checks answers locally with the engine for instant feedback |
| `apps/cli` | `serve`, `import`, `verify` |

## Server inside

`createServices()` (`services/index.ts`) wires the shared services once (content, downloads, profiles,
devices) and each profile's own services on first use (`of(id)`). `app.ts` mounts the route
files: the profile list and signing in first, then the session check — the device's cookie names the
profile and puts its services in the request's context (`c.var.s`) — then every profile route
(`routes/{profiles,courses,runs,cards,settings,notebook,llm}.ts`), each thin: validate, call a service,
return its typed result. The web client gets the types through Hono RPC (`AppType`), no codegen.

- **Content**: `content` reads the library through course-kit with a cache; `downloads` queues course
  installs (one at a time, progress, resume after restart) through the providers' importers.
- **Learner data**: one module per table group — `run-store` is the only code on `runs` and `events`,
  `card-store` the only code on `cards` and `card_state`. Services build on them: `runs` (lesson runs,
  progress, reset), `cards` (cards from a lesson's words, relinking), `study` (Anki's decks, queue,
  ratings, undo, bury, suspend, flags, marks), `words` (My words), `notebook` (study days, passes),
  `mistakes`, `settings`.
- **AI**: `llm` (providers, LM Studio, prompt previews, the stopwatch), `explain`, `tutor` (+
  `tutor-tools`), `writing`, `scene`, `lesson-context` (what tasks know of a lesson). `in-flight` keeps
  what a model is doing per lesson, so structured calls (a scene, a writing check) run to their end and
  a page opened meanwhile shows them as waiting.
- **Profiles** (`profiles`, `devices`): every profile equal, never nameless; a device signs in by
  choosing a profile (no PINs: profiles keep learning apart) and keeps a revocable token; server matters are
  the `sprachanker profiles` command's.
- **Security** (`security/`): Host check, CSP and headers, the client header on mutations (CSRF), API
  keys sealed with AES-GCM, tokens hashed (WebCrypto).

## Mechanisms that cross modules

- **Content pipeline**: provider fetch → `raw/` → normalise → `canonical/` (language-independent) +
  `locale/<edition>/` (learner-language texts) → validated on write and on read → `content` → web.
  Keys (02) are stable across editions; course content is never generated by a model.
- **One history rule**: everything the learner does is an event in a run (05). Lesson passes, review
  days, tutor chats and scenes are runs; one-off model verdicts (explain, writing) are `llm_verdict`
  events of the lesson run. Events are append-only; statistics are pure functions over them (engine).
  Lists of earlier items read the same way everywhere (`store.replace`, `store.verdicts`, newest first,
  at most `HISTORY_LIMIT`; a row that no longer reads is left out and logged).
- **Lesson flow**: the engine turns a lesson into steps (overview, words, grammar, exercises, culture, AI
  practice, summary; `compose/steps.ts`); the web's `use-flow` moves through them and records
  `page_shown` / `step_done`; the server re-checks every answer and stores its own outcome.
- **Cards and review**: a card is a lexeme in a translation language (04); its faces carry FSRS state
  written together with each `card_review` event. The engine builds Anki's queue (limits, 4 AM day,
  learning steps, learn-ahead) and `answersLeft`; the same reviewer (`study/`) serves Review and the
  lesson's "Words" step.
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
| Web | `apps/web/test` | happy-dom; screens rendered with a filled query cache, no requests |
| End to end | `e2e/` (Playwright) | the compiled binary, the fixture course, a fake OpenAI-compatible server, a profile signed in by a setup project; desktop and phone, Chromium and WebKit |
| Repository | `scripts/` | dependency rules, paths named in CLAUDE.md files |

`bun run check` runs typecheck, lint, boundaries and all tests; `bun run e2e` builds the binary first.
