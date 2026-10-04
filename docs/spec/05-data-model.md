# 05 — Data model and storage

## Locations

```
<app-data>/                      # OS-specific: ~/Library/Application Support/SprachAnker, %APPDATA%\…, ~/.local/share/…
├── config.json                  # path of the data root, network settings, owner settings
├── models/                      # whisper, Piper voices, GGUF models (built-in runtime)
├── cache/                       # TTS cache, thumbnails, LLM response cache
└── logs/

<data-root>/                     # user-chosen; default <app-data>/data
├── library/                     # installed courses (02) — archivable per series
├── server.sqlite                # profile registry, devices, jobs
└── profiles/
    └── <profile-id>/
        ├── profile.sqlite       # all learner data of this profile
        ├── recordings/          # learner audio as captured (mp4/aac on iOS, webm/opus elsewhere), referenced from events
        └── media/               # learner-added images, imported deck media
```

- One SQLite file per profile: simple backup, move, and deletion of a person's data.
- The library never contains learner data; profiles never contain course content.
- Recordings are kept indefinitely by default (local data); a profile setting MAY set a retention period.

## `server.sqlite`

- `profiles(id, display_name, pin_hash?, created_at, is_owner)`
- `devices(id, profile_id, token_hash, name, user_agent, created_at, last_seen_at)`
- `jobs(id, kind, params_json, state, progress, report_json, created_at, finished_at)` — imports,
  model downloads, rebuilds.
- `meta(key, value)` — schema version.

## `profile.sqlite`

All ids are ULIDs unless stated; all content references use keys from 02.

**Settings**
- `settings(key, value_json)` — native language, target languages, UI language, theme, daily limits,
  desired retention, recording retention, time zone, federal state (Leben in Deutschland).
