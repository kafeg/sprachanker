# packages/server

HTTP API, storage, course downloads, sidecars, speech. Spec: `docs/spec/05-data-model.md`,
`docs/spec/06-server.md`, `docs/spec/08-speech.md`. May depend on: schema, engine, course-kit,
courses/*, llm, anki-export.

## Layout

```
src/
  index.ts           # startServer(config), importCourse(): called by `apps/cli` (`serve`, `import`)
  config.ts          # app-data folder, data root (--data, $SPRACHANKER_DATA, <app-data>/data)
  providers.ts       # content providers: offers, import, the installer behind downloads (marks on disk),
                     # the series' import lock (withSeriesLock: an import, a course bundle installed)
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
                     # backup.ts (a copy of each database a day; a backup on request into a folder);
                     # transfers.ts (transfer folders: swept, room on the disk, a file received or
                     # saved, a zip streamed — course-kit's zip.ts); profile-transfer.ts (profile files
                     # in profiles/.transfers: a snapshot streamed as a zip, a file read by its zip
                     # directory, unpacked, its database checked in a Worker: profile-db-worker.ts over
                     # profile-db.ts — the exact schema first); course-transfer.ts (course bundles in
                     # library/.transfers: a course's files linked and streamed as a zip, a bundle read,
                     # what the library lacks unpacked, checked and installed by course-kit's bundle.ts
                     # under the series' import lock, then verified);
                     # network.ts (the machine's IPv4 addresses, its `.local` name, `tailscale status`
                     # and `tailscale serve status` as JSON);
                     # cli.ts (runs `claude` / `codex` for the command-line LLM providers);
                     # decks.ts (imported decks' folders, written whole; a deck folder's extras.json and
                     # media read aloud — an imported deck's or a course's; packages uploaded, streamed to
                     # decks/.uploads; swept at the start; SQLite from bytes and zstd for reading an .apkg)
  db/
    server/          # Drizzle schema + migrations for server.sqlite
    profile/         # Drizzle schema + migrations for profile.sqlite
    migrate.ts       # forward-only migrations, a copy before migrating (five kept), newer databases refused
  once.ts            # one promise per key: a load, a reading, a hearing asked twice made once
  validate.ts        # request validation helper (input type for the client, output for the handler)
  errors.ts          # ServiceError(code, status): what a service refuses; errorResponse: how app.ts and
                     # routes/llm.ts answer it (and a request that does not validate)
  routes/            # one file per API area, mounted by app.ts: profiles (who is studying, signing in and
                     # out, a profile file imported — before the session check; the profile itself, its
                     # export — after it), courses
                     # (courses, catalog, downloads, lesson content), lessons (lesson runs: /api/runs),
                     # progress (reset), exams, cards (a card's examples too), decks (imported: list,
                     # preview, import, an upload let go, delete; any deck's words read aloud or given
                     # examples), settings, notebook, recordings, speech, llm (removable as a whole),
                     # network (the addresses the app is reached at); env.ts: what a profile's routes
                     # read (`c.var.s`, its services; `c.var.profileId`); params.ts: what several take
                     # alike (a run's id in the path, a batch of events, a deck taken)
  services/          # index.ts wires them: shared (content, decks, downloads, profiles, devices, network —
                     # this machine's tailnet name for the Host check, the addresses) and each
                     # profile's own (`of(id)`, made on first use; what one module needs of another is
                     # a function handed in here). By area:
                     # - stores: run-store (the only code on runs and events), card-store (on cards and
                     #   card_state); over the run store answers (numbered) and verdicts (kept, read)
                     # - lessons: lessons (lesson runs, progress, standing), lesson-journal (passes, a
                     #   pass in full, an item across passes), mistakes
                     # - exams: exams (the standing in each, the exams', an exam's Notebook page) over
                     #   exam-runs (mock exams and practice taken; overdue ones handed in on reading)
                     # - review: cards (from lesson words or an imported deck; decks taken, left;
                     #   relinking), study (Anki's decks, queue, ratings, undo, bury, suspend, flags,
                     #   marks; standing, a review day in full), words, decks (imported .apkg decks, server-wide: preview,
                     #   import — the same deck again updated —, list, delete while no profile uses it),
                     #   deck-extras (what is made for a deck's words, kept in its folder by lexeme:
                     #   extras.json read once, a job per deck and kind, sweeping course folders),
                     #   deck-audio (its words without audio read aloud: the engine and voice handed in by
                     #   index.ts from profile-speech, the words from the profile's cards in the deck),
                     #   deck-examples (its words given examples by a model handed in: five a call, a
                     #   sentence without its word dropped, a word left without any asked again)
                     # - across modules: notebook (study days, each span's bars, the standings gathered), progress (resets;
                     #   recordings in use), content, settings, stored (a JSON value read by its schema),
                     #   profile-transfer (a profile exported to a file, a file imported as a new profile:
                     #   the manifest, the checks, the content used and missing; the files: TransferFiles),
                     #   course-transfer (a course exported to a file, a file imported: the manifest and
                     #   its checks, the course installed; the files: CourseTransferFiles), transfers
                     #   (what both share: exports made ready once, one import at a time, a full disk)
                     # - AI (07), each task in the module whose run keeps its answers: llm (providers,
                     #   keys, structured calls, previews; llm-lmstudio, llm-prompts), lesson-context
                     #   (the knowledge snapshot every lesson task takes: level — `levelOf` —, place,
                     #   words and topics met), in-flight (calls outliving the page) shared; explain, writing, speaking, tutor
                     #   (+ tutor-tools; courses-context: what the Tutor section's chats know, the
                     #   languages a new one can practise), scene;
                     #   exam-rating, exam-conversation; examples (a deck's job with the profile's model
                     #   and context, a card's examples marked)
                     # - speech (08): speech (whisper-server), read-aloud (Piper; piper-voices.json from
                     #   scripts/piper-voices.ts), qwen-tts, local-engines (SpeechHost, ReadingCache,
                     #   engineSidecar), model-downloads, sidecar (the supervisor), profile-speech,
                     #   recordings (the learner's audio)
                     # - downloads: course installs (queue, progress, resume; the installer injected)
  security/          # secrets.ts (AES-GCM sealing of API keys), host.ts (Host check, CSP and security
                     # headers), encoding.ts (base64url, SHA-256)
  media.ts           # Range responses for library and deck folders' media and profile recordings; body limits
                     # (JSON 1 MB — app.ts, every route but those taking a file —, audio); a large file's
                     # length as announced (deck packages, profile files: none, no file)
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
- Learning modules (lessons, exams, review) connect through common connectors only
  (docs/architecture.md): each gives its `standing` in schema `stats.ts`'s shape, which index.ts hands
  to the Notebook; a module's services never import another module's, nor the Notebook or progress
  (dependency-cruiser `server-lessons-apart`, `server-exams-apart`, `server-review-apart`,
  `server-notebook-gathers`) — what one needs of another index.ts hands in as a function. The AI is
  no module: each of its task services is in the group of the module whose runs it works in.
- Any change to a Drizzle schema → new migration (`bun run db:generate`, hand-check the SQL) + a
  migration test that upgrades a database built by the earlier migrations, with rows in it.
- Secrets are write-only through the API and never logged. The key file is `<app-data>/secret.key`
  (outside the data root), read by `src/runtime/`.
- Outgoing requests to LLM providers go through the injected `fetch` (`AppConfig.fetch`); tests fake it.
- Command-line LLM agents run through the `CliHost` interface (services/llm.ts); LM Studio on this machine is reached through the `LmStudioHost` interface (services/llm-lmstudio.ts); the
  machine's networks and Tailscale through `NetworkHost` (services/network.ts); app.ts never spawns
  processes itself.
- Keep Bun-specific APIs behind `src/runtime/` so a Node fallback stays possible.
- `src/app.ts` and everything it imports stay free of Bun and Node imports and globals — of
  course-kit only `@sprachanker/course-kit/view`, no course (dependency-cruiser; those live
  in `src/runtime/`, `config.ts`, `providers.ts` and `index.ts`): the web client type-checks that graph
  without Bun or Node types.
- Speech: always pass an explicit language; never pass the reference text to the recogniser.
- Exports a programmatic API used by `apps/cli` (serve, import, verify, profiles — `profileAdmin` with
  export and import —, courses — `courseAdmin`: list, export, import —, backup).
