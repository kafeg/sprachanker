# 05 — Data model and storage

## Locations

```
<app-data>/                      # $SPRACHANKER_APP_DATA, else OS-specific (config.ts): ~/Library/Application Support/SprachAnker, %APPDATA%\SprachAnker, ~/.local/share/sprachanker
└── secret.key                   # seals the profiles' API keys (06, Security)

<data-root>/                     # --data, else $SPRACHANKER_DATA, else <app-data>/data
├── library/                     # installed courses (02)
├── library/.transfers/<id>/     # a course bundle being exported or imported (02, "Course bundle"); swept
│                                # as a profile file's transfer, a course folder an install put aside back
├── decks/<deck-id>/             # imported decks (04, "Decks"): deck.json (schema `deck.ts`: the words with
│                                # the deck's own examples, their languages, the file it came from) and media/
│                                # (the audio the .apkg brought, `<slug>-<hash of its name>.<ext>`; an update
│                                # keeps the earlier files and extras.json); a folder written whole (beside,
│                                # then renamed into place). Beside deck.json: extras.json (schema `deck.ts`
│                                # `DeckExtras`, by lexeme key — a deck's cards are one per lexeme —: the
│                                # audio read aloud for a word without its own, its engine, voice and text)
│                                # with that audio in media/ (`read-<hash of engine, voice, text>.wav`; an
│                                # entry an earlier version keyed by the note's guid is left out when read);
│                                # the AI's examples for a word by the language they are translated into
│                                # (sentence, translation, glossary, the word's form in it; the model, when);
│                                # read entry by entry (`DeckExtrasWord`): one that does not read — a newer
│                                # version's — is logged, left out and written back as it was
├── decks/course~<series>~<course>/ # a course's deck (every edition's): extras.json and media/ as an
│                                # imported deck's (04, "Decks"); gone when the course is no longer installed
│                                # (server start; a course whose files do not read keeps it)
├── decks/.uploads/              # .apkg files uploaded and previewed, kept until imported or their sheet is
│                                # closed (a day at most); an imported one's note of the deck it made
│                                # (<upload>.deck, a day). At the server's start uploads a day old and the
│                                # folders a stopped import left (`.<id>.tmp-…`) go; a deck left only as the
│                                # folder it was being replaced by (`….old`) is back
├── models/                      # downloaded speech models; voices/ Piper's voices; engines.pid (06) (08)
├── cache/tts/                   # texts read aloud by Piper (by voice, speed, text) and Qwen3-TTS (08)
├── server.sqlite                # profiles, devices, server settings
├── server.pid                   # the running server's pid: one server per data root (06)
├── profiles/<profile-id>/       # `local` is the first
│   ├── profile.sqlite           # all learner data of this profile
│   └── recordings/              # learner audio as captured (<ulid>.<ext>), referenced from answers (08);
│                                # a take no answer holds goes when the profile opens, a day old
└── profiles/.transfers/<id>/    # a profile file being exported or imported ("Profile file"); gone when
                                 # it ends, an hour old at most
```

- One profile = one folder: backup, move, export and deletion of a person's data are folder operations.
- The library never contains learner data; profiles never contain course content. Imported decks are
  the server's, as the library is: every profile takes them; their cards are each profile's.
- Large downloads (courses, speech models) live in the data root, on the disk the user chose; keys
  stay in app-data. LLM models are LM Studio's business (07).
- The server creates the data root when it starts on it and holds it with `server.pid`
  (`runtime/data-root.ts`).
- Planned: structured logs (plan, "Open items in built areas", Server).

## `server.sqlite`

`packages/server/src/db/server/schema.ts`, its own migrations (`db/server/migrations`):

- `profiles(id, name, colour, onboarded, created_at)` — `local` is the first profile
- `devices(id, profile_id, token_hash, user_agent, created_at, last_seen_at)` — the token only in the
  device's cookie
- `server_settings(key, value_json)` — `registration` (on by default), set by the command

## `profile.sqlite`

