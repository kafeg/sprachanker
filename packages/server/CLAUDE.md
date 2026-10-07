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
                     # cli.ts (runs `claude` / `codex` for the command-line LLM providers)
  config/            # app-data paths, config.json
  db/
    server/          # Drizzle schema + migrations for server.sqlite
    profile/         # Drizzle schema + migrations for profile.sqlite
    backup.ts        # copy-before-migrate, retention
  validate.ts        # request validation helper (input type for the client, output for the handler)
  errors.ts          # ServiceError(code, status): what a service refuses, mapped in app.ts onError
  routes/            # one file per API area that can be removed as a whole: llm.ts (/api/llm); the rest in app.ts
  services/          # content, runs (lesson runs, progress), settings, run-store (the one module on the
                     # runs and events tables: start, end, append, read, remove), mistakes (derived from
                     # lesson runs), lesson-context (what LLM tasks know of a lesson), llm (providers,
                     # LM Studio, prompt previews), explain ("Why is this wrong?", kept per attempt in the
                     # lesson run), tutor (lesson chats as `chat` runs, the chat history), writing ("Write
                     # it yourself": checks kept in the lesson run), scene (role-plays as `scene` runs),
                     # tutor-tools (the tutor's tools on the learner's data), cards (cards from lesson
                     # words, Anki's decks, study queue, ratings, undo, bury, suspend, flags; My words and
                     # the word sheet), downloads (course downloads: queue, progress, catalogue states,
                     # resume after restart; the installer is injected)
  jobs/              # model downloads (later)
  sidecars/          # whisper-server, TTS supervisors (spawn, health, restart)
  security/          # secrets.ts (AES-GCM sealing of API keys), host.ts (Host check, CSP and security
                     # headers); later profiles, PIN, device tokens
  speech/            # whisper-server and TTS HTTP clients: transcribe, synthesise
  media/             # Range responses for library media (read via course-kit) and profile files
test/                # bun test; integration tests call createApp().request()
```

## Rules

- Routes are thin: validate the request, call a service, return its typed result (the web client
  gets the types through `AppType`).
- Runs and events go through `services/run-store.ts` only; no other module queries those tables.
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
