# packages/server

HTTP API, storage, course downloads, sidecars, speech. May depend on: schema, engine, course-kit,
courses/*, llm, anki-export.

## Layout

```
src/
  index.ts           # startServer(config), importCourse: called by `apps/cli` (`serve`, `import`)
  config.ts          # app-data folder, data root (--data, $SPRACHANKER_DATA, <app-data>/data)
  app.ts             # createApp + AppType (runtime-agnostic; apps/web type-checks it via `@sprachanker/server/app`)
  web.ts             # serving the built web app: SPA fallback, cache headers
  portable.ts        # what another runtime (the phone app) needs: createApp, schemas, migrations, the storage adapters, the
                     # interfaces its own adapters implement — no Bun, no Node
  storage/           # the data root over course-kit's DataFs, the same on the desktop and the phone: root.ts (DataRoot: files, pid,
                     # outbound fetch); installer.ts (providers: offers, import, the downloads' installer — marks on disk —, a course
                     # removed, the series' lock: withSeriesLock); model-files.ts (checked downloads into models/; voices for words);
                     # transfers.ts (transfer folders: swept, room on the disk, a file received or saved, a zip streamed);
                     # profile-transfer.ts (profile files: a snapshot zipped, a file read by its zip directory, unpacked, its database
                     # made ready by profile-db.ts over the runtime's SQLite — ProfileSql, SqlFiles — the exact schema first);
                     # course-transfer.ts (course bundles: files linked and zipped — a course, or every group (exportAll) —, read,
                     # what the library lacks unpacked, checked and installed by course-kit's bundle.ts under the lock, verified; one
                     # stopped midway undone at the start); decks.ts (deck folders written whole: replaceFolder; extras.json, media;
                     # .apkg uploads); deck-transfer.ts (deck files: zipped, read, unpacked, placed); practice.ts (addPractice, locked);
                     # readings.ts (what was read aloud, kept in cache/tts: made once, stopped once no request waits)
  runtime/           # Bun/Node adapters: listen, web assets, sqlite, secret key, data-root.ts (one server per data root: server.pid;
                     # nodeDataRoot over Node's files); process-name.ts (`ps` names a pid); lmstudio.ts (detect, `lms server start`);
                     # engines.ts (the engines built in native/ — also read by the build scripts —, their processes going with the
                     # server), model-files.ts (storage's over Node), speech.ts (whisper-server, Qwen3-TTS's tts-server), piper.ts
                     # (Piper's voices and runs), readings.ts (storage's reading cache over Node); backup.ts (a copy of each database a day; a backup on request); profile-sql.ts (ProfileSql
                     # over bun:sqlite: VACUUM INTO, a received database made ready in a Worker — profile-db-worker.ts); network.ts
                     # (IPv4 addresses, `.local` name, `tailscale status` / `serve status`); cli.ts (`claude` / `codex` for the
                     # command-line LLM providers); apkg.ts (what an .apkg needs: SQLite from bytes, zstd)
  db/
    server/          # Drizzle schema + migrations for server.sqlite
    profile/         # Drizzle schema + migrations for profile.sqlite
    migrate.ts       # forward-only migrations, a copy before migrating (five kept), newer databases refused
  once.ts            # one promise per key: a load, a hearing asked twice made once
  validate.ts        # request validation helper (input type for the client, output for the handler)
  errors.ts          # ServiceError(code, status): what a service refuses; errorResponse: how app.ts and routes/llm.ts answer it (and
                     # a request that does not validate)
  routes/            # one file per API area, mounted by app.ts: profiles (who is studying, signing in and out, a profile file
                     # imported — before the session check; the profile itself, its export — after it), courses (courses, catalog,
                     # downloads, a course removed, lesson content), lessons (lesson runs: /api/runs), progress (reset), exams, cards
                     # (a card's examples too), decks (imported: list, preview, import, an upload let go, delete; deck files; read
                     # aloud, examples), settings, notebook, recordings, speech, llm (removable as a whole; words selected kept in
                     # Finds: /api/llm/finds, their audio after: /finds/audio), network (the addresses the app is reached at); env.ts:
                     # what a profile's routes read (`c.var.s`, its services; `c.var.profileId`); params.ts: what several take alike
                     # (a run's id in the path, a batch of events, a deck taken)
  services/          # index.ts wires them: shared (content, decks, downloads, profiles, devices, network — this machine's tailnet
                     # name for the Host check, the addresses) and each profile's own (`of(id)`, made on first use; what one module
                     # needs of another is a function handed in here). By area:
                     # - stores: run-store (the only code on runs and events), card-store (on cards and card_state); over the run
                     #   store answers (numbered) and verdicts (kept, read)
                     # - lessons: lessons (lesson runs, progress, standing), lesson-journal (passes, a pass in full, an item across
                     #   passes), mistakes
                     # - exams: exams (the standing in each, the exams', an exam's Notebook page) over exam-runs (mock exams and
                     #   practice taken; overdue ones handed in on reading)
                     # - review: cards (from lesson words or an imported deck; decks taken, left; relinking; what a card shows in a
                     #   deck: `shown`), study (Anki's decks, queue, ratings, undo, bury, suspend, flags, marks; standing, a review
                     #   day in full), words, decks (imported .apkg decks, server-wide: preview, import — the same deck again updated
                     #   —, list, delete while no profile uses it; a profile's own deck — Finds, `owner` — grown a word at a time,
                     #   seen by it alone: `of`, gone with it; a deck file's deck merged in by lexeme), finds (words selected
                     #   anywhere: the model's card, added to the profile's Finds and made a card — unless a card of the word is there
                     #   —, read aloud after, on its own request), deck-extras (what is made for a deck's words, kept in its folder by
                     #   lexeme: extras.json read once, a job per deck and kind — its media known while it works —, what was made
                     #   removed, a deck file's merged in; no course folder written while its course is not installed), deck-transfer
                     #   (any deck as a file: made ready, previewed — told by content —, merged in; Finds the importer's own),
                     #   deck-audio (its words without audio read aloud: the engine and voice handed in by index.ts from
                     #   profile-speech, the deck's words — taken or not — from cards.ts), deck-examples (its words given examples by
                     #   a model handed in: five a call, a sentence without its word dropped, a word left without any asked again)
                     # - across modules: notebook (study days, each span's bars, the standings gathered), progress (resets; recordings
                     #   in use), content, settings, stored (a JSON value read by its schema), profile-transfer (a profile exported to
                     #   a file, a file imported as a new profile: the manifest, the checks, the content used and missing; the files:
                     #   TransferFiles), course-transfer (a course exported to a file, a file imported: the manifest and its checks,
                     #   the course installed; the files: CourseTransferFiles), transfers (what both share: exports made ready once,
                     #   one import at a time, a full disk)
                     # - AI, each task in the module whose run keeps its answers: llm (providers, keys, structured calls, previews;
                     #   llm-lmstudio, llm-prompts), lesson-context (the knowledge snapshot every lesson task takes: level — `levelOf`
                     #   —, place, words and topics met), in-flight (calls outliving the page, the step each is at) shared; explain,
                     #   text-maker (the text generator: drafts side by side, rated, written again), understanding (Reading's and
                     #   Listening's texts: questions read again, voices given, read ahead, a recording joined by wav.ts), writing (a
                     #   message answered: a task, a text checked), talk (Speaking: a monologue card or a role-play, what was said
                     #   checked); practice (a course's practice: variants made into it, the next untaken taken — keeping a verdict —,
                     #   read by the steps above), practice-jobs (a course's edition made in one go: the server's jobs, several units
                     #   at a time, stopped on request), practice-prep (the next variant taken as a lesson starts), going-over (the
                     #   pass's mistakes by type, new items checked by the engine), speaking, tutor (+ tutor-tools, courses-context),
                     #   scene (the Dialogue: out of the lesson, its runs read), exam-rating, exam-conversation (a speaking part's
                     #   script), examples
                     # - speech: speech (whisper-server; silence: a take's loudness, what is not speech of what Whisper heard — its
                     #   credits and made-up phrases by language: hallucinations.json), read-aloud (Piper; piper-voices.json from
                     #   scripts/piper-voices.ts), qwen-tts (the Base model for words a process of its own; every reading capped by
                     #   its text: maxTokens), word-voice (each language's voice for words: courses' recordings proposed, one taken —
                     #   a WAV the page decoded —, its reader), local-engines (SpeechHost, VoiceStore, ReadingCache, engineSidecar),
                     #   model-downloads, sidecar (the supervisor), profile-speech, recordings (the learner's audio)
                     # - downloads: course installs (queue, progress, resume; the installer injected)
  security/          # secrets.ts (AES-GCM sealing of API keys), host.ts (Host check, CSP and security headers), encoding.ts (base64,
                     # base64url, SHA-256)
  media.ts           # Range responses for library and deck folders' media and profile recordings (a type fixed by extension,
                     # sandboxed: mediaType); body limits (JSON 1 MB — every route but those taking a file —, audio); a large file's
                     # length as announced (none: no file)
test/                # bun test; integration tests call createApp.request — setup.ts signs a profile in and sends its cookie
                     # (`anonymous` sends none)
```

## Rules

- Routes are thin: validate the request, call a service, return its typed result (the web client gets the types through
  `AppType`).
- Routes of a profile read its services from the context (`c.var.s`), never from a closure: the session check sets them
  per request.
- Runs and events go through `services/run-store.ts` only, cards and their faces through `services/card-store.ts` only;
  no other module queries those tables (dependency-cruiser `server-tables-through-stores`). Event types and their
  payload schemas live in one registry (`EVENT_PAYLOADS`, schema `learner.ts`): checked when written and when read.
- Histories read the same way everywhere: a run replaced by a new one through `store.replace` (ends `abandoned` when
  unfinished, `finished` when complete as it is); `store.append` gives the events back as stored (one sent again as it
  was); verdicts kept with `keepVerdict` and read with `verdicts` (`services/verdicts.ts`), in one shape everywhere
  (`Verdict`: the payload with where and when); answers numbered by `appendAnswers` (`services/answers.ts`); turns and
  payloads with their time (`payloadOf`); several runs' events in one query (`store.eventsOf`); lists newest first, at
  most `HISTORY_LIMIT`; a stored row or JSON column that no longer reads is left out and logged (`readStored`), never
  failing the list.
- A model's stored answer records `model` and `latencyMs` (`stopwatch` in services/llm.ts).
- Events are append-only; never UPDATE or DELETE `events`. Only two things remove them (`store.remove`): deleting a
  profile, and the learner's confirmed request (resetting progress, deleting a tutor chat, leaving a deck: the answers
  to the cards that go).
- Learning modules (lessons, exams, review) connect through common connectors only (docs/architecture.md): each gives
  its `standing` in schema `stats.ts`'s shape, which index.ts hands to the Notebook; a module's services never import
  another module's, nor the Notebook or progress (dependency-cruiser `server-lessons-apart`, `server-exams-apart`,
  `server-review-apart`, `server-notebook-gathers`) — what one needs of another index.ts hands in as a function. The AI
  is no module: each of its task services is in the group of the module whose runs it works in.
- Any change to a Drizzle schema → new migration (`bun run db:generate`, hand-check the SQL) + a migration test that
  upgrades a database built by the earlier migrations, with rows in it.
- Secrets are write-only through the API and never logged. The key file is `<app-data>/secret.key` (outside the data
  root), read by `src/runtime/`.
- Outgoing requests to LLM providers go through the injected `fetch` (`AppConfig.fetch`); tests fake it.
- Command-line LLM agents run through the `CliHost` interface (services/llm.ts); LM Studio on this machine is reached
  through the `LmStudioHost` interface (services/llm-lmstudio.ts); the machine's networks and Tailscale through
  `NetworkHost` (services/network.ts); app.ts never spawns processes itself.
- Keep Bun-specific APIs behind `src/runtime/` so a Node fallback stays possible.
- `src/app.ts` and everything it imports stay free of Bun and Node imports and globals — of course-kit only
  `@sprachanker/course-kit/view`, no course (dependency-cruiser; those live in `src/runtime/`, `src/storage/`, `config.ts`
  and `index.ts`): the web client type-checks that graph without Bun or Node types. It names the storage adapters by type
  only: the runtime hands them in.
- `src/storage/` is the same code on every runtime: files through the DataRoot's DataFs (never `node:fs`, `Bun.file`),
  requests to other hosts through its `fetch`, SQLite through an interface the runtime implements (ProfileSql); what only
  Bun has stays in `src/runtime/`.
- Speech: an explicit language always; the reference text never to the recogniser (only to `said`, after it).
- Exports a programmatic API used by `apps/cli` (serve, import, verify, profiles — `profileAdmin` with export and import
  —, courses — `courseAdmin`: list, export, import —, backup).