All ids are ULIDs; all content references use keys from 02. Built: `settings`, `secrets`, `llm_routes`,
`runs`, `events`, `cards`, `card_state` (`packages/server/src/db/profile/schema.ts`). A card's
`display_cache_json` holds what it shows (headword, gender, plural, translation, an example, audio, the
lesson it was met in — or the imported deck it was taken from); `faces` is a comma-separated list.

```sql
settings(key TEXT PRIMARY KEY, value_json TEXT)          -- every key with its schema and owner
                                                         -- (packages/schema/src/settings.ts): checked
                                                         -- when written, parsed when read (a value that
                                                         -- no longer fits reads as unset); an unset
                                                         -- preference reads as its SETTING_DEFAULTS value
secrets(provider_id TEXT PRIMARY KEY, value_encrypted)   -- the profile's API keys; never returned by the API
llm_routes(task TEXT PRIMARY KEY, provider_id, model)   -- the profile's model (07); only
                                                         -- task 'default' is used (per-task routes: plan, "Later")

runs(
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,             -- lesson | exam | review | scene | chat
  context_key TEXT,               -- lesson key for lesson, chat and scene runs; exam key; null for review
                                  -- and for a chat of the Tutor section (about no lesson)
  course_key TEXT, edition TEXT, -- null when not tied to one course
  app_version TEXT NOT NULL,      -- the app's version when the run started
  plan_json TEXT,                 -- a scene's setup; an exam run's ExamPlan (mode, questions with their
                                  -- sections, deadline, a mock exam's questions as shown, the module
                                  -- taken alone); null otherwise
  status TEXT NOT NULL,           -- active | finished | abandoned
  end_reason TEXT,                -- completed | timeout | content_updated | user
  started_at INTEGER NOT NULL, finished_at INTEGER,
  result_json TEXT                -- LessonResult, ExamResult (schema `learner.ts`)
);
events(
  id TEXT PRIMARY KEY,            -- ULID generated by the client = idempotency key
  run_id TEXT NOT NULL REFERENCES runs(id),
  ts INTEGER NOT NULL,            -- assigned by the server on receipt
  device_id TEXT,                 -- the signed-in device that sent it (lesson events, ratings)
  type TEXT NOT NULL,
  item_key TEXT, card_id TEXT,
  payload_json TEXT NOT NULL      -- per-type shape, validated by schema
);
cards(
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,             -- lexeme (the only kind made)
  lexeme_key TEXT,                -- unique with translation_lang (04, "Spaced repetition")
  translation_lang TEXT NOT NULL, -- the edition's source language its translation is in
  source_key TEXT,                -- vocab occurrence or item key where it was met; an imported deck's
                                  -- word: deck:<id>/<its note's guid> (schema `deckSourceKey`)
  origin_run_id TEXT,             -- the run it was created in, if any: the lesson run of its "Words"
                                  -- step; set null when deleted
  faces TEXT NOT NULL,            -- enabled faces
  display_cache_json TEXT,        -- last rendered content, so cards survive course removal
  suspended INTEGER NOT NULL DEFAULT 0,   -- the note suspended
  marked INTEGER NOT NULL DEFAULT 0,      -- the note marked (Anki: mark note, *)
  created_at INTEGER NOT NULL
);
card_state(card_id, face,
  fsrs_json,                      -- null while the face is new (its due date inside)
  suspended, buried_until, flag,  -- Anki's card: suspended, buried until the next day, flag 0–7
  PRIMARY KEY(card_id, face))
```

