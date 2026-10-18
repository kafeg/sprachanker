# Architecture

How SprachAnker fits together: the parts, their dependencies and the mechanisms that cross them.
The owner's decisions and why are in `docs/decisions.md`, the remaining work in `docs/plan.md`, how
to work in each folder in its CLAUDE.md.

## Runtime

```
browser ──localhost, a LAN name, the tailnet (tailscale serve)──────┐
                                                                   ▼
              sprachanker serve  (apps/cli, one compiled Bun binary with the web build inside)
                 ├─ Hono app: /api/* routes → services   (packages/server)
                 ├─ web build: the React app (apps/web), SPA fallback
                 ├─ /library/<series>/media/* and /decks/<folder>/media/* with Range
                 ├─ whisper-server and Qwen3-TTS's tts-server on 127.0.0.1 (native/, beside the
                 │  binary), started on demand by the supervisor, stopped when idle
                 └─ Piper (sherpa-onnx-offline-tts), run once per text read aloud
                        │
<data root> (~/SprachAnker) ── library/<series>/…         courses, written by the importers and
                            │                             course bundles installed
                            ├─ library/.transfers/        a course bundle being exported or imported
                            ├─ decks/<id>/                imported .apkg decks: deck.json, extras.json, media/
                            ├─ decks/course~<s>~<c>/      what is made for a course's words (audio read aloud,
                            │                             examples): extras.json, media/; kept as practice is
                            ├─ decks/finds-<profile>-…/   a profile's own deck (Finds): deck.json, extras.json, media/
                            ├─ decks/.transfers/          a deck file being exported or imported
                            ├─ models/                    speech models, voices/ Piper's voices, word-voices/ the
                            │                             recordings words are read in (cloned), engines.pid
                            ├─ cache/tts/                 texts read aloud by Piper and Qwen3-TTS
                            ├─ server.sqlite, server.pid  profiles, devices signed in; one server per root
                            ├─ profiles/<id>/             each learner's profile.sqlite (runs, events,
                            │                             cards, settings) and recordings/
                            └─ profiles/.transfers/       a profile file being exported or imported
```

Each database is copied beside itself once a day (a week kept) and before a migration. A profile
moves between one's machines as one file (`.sprachanker-profile`: its database without its API keys,
its recordings, a manifest with a hash per file), imported as a new profile; `sprachanker backup`
copies what cannot be fetched again. A downloaded course or exam moves the same way
(`.sprachanker-course`: its files of the editions carried, the media they use, a manifest with a hash
per file and its content versions), installed only once every file is checked, media already there
not unpacked again. A deck moves on its own (`.sprachanker-deck`: its folder — deck.json,
extras.json, the media they name — and a manifest with a hash per file), merged into the deck there.

