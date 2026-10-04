# packages/server

HTTP API, storage, jobs, sidecar supervision. Spec: `docs/spec/05-data-model.md`, `docs/spec/06-server.md`.
May depend on: schema, engine, course-kit, courses/*, llm, speech, anki-export.

## Layout (target)

```
src/
  index.ts           # createServer(config): data root, Hono app, sidecars — started by `apps/cli` (`sprachanker serve`)
  config/            # app-data paths, config.json
  db/
    server/          # Drizzle schema + migrations for server.sqlite
    profile/         # Drizzle schema + migrations for profile.sqlite
    backup.ts        # copy-before-migrate, retention
  routes/            # one file per API area (auth, catalog, lessons, runs, review, notebook, cards, exams, llm, speech, settings, server, media, jobs)
  services/          # business flows composing engine/llm/speech with storage
  jobs/              # import, model download, rebuild; progress via SSE
  sidecars/          # whisper-server, TTS, later llama-server supervisors (spawn, health, restart)
  security/          # profiles, PIN, device tokens, secrets encryption, Host check, CSP
  library/           # resolve blob refs, Range responses, manifest access
```

## Rules

- Routes are thin: validate with schema, call a service, return schema-typed result.
- Events are append-only; never UPDATE or DELETE `events` (only deleting a whole profile removes them).
- Any change to a Drizzle schema → new migration + migration test with fixture DBs (`test/fixtures/db/`).
- Secrets are write-only through the API and never logged.
- Keep Bun-specific APIs behind `src/runtime/` so a Node fallback stays possible.