What a run is (owner, 2026-10-07: one rule for every history): a pass through a lesson (`lesson`), a
day of card reviews (`review`), and each conversation — a tutor chat (`chat`), a scene (`scene`) — is
its own run about its lesson — or, a chat of the Tutor section (07), about none: its context null, its
edition the pair it practises (the edition of the course studied most recently when it began), no
course, so resetting a course's progress leaves it. A one-off verdict of the model on the learner's work (an explanation, a
writing check, a spoken answer's check) is an `llm_verdict` event of the lesson run it was given in, also a finished one; the
lesson's earlier ones are read across its runs. Resetting a lesson's progress deletes all of them.

An exam run (`exam`, about its exam) is a mock exam or practice (04, "Exams"); a new practice
abandons the exam's active practice, and no run starts while a mock exam runs (409
`exam_test_running`: it is handed in first). Each answer is an `answered` event on its question
(`item_key`), only to the run's own questions; the latest answer to a question counts. The plan keeps
each question's section, and a mock exam its questions as shown, so the run reads and scores the same
whatever the catalogue becomes. A mock exam takes answers until 30 s after its deadline; past that it
is handed in as it stands (`timeout`) — by a late answer, or when the exam is next looked at. A
running one's outcomes are stored but given out nowhere (its run, the exam's stats, readiness) until
it is handed in.
The JSON columns' stored shapes are on record like the payloads (`packages/schema/test/stored-runs/`)
and only grow.

## Events

