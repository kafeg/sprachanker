# packages/server

HTTP API, storage, jobs, sidecars, speech. Spec: `docs/spec/05-data-model.md`, `docs/spec/06-server.md`,
`docs/spec/08-speech.md`. May depend on: schema, engine, course-kit, courses/*, llm, anki-export.

## Layout (target)

```
src/
  index.ts           # startServer(config), importCourse(): called by `apps/cli` (`serve`, `import`)
  config.ts          # app-data folder, data root (--data, $SPRACHANKER_DATA, <app-data>/data)
  providers.ts       # content providers the server can import
  app.ts             # createApp + AppType (runtime-agnostic; apps/web type-checks it via `@sprachanker/server/app`)
  web.ts             # serving the built web app: SPA fallback, cache headers
  runtime/           # Bun-specific adapters: listen, web assets from a directory or embedded files
  config/            # app-data paths, config.json
  db/
    server/          # Drizzle schema + migrations for server.sqlite
    profile/         # Drizzle schema + migrations for profile.sqlite
    backup.ts        # copy-before-migrate, retention
  routes/            # (target) one file per API area once app.ts grows; today the routes live in app.ts
  services/          # business flows composing engine/llm/speech with storage; in-memory derived stats per profile
  jobs/              # import, model download; progress via SSE
  sidecars/          # whisper-server, TTS, later llama-server supervisors (spawn, health, restart)
  security/          # profiles, PIN, device tokens, secrets encryption, Host check, CSP
  speech/            # whisper-server and TTS HTTP clients: transcribe, synthesise
  media/             # Range responses for library media (read via course-kit) and profile files
test/                # bun test; integration tests call createApp().request()
```

## Rules

- Routes are thin: validate with schema, call a service, return schema-typed result.
- Events are append-only; never UPDATE or DELETE `events` (only deleting a whole profile removes them).
- Any change to a Drizzle schema → new migration + migration test with fixture DBs (`test/fixtures/db/`).
- Secrets are write-only through the API and never logged.
- Keep Bun-specific APIs behind `src/runtime/` so a Node fallback stays possible.
- `src/app.ts` and everything it imports stay free of Bun/Node APIs: the web client type-checks
  that graph without Bun types.
- Speech: always pass an explicit language; never pass the reference text to the recogniser.
- Exports a programmatic API used by `apps/cli` (serve, import, verify, export, enrich check).
