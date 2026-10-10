# packages/server

HTTP API, storage, course downloads, sidecars, speech. Spec: `docs/spec/05-data-model.md`,
`docs/spec/06-server.md`, `docs/spec/08-speech.md`. May depend on: schema, engine, course-kit,
courses/*, llm (and anki-export, planned: plan, "Anki decks and word images").

## Layout

```
src/
  index.ts           # startServer(config), importCourse(): called by `apps/cli` (`serve`, `import`)
  config.ts          # app-data folder, data root (--data, $SPRACHANKER_DATA, <app-data>/data)
  providers.ts       # content providers: offers, import, the installer behind downloads (marks on disk)
  app.ts             # createApp + AppType (runtime-agnostic; apps/web type-checks it via `@sprachanker/server/app`)
  web.ts             # serving the built web app: SPA fallback, cache headers
  runtime/           # Bun/Node adapters: listen, web assets, sqlite, secret key, data-root.ts (one server per
                     # data root: server.pid); process-name.ts (`ps` names a pid: ours or not);
                     # lmstudio.ts (detect, `lms server start`);
                     # speech engines: engines.ts (the engines built in native/ — also read by the
                     # build scripts —, where each is, their processes going with the server),
                     # model-files.ts (checked downloads into <data-root>/models), speech.ts
                     # (whisper-server and Qwen3-TTS's tts-server), piper.ts (Piper's voices and
                     # runs), readings.ts (what was read aloud, kept in cache/tts);
                     # backup.ts (a copy of each database a day);
                     # cli.ts (runs `claude` / `codex` for the command-line LLM providers)
  db/
    server/          # Drizzle schema + migrations for server.sqlite
    profile/         # Drizzle schema + migrations for profile.sqlite
    migrate.ts       # forward-only migrations, a copy before migrating (five kept), newer databases refused
  once.ts            # one promise per key: a load, a reading, a hearing asked twice made once (services
                     # and runtime alike)
  validate.ts        # request validation helper (input type for the client, output for the handler)
  errors.ts          # ServiceError(code, status): what a service refuses; errorResponse: how app.ts and
                     # routes/llm.ts answer it (and a request that does not validate)
  routes/            # one file per API area, mounted by app.ts: profiles (who is studying, signing in and
                     # out — before the session check; the profile itself — after it), courses
                     # (courses, catalog, downloads, lesson content), lessons (lesson runs: /api/runs), progress (reset), exams,
                     # cards (/api/cards), settings, notebook, recordings, speech, llm (removable as a whole); env.ts: what a
                     # profile's routes read (`c.var.s`, its services; `c.var.profileId`); params.ts:
                     # what several take alike (a run's id in the path, a batch of events)
  services/          # index.ts wires them: the shared content and downloads, profiles (server.sqlite:
                     # records, registration), devices (sign-in tokens), and
                     # each profile's own services (`of(id)`, made on first use); content; lessons (lesson runs,
                     # lesson progress, the lessons' standing); lesson-journal (a lesson's passes, a pass in
                     # full, an item across passes); progress (the learner's progress over every module:
                     # reset for a course, a lesson or an exam; the recordings answers hold); exams (the
                     # standing in each exam, the exams' standing, an exam's page in the Notebook) over
                     # exam-runs (mock exams and practice taken; overdue ones handed in on reading);
                     # run-store (the one module on runs and events: start, replace, end, append, read,
                     # remove); answers (numbered); verdicts (kept, read); card-store (the one module on cards and card_state); cards
                     # (cards from lesson words, relinking); study (Anki's decks, queue, ratings, undo,
                     # bury, suspend, flags, marks; review's standing); words (My words, the word sheet);
                     # notebook (the study days and every module's standing, gathered); settings;
                     # mistakes (derived from lesson runs); lesson-context (what LLM tasks know of a
                     # lesson); llm (providers, keys, the route's client, structured calls, prompt previews;
                     # llm-lmstudio: LM Studio's state, start, loads; llm-prompts: the learner's own
                     # prompts over the llm package's TASK_PROMPTS); explain ("Why is this
                     # wrong?", kept per attempt in the lesson run); tutor (lesson chats as `chat` runs);
                     # writing ("Write it yourself": checks kept in the lesson run); speaking (an
                     # answer said aloud checked by the model, kept on the item in the lesson run);
                     # scene (`scene` runs); exam-rating (an exam's open answer
                     # rated by the model: a proposal kept in the exam run); exam-conversation (a
                     # speaking part held with the model: its lines kept in the exam run);
                     # examples (AI examples of a card's word, kept on the card in the review run);
                     # recordings (the learner's audio in the profile's recordings folder); speech
                     # (whisper-server, its models: one engine for the server; course recordings
                     # heard once per model); read-aloud (Piper's voices — piper-voices.json, written by
                     # scripts/piper-voices.ts — downloads, a text read as a WAV); qwen-tts (Qwen3-TTS:
                     # models, the engine on the supervisor, a text read by a speaker); local-engines
                     # (what they share: SpeechHost, ReadingCache, an engine on the
                     # supervisor); model-downloads (theirs: progress, failure, cancel);
                     # profile-speech (a profile's choices applied: recognition, the
                     # engine, voice and speed reading aloud); sidecar (the supervisor of local
                     # engines: one start, idle stop, switching after requests in flight); stored
                     # (a stored JSON value read with its schema: unset when it does not read);
                     # in-flight (what a model is doing per lesson: structured calls outlive the page);
                     # tutor-tools (the tutor's tools on the learner's data); downloads (queue, progress,
                     # catalogue states, resume after restart; the installer is injected)
  security/          # secrets.ts (AES-GCM sealing of API keys), host.ts (Host check, CSP and security
                     # headers), encoding.ts (base64url, SHA-256)
  media.ts           # Range responses for library media and profile recordings; audio body limits
test/                # bun test; integration tests call createApp().request() — setup.ts signs a profile in
                     # and sends its cookie (`anonymous` sends none)
```

## Rules

- Routes are thin: validate the request, call a service, return its typed result (the web client
  gets the types through `AppType`).
- Routes of a profile read its services from the context (`c.var.s`), never from a closure: the
  session check sets them per request.
- Runs and events go through `services/run-store.ts` only, cards and their faces through
  `services/card-store.ts` only; no other module queries those tables (dependency-cruiser
  `server-tables-through-stores`). Event types and their payload schemas live in one registry
  (`EVENT_PAYLOADS`, schema `learner.ts`): checked when written and when read.
- Histories read the same way everywhere: a run replaced by a new one through `store.replace` (ends
  `abandoned` when unfinished, `finished` when complete as it is); `store.append` gives the events
  back as stored (one sent again as it was); verdicts kept with `keepVerdict` and read with
  `verdicts` (`services/verdicts.ts`), in one shape everywhere (`Verdict`: the payload with where and
  when); answers numbered by `appendAnswers` (`services/answers.ts`); turns and payloads with their
  time (`payloadOf`); several runs' events in one query (`store.eventsOf`); lists newest first, at
  most `HISTORY_LIMIT`; a stored row or JSON column that no longer reads is left out and logged
  (`readStored`), never failing the list.
- A model's stored answer records `model` and `latencyMs` (`stopwatch` in services/llm.ts).
- Events are append-only; never UPDATE or DELETE `events`. Only two things remove them (`store.remove`):
  deleting a profile, and the learner's confirmed request (resetting progress, deleting a tutor chat,
  leaving a deck: the answers to the cards that go).
- Learning modules connect through common connectors only (docs/architecture.md): each gives its
  `standing` in schema `stats.ts`'s shape, which index.ts hands to the Notebook; a module's services
  never import another module's, nor the Notebook or progress (dependency-cruiser
  `server-lessons-apart`, `server-exams-apart`, `server-review-apart`, `server-notebook-gathers`).
- Any change to a Drizzle schema → new migration (`bun run db:generate`, hand-check the SQL) + a
  migration test that upgrades a database built by the earlier migrations, with rows in it.
- Secrets are write-only through the API and never logged. The key file is `<app-data>/secret.key`
  (outside the data root), read by `src/runtime/`.
- Outgoing requests to LLM providers go through the injected `fetch` (`AppConfig.fetch`); tests fake it.
- Command-line LLM agents run through the `CliHost` interface (services/llm.ts); LM Studio on this machine is reached through the `LmStudioHost` interface (services/llm-lmstudio.ts); app.ts
  never spawns processes itself.
- Keep Bun-specific APIs behind `src/runtime/` so a Node fallback stays possible.
- `src/app.ts` and everything it imports stay free of Bun and Node imports and globals — of
  course-kit only `@sprachanker/course-kit/view`, no course (dependency-cruiser; those live
  in `src/runtime/`, `config.ts`, `providers.ts` and `index.ts`): the web client type-checks that graph
  without Bun or Node types.
- Speech: always pass an explicit language; never pass the reference text to the recogniser.
- Exports a programmatic API used by `apps/cli` (serve, import).