| Event type | Payload (required fields) |
|---|---|
| `page_shown` | `pageIndex`; `exerciseKey` (attached by the server: the exercise on that page); the first time an exercise is shown in a run, its `snapshot` as displayed (`{exercise, locale}`, attached by the server and written whole; one that no longer reads is dropped when read, not its event) |
| `answered` | `answer` (02; spoken answers carry `speech{recording?, transcript}`: the recording only when recordings are kept), `outcome` (04, computed by the server), `attempt` (numbered by the server after the item's answers the run holds), `ms` |
| `item_skipped` | — (`itemKey`): the learner moved on without answering (Skip, nothing given at Check, a speaking item not recorded); excluded from the score |
| `step_done` | `step` (`words`, `grammar:<n>`, `culture:<n>`, `writing`, `scene`, `mistakes`), `skipped?`: a step of the lesson plan besides its exercises done or skipped; the latest record of a step counts |
| `llm_verdict` | `task` (`writing` \| `explain` \| `example` \| `speaking` \| `exam`), `input` (the learner's text, an exam's open answer; the word of an example; what was heard of a spoken answer; empty otherwise), `result` (the task's structured output, 07 — one schema per task in `schema/src/assistant.ts`, checked when written and read; an explanation's text), `model`, `latencyMs`; a writing check in the lesson run the lesson shows; an explanation in the lesson run, on its `itemKey`, with `attempt` (the answer it explains); an example in the day's review run, on its `cardId`; a spoken answer's check in the lesson run, on its `itemKey`, matched to the answer by `input`; an exam's open answer rated by its criteria (a proposal: scores nothing until taken as an `exam_rated`) in the exam run, on its `itemKey`, matched to the answer by `input` |
| `llm_turn` | `role`, `text`, `model?` and `latencyMs?` (assistant), `exerciseKey?` (tutor: the exercise on screen), `tools?[{name,args}]` (tutor: tools called for the reply), `start?` (the Tutor section: a learner's turn sent for them, a way into the chat); scenes add `translation`, `corrections[{wrong,right,explanation}]`, `goalsMet[]`; an exam's speaking part held with the assistant: its lines on the question's `itemKey` in the exam run, the model's with `speaker` (`examiner` \| `partner`) and `done` on the line closing the part |
| `card_review` | `face`, `rating` (1–4), `stateBefore` (null for a new face), `stateAfter` (FSRS state, times in ms), `ms?` (how long the card was shown before the rating, at most a minute; answers from before 2026-10-11 have none) on its `card_id`, in the day's `review` run (a new one each study day, 04) |
| `card_undo` | `review` (the `card_review` event taken back): the face is as before it; the day's counts leave it out |
| `exam_rated` | `ratings` (a level's points per criterion), `by` (`self` \| `assistant`: the assistant's proposal taken unchanged), `model?`: an exam's open answer rated, on its `itemKey`, in its run — also one handed in, whose result is then computed anew (`store.rescore`); the latest counts |

Payload schemas: `packages/schema/src/learner.ts` (`EVENT_PAYLOADS`, one per type). **Payloads keep
reading**: a field is added (optional), never renamed or narrowed; every shape stored so far is
on record in `packages/schema/test/stored-events/` and must keep reading. A field of a non-strict
object (a payload, an `outcome`; not the library schemas a `page_shown` snapshot embeds) is removed
only when nothing reads it and it holds nothing the events do not hold otherwise: a stored payload that
carries it still reads, without it. So an answer's `outcome` lost `ruleIds` and `lexemes` (every
provider wrote them empty) and `needsLlm` (always true for `respond`: the item's type says it). A change that cannot be
additive comes with an upgrade of the stored events (a migration), not an edit of the record.

Runs and events are written and read only through the run store (`packages/server/src/services/
run-store.ts`): a run is ended once, only while active; events of one request are stored in one
transaction, all or nothing, each payload checked against its type's schema; events are read back
parsed, and a stored row that no longer parses is left out (and logged), never breaking the list.

- **Sending** (the web's outbox, `apps/web/src/api/outbox.ts`, and a run's events over it,
  `api/run-events.ts`, the same for a lesson's and an exam's): a run's events go out in order, one
  queue per lesson or exam run, each event to the run it was recorded in (a batch never mixes two), idempotent
  by id. Not reached or a 5xx: sent again after 2 s, doubling up to a minute. A lost session (401), a
  wrong host (421), 408 and 429 keep the events for later. Any other 4xx, or a run no longer there to
  send to: the batch is sent again event by event (the server keeps a batch whole or not), an event
  refused alone is dropped and the run is read again. A new event while it waits to retry sends at
  once. Each profile has its own queues: events of a profile signed out wait until it is back; the
  server's outcome and attempt of each answer replace the local ones. A lesson
  opened again reads its run anew, keeping what is still on its way and what was stored meanwhile; a
  read that fails is tried again without dropping them.
- Events are append-only: no UPDATE or DELETE. Deleting a recording removes the file; the event keeps
  its name and the UI shows "deleted".
- **Resetting progress** is the exception, on the learner's confirmed request: for a course (it then
  leaves "My courses") or one lesson, every run of it — lesson runs with their kept explanations, tutor
  chats, writing checks and reviews, scenes — is deleted with its events, and so are the cards it made
  (the words first met there: the lesson each card names in its display, which outlives the run that
  made it) with their faces and every answer to them; a card made by another lesson stays (owner,
  2026-10-07). For one exam (it then leaves "My exams"): its mock exams and practice runs with their
  events and recordings. The course stays installed. Deleting one tutor
  chat from the lesson's chat history or the Tutor section, also confirmed, deletes that `chat` run
  with its events.
  Leaving a deck (04, "Decks to take"), also confirmed, deletes the answers to the cards it removes.
- Snapshots make old runs readable after content changes or course removal.
- Indexes: `events(run_id, ts)` (a run's events), `events(type, ts)` (the day's card answers,
  verdicts, activity).
- `card_state` is written in the same transaction as each `card_review` and `card_undo` event; its
  FSRS state can be recomputed from those events.

## Derived state

Statistics (lesson progress and best scores, item history, mistakes, study days) are **pure engine
functions over events and cards** (04, "Learner model"). The server computes them per profile when asked
(an in-memory cache is added when needed). There are no derived tables; one is added only when a measured
query is too slow, and then it must be rebuildable from events.

Resume reads the last `page_shown` of the active run (04). A pass in the Notebook shows each exercise
by its snapshot, found by exercise key.

## Migrations

- Drizzle migrations, forward-only, one set per database (`profile.sqlite`, `server.sqlite`); every
  profile's database is migrated when the server starts (one that cannot be stops it).
- Before migrating, the file is copied to `<file>.bak-<timestamp>`; the last 5 are kept. Each
  migration runs in a transaction; a failed one is rolled back and the server refuses to start with an
  explanation.
- The server refuses to open a DB that has migrations it does not know (downgrade protection).
- Each migration has a test that upgrades a database of the version before it (10). Until the first
  release the set may be squashed into one `0000_init`; after a release, never.

## Backups, export, import

- **Daily copies** (built, `runtime/backup.ts`): `server.sqlite` and every `profile.sqlite` copied with
  `VACUUM INTO` beside the file as `<file>.day-<date>` when the server starts and every six hours for
  a day without one; the last seven kept. They hold everything but recordings and the library. A copy
  is written as `<copy>.part` and renamed when whole, so a cut-short copy never counts as the day's.
  A profile's copies are in its folder: deleting the profile deletes them too (a deletion is final,
  and nothing of a person is left behind).