Model calls go from the server to the provider the learner configured (LM Studio, OpenRouter, any
OpenAI-compatible server, or a command-line agent); besides them only the update check goes out
(GitHub's latest release, every few hours, nothing about the learner: `services/updates.ts`). The
desktop app (`apps/desktop`) runs the same binary, shows a window on it and updates itself (Tauri's
updater, the release's files checked against the project's key).

## Modules and dependencies

```
apps/cli ──► packages/server ──► packages/engine ───────► packages/schema
                │                 packages/llm ─────────► packages/schema
                │                 packages/anki-export ─► packages/schema
                │                 packages/course-kit ──► packages/schema
                └───────────────► courses/<provider> ───► course-kit, schema
apps/web ──► packages/engine, packages/schema, and a type-only import of the server's AppType
```

Enforced by dependency-cruiser (`.dependency-cruiser.cjs`, proven by `scripts/boundaries.test.ts`):
nothing imports `apps/*`; no cycles; `engine` is pure (no I/O, time and randomness are parameters);
`llm` never imports `server`; `course-kit` never imports a course; in the web app `ui/` is presentational
(no API, no features), feature folders never import each other, `api/` imports none of them, and
only the router and the settings page import the optional `llm/` folder.

| Module | Owns |
|---|---|
| `packages/schema` | zod schemas of every stored format and API payload, keys (`keys.ts`), event payloads |
| `packages/course-kit` | library read/write, fetcher, media store, the provider contract (`CourseProvider`), exercises drafted and checked, the key map, `verify`, vocab rules, course bundles (what one holds, checked and installed), zips of stored entries |
| `courses/<provider>` | fetch a source politely into `raw/`, normalise deterministically into canonical + locale |
| `packages/engine` | checking answers, text normalisation and diff, the lesson's steps and progress, mistakes, FSRS and Anki's study queue |
| `packages/llm` | providers, streamed and structured calls, time limits, prompts and tasks, tutor tools |
| `packages/anki-export` | `.apkg` packages read (SQLite and zstd from the runtime), notes as a deck's words with lexemes by the courses' rules |
| `packages/server` | HTTP API, SQLite with migrations and backups, services, downloads, the speech engines and their supervisor, security |
| `apps/web` | screens for desktop and phone; checks answers locally with the engine for instant feedback |
| `apps/cli` | `serve`, `import`, `verify`, `profiles` (with a profile's export and import), `courses` (a course's export and import), `backup` |

## Server inside

`createServices` (`services/index.ts`) wires the shared services once (content, imported decks,
downloads, profiles, devices) and each profile's own services on first use (`of(id)`). `app.ts`
mounts the route files: the profile list and signing in first, then the session check — the device's cookie names the
profile and puts its services in the request's context (`c.var.s`) — then every profile route
(`routes/{profiles,courses,lessons,progress,exams,cards,decks,settings,notebook,recordings,speech,llm}.ts`), each thin:
validate, call a service, return its typed result or one of schema's `ERROR_CODES`. The web client
gets the types through Hono RPC (`AppType`), no codegen.

- **Content**: `content` reads the library through course-kit, each file read once and kept while it
  stays the same (its size and time of change: a download or an import replaces it); `downloads` queues course
  installs (one at a time, progress, resume after restart) through the providers' importers;
  `course-transfer` moves courses of a series as a bundle (course-kit `bundle.ts` checks and installs it).
- **Learner data**: one module per table group — `run-store` is the only code on `runs` and `events`,
  `card-store` the only code on `cards` and `card_state`; over the run store, `answers` (numbered by
  the server) and `verdicts` (a model's, kept and read one way). Services build on them — lessons:
  `lessons` (lesson runs, progress, standing), `lesson-journal` (a lesson's passes, a pass in full, an
  item across passes), `mistakes`; exams: `exams` (the standings) over `exam-runs` (mock exams and
  practice taken); review: `cards` (cards from a lesson's words, decks taken and left, relinking),
  `decks` (imported `.apkg` decks, the server's: preview, import, list, delete; their folders through
  `runtime/decks.ts`), `deck-extras` (what is made for a deck's words, kept in its folder:
  extras.json read once, a job per deck and kind), `deck-transfer` (any deck as a file: exported,
  previewed, merged in by lexeme; its files through `runtime/deck-transfer.ts`), `deck-audio` (a deck's words without audio read
  aloud by the server's engine), `deck-examples` (a deck's words given examples by the AI), `study` (Anki's decks, queue, ratings, undo, bury, suspend, flags, marks), `words` (My words); and
  across them `notebook` (the study days and the modules' standings, gathered), `progress` (reset over
  every module's runs, recordings in use), `settings`.
- **AI** (a feature across the learning modules, below): `llm` (providers, LM Studio, prompt
  previews, `structured`: one path for a task's call and its timing), `lesson-context` (what tasks
  know of a lesson: the knowledge snapshot — level, place, words and topics met) and `in-flight` (what a model is doing, by lesson, card or answer, so structured
  calls run to their end and a page opened meanwhile shows them as waiting) are shared; each task's
  service belongs to the module whose runs it works in — lessons: `explain`, `writing`, `speaking`
  (an answer said aloud), `tutor` (+ `tutor-tools`; `courses-context`: what the Tutor section's
  chats know of the learner's courses), `talk` (Speaking), `scene` (the Dialogue);
  `text-maker` (the text generator Reading, Listening, Writing and Speaking share), `practice-prep`
  (a lesson's next variants taken as it starts); exams: `exam-rating`,
  `exam-conversation` (a speaking part's script); review: `examples` (a card's word).
- **Speech**: `speech` (whisper-server and its models) and `qwen-tts` (Qwen3-TTS's tts-server, its
  models; the Base model in a process of its own reads words in a cloned voice) on `sidecar`, the
  supervisor of local engines; `word-voice` (each language's voice for words: a course's recording
  proposed, taken, cloned); `read-aloud` (Piper's voices,
  a text read as a WAV); what they share in `local-engines` (the runtime's SpeechHost, the reading
  cache Piper and Qwen3-TTS both keep their WAVs in) and `model-downloads`; `profile-speech` (a profile's
  choices applied); `recordings` (the learner's audio per profile); `heard` (the source's answer
  recordings heard once by Whisper into the course, `library/<series>/heard/`: the engine checks an
  answer said aloud against them, the AI only where it cannot judge). The runtime side: `runtime/engines.ts`
  (where each engine is, their processes), `speech.ts`, `piper.ts`, `model-files.ts`, `readings.ts`.
- **Profiles** (`profiles`, `devices`): every profile equal, never nameless; a device signs in by
  choosing a profile and keeps a revocable token; server matters are the `sprachanker profiles`
  command's.
- **Security** (`security/`): Host check, CSP and headers, the client header on mutations (CSRF), API
  keys sealed with AES-GCM, tokens hashed (WebCrypto).

## Mechanisms that cross modules

- **Content pipeline**: provider fetch → `raw/` → normalise → `canonical/` (language-independent) +
  `locale/<edition>/` (learner-language texts) → validated on write and on read → `content` → web.
  Keys are stable across editions and kept by source id when a source reorders (DW: the key
  map); course content is never generated by a model. Each provider is a `CourseProvider`, tested
  against the contract together.
- **One history rule**: everything the learner does is an event in a run. Lesson passes, review
  days, exam runs (a mock exam or practice: its plan, each answer an event, its result), tutor chats
  and Dialogues (scene runs) are runs; one-off model verdicts (explain, writing, speaking, word
  examples) are `llm_verdict` events, typed by task. Events are append-only and only grow; statistics
  are pure functions over `TypedEvent`s (engine). How histories are read: `packages/server/CLAUDE.md`.
- **Learning modules and their connectors**: lessons, exams and review are modules that share
  components and types but connect only through common connectors: the run store (every module's
  runs and events, one `RunHeader`; the model's verdicts and lines kept and read one way), the study
  days (the engine counts every event by its run's module, schema `stats.ts`), and one statistics
  contract — each module's service gives its `standing` (headline figures, entries with their figures
  and latest runs) and the Notebook gathers them from `services/index.ts` without knowing a module; a
  module's own page in the Notebook (a lesson's passes, an exam's questions, a review day's answers)
  is that module's.
  Resetting progress is the neutral `progress` service's. What one module's service needs of another
  is a function `services/index.ts` hands in, never an import: `cards` takes the run a lesson shows
  (`lessons.shown`: the run its words' cards are made in) and the learner's courses
  (`lessons.courses`: the decks to take); the lessons' AI services take `lessons.shown` and
  `lessons.lessonRun`, the tutor's tools `lessons.progress`, a deck's words given examples
  `cards.deckNotes`.
  dependency-cruiser keeps the server's modules apart (`server-*-apart`, `server-notebook-gathers`)
  and the web's feature folders (`web-features-apart`: what they share is in `library/`, `api/`,
  `ui/`, `exercises/`, `audio/`, `word/`).
- **AI practice**: no module of its own — a feature plugged into the three: on the server each task's
  service sits in the module whose runs it keeps its answers in (its group in dependency-cruiser), in
  the web the optional `llm/` folder fills the modules' slots (below). Its own runs (tutor chats,
  Dialogues) are about a lesson, but the Tutor section's chats, about none; its work — the learner's messages and the model's checks, in whichever
  run — counts in the study days as `ai` (schema `stats.ts`), and it gives no standing.
- **Lesson flow**: the engine turns a lesson into steps (overview, words, grammar, exercises, culture, AI
  practice, summary; `compose/steps.ts`); the web's `use-flow` moves through them and records
  `page_shown` (with the exercise's key: resume and snapshots follow the exercise) / `step_done`
  through the run's outbox; the server re-checks every answer and stores its own outcome.
- **Cards and review**: a card is a lexeme in a translation language, made from a course's word
  or an imported deck's — one card for both when they are the same lexeme; its faces carry FSRS state
  written together with each `card_review` event. The engine builds Anki's queue (limits, a day that
  starts at 4 AM, learning steps,
  learn-ahead) and `answersLeft`; the same reviewer (`study/`) serves Review and the lesson's "Words"
  step.
- **Model calls**: every answer records `model` and `latencyMs`; JSON outputs are validated with one
  repair attempt; streamed replies (tutor, explanations) end with their connection, structured ones
  outlive the page.
- **Optional AI in the web**: `apps/web/src/llm/` plugs into the player through slots
  (`lesson/slots.ts`), into the onboarding as its AI step and into the shell as the Tutor section
  (its pages and navigation entry, from the router); removing the folder and its mount points
  (the router, routes/runs.tsx, the settings page) leaves a working app. The router loads each page
  but Courses and Exams when it is first opened (its own chunk; preloaded when a link to it is
  hovered; a chunk gone after an update reloads the app once, a page that fails shows ErrorState with
  Retry), the AI's code with the runs and pages that use it.
- **The app's gate** (web `routes/router.tsx`): no session → "Who is studying?" ("New profile" opens
  the onboarding, which makes the profile at its first step); a profile not yet onboarded → its
  onboarding; else the app. A 401 `no_session` anywhere returns to the gate.

## Tests

| Layer | Where | Runs on |
|---|---|---|
| Unit | each package's `test/` (`bun test`) | pure functions, checkers, queue, prompts |
| Server | `packages/server/test` | `createApp.request` on a temporary data root with the fixture course and a signed-in profile; fake `fetch` for models |
| Migrations | `packages/server/test/db.test.ts` | each migration upgrades a database of the version before it, with rows |
| Web | `apps/web/test` | happy-dom on an origin no server listens on; screens rendered with a filled query cache — a request fails the test |
| End to end | `e2e/` (Playwright) | the compiled binary, the fixture course, a fake OpenAI-compatible server, a profile signed in by a setup project; desktop and phone, Chromium and WebKit |
| Repository | `scripts/` | dependency rules, paths named in CLAUDE.md files and their Layout trees |

`bun run check` runs typecheck, lint, boundaries and all tests; `bun run e2e` builds the binary first.
