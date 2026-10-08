# packages/server

HTTP API, storage, jobs, sidecars, speech. Spec: `docs/spec/05-data-model.md`, `docs/spec/06-server.md`,
`docs/spec/08-speech.md`. May depend on: schema, engine, course-kit, courses/*, llm, anki-export.

## Layout (target)

```
src/
  index.ts           # startServer(config), importCourse(): called by `apps/cli` (`serve`, `import`)
  config.ts          # app-data folder, data root (--data, $SPRACHANKER_DATA, <app-data>/data)
  providers.ts       # content providers: offers, import, the installer behind downloads (marks on disk)
  app.ts             # createApp + AppType (runtime-agnostic; apps/web type-checks it via `@sprachanker/server/app`)
  web.ts             # serving the built web app: SPA fallback, cache headers
  runtime/           # Bun/Node adapters: listen, web assets, sqlite, secret key; lmstudio.ts (detect, `lms server start`);
                     # speech.ts (finds and runs whisper-server, downloads models into <data-root>/models);
                     # cli.ts (runs `claude` / `codex` for the command-line LLM providers)
  config/            # app-data paths, config.json
  db/
    server/          # Drizzle schema + migrations for server.sqlite
    profile/         # Drizzle schema + migrations for profile.sqlite
    backup.ts        # copy-before-migrate, retention
  validate.ts        # request validation helper (input type for the client, output for the handler)
  errors.ts          # ServiceError(code, status): what a service refuses, mapped in app.ts onError
  routes/            # one file per API area, mounted by app.ts: profiles (who is studying, signing in and
                     # out — before the session check; the profile itself — after it), courses
                     # (courses, catalog, downloads, lesson content), runs (lesson runs, progress reset),
                     # cards (/api/cards), settings, notebook, recordings, speech, llm (removable as a whole); env.ts: what a
                     # profile's routes read (`c.var.s`, its services; `c.var.profileId`)
  services/          # index.ts wires them: the shared content and downloads, profiles (server.sqlite:
                     # records, PIN, registration), devices (sign-in tokens), and
                     # each profile's own services (`of(id)`, made on first use); content; runs (lesson runs,
                     # progress); run-store (the one module on runs and events: start, replace, end,
                     # append, read, remove); card-store (the one module on cards and card_state); cards
                     # (cards from lesson words, relinking); study (Anki's decks, queue, ratings, undo,
                     # bury, suspend, flags, marks); words (My words, the word sheet); notebook (study
                     # days, passes, a pass in full, an item across passes; read only); settings;
                     # mistakes (derived from lesson runs); lesson-context (what LLM tasks know of a
                     # lesson); llm (providers, LM Studio, prompt previews); explain ("Why is this
                     # wrong?", kept per attempt in the lesson run); tutor (lesson chats as `chat` runs);
                     # writing ("Write it yourself": checks kept in the lesson run); scene (`scene` runs);
                     # examples (AI examples of a card's word, kept on the card in the review run);
                     # recordings (the learner's audio in the profile's recordings folder); speech
                     # (whisper-server on demand, its models: one engine for the server);
                     # in-flight (what a model is doing per lesson: structured calls outlive the page);
                     # tutor-tools (the tutor's tools on the learner's data); downloads (queue, progress,
                     # catalogue states, resume after restart; the installer is injected)
  jobs/              # model downloads (later)
  sidecars/          # whisper-server, TTS supervisors (spawn, health, restart)
  security/          # secrets.ts (AES-GCM sealing of API keys), host.ts (Host check, CSP and security
                     # headers), encoding.ts (base64url, SHA-256)
  speech/            # whisper-server and TTS HTTP clients: transcribe, synthesise
  media/             # Range responses for library media (read via course-kit) and profile files
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
  `abandoned` when unfinished, `finished` when complete as it is); verdicts through `store.verdicts`;
  turns and payloads with their time (`payloadOf`); several runs' events in one query
  (`store.eventsOf`); lists newest first, at most `HISTORY_LIMIT`; a stored row or JSON column that no
  longer reads is left out and logged (`readStored`), never failing the list.
- A model's stored answer records `model` and `latencyMs` (`stopwatch` in services/llm.ts).
- Events are append-only; never UPDATE or DELETE `events`. Only two things remove them (`store.remove`):
  deleting a profile, and the learner's confirmed request (resetting progress, deleting a tutor chat).
- Any change to a Drizzle schema → new migration (`bun run db:generate`, hand-check the SQL) + a
  migration test that upgrades a database built by the earlier migrations, with rows in it.
- Secrets are write-only through the API and never logged. The key file is `<app-data>/secret.key`
  (outside the data root), read by `src/runtime/`.
- Outgoing requests to LLM providers go through the injected `fetch` (`AppConfig.fetch`); tests fake it.
- Command-line LLM agents run through the `CliHost` interface (services/llm.ts); LM Studio on this machine is reached through the `LmStudioHost` interface (services/llm.ts); app.ts
  never spawns processes itself.
- Keep Bun-specific APIs behind `src/runtime/` so a Node fallback stays possible.
- `src/app.ts` and everything it imports stay free of Bun/Node APIs: the web client type-checks
  that graph without Bun types.
- Speech: always pass an explicit language; never pass the reference text to the recogniser.
- Exports a programmatic API used by `apps/cli` (serve, import).