- **What to keep** (a backup of one's own; `sprachanker backup`, 06, copies it): what cannot be
  fetched again — `server.sqlite` (profiles, the server's settings), `profiles/` (each profile's
  database and recordings; its daily copies are copies of the same) and `decks/` (an imported deck is
  made again only from its `.apkg`; the audio and examples made for its words cost an engine's or a
  model's time) — and `<app-data>/secret.key`, outside the data root: without it the API keys stored
  in a restored profile cannot be read (they are entered again). The library can be fetched again
  (the sources may have changed since); `models/` and `cache/` are disposable. Restoring is copying
  `server.sqlite`, `profiles/` and `decks/` into a data root and the key into app-data, with no
  server running on it (owner, 2026-10-11: a documented list and the command; default, owner may
  change).
- **Profile file** (built): one profile moved between one's own machines as a file (owner,
  2026-10-11: one's own machines only, nothing about sharing with others; default, owner may change).
  Below.
- The library is re-downloadable and copied per series (02).

## Profile file

`<name>-<date>.sprachanker-profile` (default, owner may change): a zip of stored entries (course-kit
`zip.ts`, 10; at most 4 GB, `PROFILE_FILE_MAX_BYTES`), schema `profile-file.ts`:

```
manifest.json         # first: format `sprachanker-profile` and its version, the app's version, when;
                      # the profile's name and colour; the migrations its database has; the content it
                      # used — courses (its lessons', chats', scenes' runs, its cards' words) and exams by
                      # key with their editions and titles, imported decks by id with their titles;
                      # what it leaves out (the providers whose API keys were stored, those whose
                      # endpoint's address held a user name or password); each other file with its
                      # size and sha256
profile.sqlite        # the profile's database, `VACUUM INTO` (consistent while the server writes), its
                      # `secrets` emptied and vacuumed away: the sealed API keys are not in the file;
                      # a user name or password taken out of each `llm.endpoints` address
recordings/<ulid>.<ext>
```

- Not in it: API keys and logins in endpoints' addresses (entered again on the new machine; the
  result says whose), the
  devices signed in (`server.sqlite`'s), the daily and pre-migration copies, the library and imported
  decks (they are named, not carried; a content version per course comes with the series manifest,
  02).
- **Export** (Settings → Profile, `profiles export`): the database copied and the recordings linked
  (copied where the disk has no hard links) into `profiles/.transfers/<id>/`, each file hashed, then
  streamed as the zip — the command line's file its owner's only (0600) —; the transfer goes when the
  file is written or the download ends or stops (one never downloaded, after an hour). One a profile: a new one replaces the one not yet downloaded, and
  asked for again while it is made it is the same one. The disk is checked for room for the copy
  first, with a margin left free — the larger of 1 GB and 5 % of the disk, for imports too — (507
  `not_enough_space`; a disk that fills up meanwhile gives the same).
- **Import** (who is studying, `profiles import`) always makes a **new** profile (owner, 2026-10-11:
  never replacing one; default, owner may change): its name kept, or "Name (2)", "Name (3)"… while
  another profile has it; its colour; onboarded. One at a time (409 `profile_import_busy` beside it).
  All or nothing — everything happens in
  `profiles/.transfers/<id>/`, moved into `profiles/<new id>` only once checked (marked `.importing`
  until its row is made: a process stopped in between, the folder goes at the next start), then the
  profile is made; any failure removes the transfer, and nothing of it is left:
  1. the file streamed to disk (an upload: its length announced, 06; room for it twice — the file and
     what it unpacks to — checked first; 413 `profile_file_too_large` past 4 GB);
  2. read by its zip directory, believed only as far as it is checked: the directory right before the
     end record (or the ZIP64 end record, right before its locator), at most 16 MB and no larger than its entries need, short names and fields, each
     entry's local header the same as its directory entry, the entries in order and none overlapping
     another; a manifest that reads, stored entries only, only `profile.sqlite` and
     `recordings/<ulid>.<ext>`, each once — else 422 `not_a_profile_file`; a newer format or a
     migration this app does not know: 422 `profile_from_newer_app`; the files exactly those listed,
     each unpacked streaming and hashed (room for them and the copy made before migrating checked
     first), the first whose size or sha256 is not as listed ending it — 422 `profile_file_damaged`;
  3. the database, apart from the server's work (a Worker; one not done in 30 minutes is refused): the
     file is untrusted, and views, triggers, CHECK constraints and indexed expressions are SQL of its
     own that runs when it is read or written. So, opened read-only with `trusted_schema` off, nothing
     is read of it but `sqlite_master`, which must be exactly — whitespace aside — what this app's
     migrations make after one or more of them (each such schema made once in memory): its tables and
     indexes, nothing more (no view, trigger, virtual table, `sqlite_stat*`). Only then: sound
     (`integrity_check`, its references); its `_migrations` exactly those that make that schema —
     a migration this app does not know is `profile_from_newer_app` (also when the manifest does not
     say so) —; migrated forward by the usual migrations (with the usual copy before, Migrations); its
     `secrets` emptied, and of `llm.endpoints` only those of providers whose address is editable kept
     (07). Anything else: `profile_file_damaged`.
  The result: the new profile, what the file left out, and the content it used that is not here
  (courses or editions not installed, exams, imported decks): imported all the same — its runs read
  by their snapshots and its cards by their display, as after a course is removed (Lifecycle); the
  lessons show once the course is downloaded.
- A transfer folder is no profile: the daily copies and backups pass over `profiles/.*`.
- Transfers left behind (a process stopped) go when an export or import begins, by their folder's
  time: an hour old. Never one this process is using (it knows its own); a download or an upload
  under way marks its folder's time at least once a minute, for another process's sweep; and the
  command line sweeps nothing while a server runs on the data root (they are the server's).

## Lifecycle

- One server process owns all DB files (WAL mode); devices are clients. A connection waits up to 5 s
  for another's write (the command line beside a server, a daily copy) before it fails.
- One active run per (profile, context) and one active review run per profile — but the Tutor
  section's chats (context none): each stays active until deleted, any of them continued (07). Any device of the
  profile may continue it; events from all devices are stored (idempotent by id).
- **Opening a lesson starts nothing**: the step shown is in the page's address (`?step=`), so a reload
  stays on it (owner, 2026-10-07); opened without one, it shows its active run (in whichever edition it was started) (resumed on its last page,
  every exercise with its latest answers and outcomes), else the latest finished run read-only, else the
  overview. A run starts with "Start" or with opening a page — by moving to it or by an address that
  opens on it (a link, a reload of a lesson never started), so nothing answered goes without a run to
  be stored in; a run started on the page shows the step it was started on (it is not resumed elsewhere
  as one opened later is); "Start over" ends the active run
  `abandoned/user` and begins a new one.
- **Lesson completion**: a lesson run is `finished/completed` when the summary is reached with its
  plan done (04, "Lesson composition"; reading steps recorded as `step_done`). The server refuses to
  finish a run with exercises or reading steps left (`run_incomplete`; the AI practice depends on the
  assistant and is left to the player), and the summary then lists what is left. A run ended
  `finished/completed` stays a completion: a lesson changed since (an exercise added when its course
  was normalised again) does not take it back.
  Score: the lesson result (04).
- **Progress**: the engine's (04, "Learner model"). A lesson card on the course map shows the run the
  lesson opens (active run, else latest completed) as the player reads it — exercises worked of all,
  and the score of a finished run.
- Switching a course's edition ends its active lesson run `abandoned/user`.
- Content updated while a run is active ends the run `abandoned/content_updated`: planned (plan, "Open
  items in built areas", Library).
- **Course removed**: runs stay readable via snapshots; lexeme cards keep working from
  `display_cache_json`. An imported deck is deleted only while no profile has cards made from it.
- **Study days** are read from the event log, never stored (04, "Learner model"), in the time zone of
  the machine the server runs on (the learner's own computer).