- `course_prefs(course_key, edition, added_at)` — which edition this profile uses per course (default:
  native language, else `en`, else the course's only edition).
- `secrets(provider_id, value_encrypted)` — API keys; encrypted with a key stored in `<app-data>`; never
  returned by the API (06). Not included in exports; re-entered after moving a profile.
- `llm_routes(task, provider_id, model, params_json, fallback_provider_id?, fallback_model?)`;
  `speech_settings(lang, stt_json, tts_json)`.

**Event log (source of truth for learning activity)**

```sql
runs(
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,             -- lesson | exam | review | practice | scene | chat
  mode TEXT NOT NULL,             -- first | redo | practice | review | exam | scene | chat
  context_key TEXT,               -- lesson/exam/scene key; null for review, practice and free chat
  course_key TEXT, edition TEXT,  -- null when not tied to one course
  content_version TEXT,           -- from the manifest (02); null when not tied to one course
  app_version TEXT NOT NULL,      -- includes our enrichment version
  device_id TEXT,
  parent_run_id TEXT,             -- e.g. practice run created from a Notebook selection
  plan_json TEXT,                 -- fixed at start: ordered item/card list for review, practice and exam runs
                                  --   (exam: drawn questions, seed, time limit); null for lessons (plan = lesson)
  status TEXT NOT NULL,           -- active | finished | abandoned
  end_reason TEXT,                -- completed | timeout | taken_over | content_updated | user
  active_device_id TEXT,          -- device currently allowed to append events (see Concurrency)
  started_at INTEGER NOT NULL, finished_at INTEGER,
  position_json TEXT,             -- last page/item for resume
  result_json TEXT                -- score, pass/fail, summary
);
events(
  id TEXT PRIMARY KEY,            -- ULID (time-ordered)
  run_id TEXT NOT NULL REFERENCES runs(id),
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  item_key TEXT,                  -- exercise or item key (02) when the event concerns content
  card_id TEXT,                   -- when the event concerns a card
  payload_json TEXT NOT NULL      -- per-type shape below, validated by schema
);
CREATE INDEX events_run ON events(run_id, ts);
CREATE INDEX events_item ON events(item_key);
CREATE INDEX events_card ON events(card_id);
```

| Event type | Payload (required fields) |
|---|---|
| `page_shown` | `pageIndex`, `exerciseKey?` |
| `item_shown` | `snapshot` (type, prompt/options/parts as displayed incl. learner-language texts), `displayOrder[]`, `fingerprint` |
| `answered` | `answer` (shape from 02), `outcome` (04 `Outcome`), `attempt`, `ms` |
| `llm_verdict` | `forEventId`, `verdict`, `corrections[]` (07), `model`, `latencyMs` |
| `hint_used` | `kind` |
| `speech` | `lang`, `recording` (file name), `asrText`, `asrModel`, `latencyMs`, `reference?`, `diff?` |
| `llm_turn` | `role`, `segments[{lang,text}]`, `corrections[]`, `goalsMet[]?`, `model?`, `latencyMs?`, `speechEventId?` |
| `card_created` | `cardId`, `source` |
| `card_review` | `face`, `rating` (1–4), `stateBefore`, `stateAfter` (FSRS) |
| `note` | `text` |

- Events are append-only. No UPDATE/DELETE except deleting a profile, and deleting recordings (by
  retention or by the learner — the `speech` event stays, `recording` becomes `null`).
- Mutable run fields: `status`, `end_reason`, `active_device_id`, `finished_at`, `position_json`,
  `result_json`. Everything else in `runs` is fixed at creation.
- **Event ids** are ULIDs generated by the client and act as idempotency keys (retries never duplicate);
  `ts` is assigned by the server on receipt; the client's timing goes into the payload (`ms`).
- `item_shown` snapshots make old runs readable after content changes (01).
- An LLM verdict arrives as a separate `llm_verdict` event referencing the `answered` event, so the
  answer is stored immediately and the verdict whenever it comes.

**Cards**

```sql
cards(
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,             -- lexeme | sentence | imported | custom
  lexeme_key TEXT,                -- for kind=lexeme (02)
  source_key TEXT,                -- vocab occurrence or item key where it was met / created from
  created_from_event TEXT,        -- event id (e.g. a mistake) if any
  fields_json TEXT,               -- only for sentence | imported | custom (front, back, audio, image…)
  faces TEXT NOT NULL,            -- enabled faces: recognition, production, listening
  display_cache_json TEXT,        -- last rendered target/gender/plural/translation, so cards survive course removal
  suspended INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
card_state(card_id, face, fsrs_json, due_at, PRIMARY KEY(card_id, face))   -- derivable from card_review events
```

- Lexeme cards store no copy of content: front/back are rendered from the library (vocab entry +
  locale translation for the profile's edition) plus `lexeme_user`. One card per lexeme per profile.
- Each face has its own FSRS state.

**Decks**
- Virtual decks (computed, not stored): `lesson:<lessonKey>` (lexemes of the lesson's vocab and
  newWords), `course:<courseKey>`, `mine` (all cards).
- Stored decks: `decks(id, kind[imported|custom], name, source_json)`, `deck_cards(deck_id, card_id)`.

**Learner's word data**
- `lexeme_user(lexeme_key PRIMARY KEY, image_json, note, translation_override, updated_at)` — chosen
  image (source, url or blob, licence, attribution), personal note, own translation.

**Derived tables (rebuildable from events + cards)**
- `lesson_progress(context_key, edition, best_score, last_run_id, completed_at, status)`
- `item_stats(item_key, attempts, correct, last_result, last_at)`
- `rule_stats(rule_id, day, attempts, correct)`; `lexeme_stats(lexeme_key, seen, practised, last_at)`
- `mistakes(event_id PRIMARY KEY, run_id, item_key, rule_ids_json, lexemes_json, source[exercise|speech|llm])`
- `can_do(goal_key, achieved_at, evidence_run_id)`

`rebuild` drops derived tables and replays events; it runs after migrations that change derivation.

## Migrations

- Drizzle migrations, forward-only, numbered, separate sets for `server.sqlite` and `profile.sqlite`.
- Schema version stored in each DB (`meta`/`PRAGMA user_version`).
- Before migrating, the file is copied to `<file>.bak-<version>-<timestamp>`; last 5 kept.
- The server refuses to open a DB with a newer version than it knows (downgrade protection).
- Each migration has a test that upgrades fixture DBs of every previous released version (10).

## Export and import

- **Profile export**: versioned JSON (+ recordings and media in a zip) independent of the SQLite schema:
  settings (without secrets), course_prefs, runs, events, cards, card_state, decks, lexeme_user. Import
  into a fresh profile; derived tables are rebuilt.
- **Anki**: see 04.
- **Library**: copy series folders (02).

## Concurrency and lifecycle

- One server process owns all DB files (WAL mode); devices are clients; no multi-writer sync in v1.
- **One active run per (profile, context)**. Opening the same lesson on a second device offers
  "continue here"; accepting moves `active_device_id`. Events from a device that no longer owns the run are
  rejected (HTTP 409) and that device shows "continued on another device".
- Only one active review run per profile at a time, same rule.
- **Lesson completion**: a lesson run is `finished/completed` when the summary page is reached; score =
  mean `score` of scored items (unknown and unscored items excluded). `lesson_progress.status`:
  `new → in_progress → done` (any completed run) `→ mastered` (best score ≥ 0.8 and its rules' mastery ≥ 0.8).
- **Content updated** while a run is active (new `contentVersion` for the run's edition): the run ends as
  `abandoned/content_updated`; the learner restarts the lesson. Finished runs stay readable via snapshots.
- **Course removed**: runs, events and Notebook stay readable via snapshots; lexeme cards keep working from
  `cards.display_cache_json`; lesson links show "course not installed".
- **Study days** use the profile's time zone setting (default: the device's zone at profile creation).
