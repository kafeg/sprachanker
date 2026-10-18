# packages/schema

Domain types and file formats.
Depends on nothing (zod only). Every other module imports types from here.

## Layout

```
src/
  lang.ts            # Lang, edition ids, a language's writing direction (languageDir: the web's and e2e's)
  library-state.ts   # the importer's and server's own files beside a series: media.json, keys.json, a
                     # download's marker (checked when read, no `format`)
  keys.ts            # key schemas (branded), builders, parsers, lemma slugs, Slug (the ids made of
                     # one: a course's, a module's, a pass mark's), part of speech, gender, option ids;
                     # a headword's shape and a German noun's gender (the lexeme's rules: courses, decks)
  deck.ts            # an imported deck (`decks/<id>/deck.json`): its id, words (with the deck's own
                     # examples), languages, source, owner (a profile's own: Finds — findsDeckId); a deck
                     # folder (a course's too) and its extras.json
                     # (by word key: the audio read aloud); the audio extensions a deck's media may have
  deck-bundle.ts     # a deck file (`.sprachanker-deck`): one deck's folder — a course's extras, an
                     # imported deck, Finds —, its manifest, the paths it may hold, its size limit
  common.ts          # sha256, media paths, media, library paths, localized text, `format` literal
  canonical.ts       # course index, lesson, vocab entries, unmapped
  exam.ts            # exam, sections, pools, thresholds; a question as a one-item exercise, an exam's language
  locale.ts          # localised course/lesson/exam texts per edition (same key paths as canonical)
  exercise/          # item fields and stored answers per type, grouped by family; outcome.ts; index.ts (union,
                     # ItemOf; exports what other modules use — a type's item and exercise schemas stay inside)
  rules.ts           # grammar rules registry (courses/_shared/rules; the app reads none yet: planned)
  enrichment.ts      # enrichment (planned: its format only, nothing writes or reads one)
  learner.ts         # runs (RunHeader: what every run is; lesson and exam runs extend it; status and end
                     # reason), event payloads per event type (EVENT_PAYLOADS; TypedEvent: an event typed
                     # by its type; llm_verdict a union by task; practice_answered: an answer to a
                     # question the AI set), step ids and AI practice kinds, cards
  assistant.ts       # the AI's answers as kept: corrections, writing tasks and checks, spoken checks,
                     # word examples, scene setups, an exam answer's proposed rating, a speaking part's
                     # script, Understanding's texts with their questions, mistakes reviews (wrong
                     # parts by type, new items in one flat shape checked per type)
  stats.ts           # how every module reports its statistics: modules, a run's module, a study day, a
                     # module's standing (figures, entries, run summaries), an entry in full
  settings.ts        # every setting key with its schema and owner (LEARNER_SETTINGS, SERVICE_SETTINGS),
                     # SETTING_DEFAULTS; a profile's colours, its name's limit, nextProfileColour (a new
                     # profile's colour: shared by the server's default and the onboarding's choice)
  errors.ts          # ERROR_CODES: what the server refuses, shared with the web
  network.ts         # the addresses the app is reached at (this machine, the local network, the
                     # tailnet), each with whether it is a secure context
  update.ts          # whether a newer version is out (UpdateStatus) and what updates this build
  profile-file.ts    # a profile file (`.sprachanker-profile`): its manifest, the paths it may hold,
                     # the content a profile used, its size limit
  course-bundle.ts   # a course bundle (`.sprachanker-course`, version 3 with recordings heard, else 2):
                     # courses of one series, its manifest (its courses with their content versions,
                     # its lines of media.json and keys.json), the paths it may hold, its size limit
  heard.ts           # a course's recordings of the source's answers heard by Whisper
                     # (`heard/<course>.json`, by media path): read, merged (ours kept)
json-schema/        # generated JSON Schemas, committed; `bun run --filter @sprachanker/schema gen`
scripts/gen-json-schema.ts
test/               # bun test (Bun types via tsconfig.dev.json; src has no runtime types)
```

## Rules

- Types are zod schemas; TS types are inferred (`z.infer`). No hand-written duplicate interfaces.
  Every file the app stores or reads has its schema here (settings too: `LEARNER_SETTINGS`,
  `SERVICE_SETTINGS`, `SERVER_SETTINGS`); data from outside (a source's pages, a model's answer) is
  parsed where it comes in.
- Adding an exercise type: add it to its family file in `exercise/` and to the union in
  `exercise/index.ts`, then checker in engine, renderer in `apps/web` and a fixture item (root rule 2).
- Changing a stored format: bump its version constant; add a migration (server) or re-normaliser path.
- Library formats (canonical, locale, exercises, exams, enrichment, rules) are
  `z.strictObject`: an unknown or misspelt field is an error where it is written and read, never
  dropped silently. Event payloads and API shapes are not strict. So a field leaves a library
  format only if no provider ever wrote it: files on disk with it would stop reading, and so would
  what embeds them — a page's snapshot (dropped when read) and a mock exam's plan (its run unread);
  else bump the format. Removing an exercise field changes the fingerprint of every exercise that carries it (enrichment
  on them goes stale); the fixture is not a provider here (its library is made anew for each run).
- Event payloads only grow: every stored shape is on record in `test/stored-events/` and must
  keep reading; a change that cannot be additive comes with an upgrade of the stored events. A field
  nothing reads, whose content the events hold elsewhere too, may go: old payloads read without it.
- Keys are built only through `keys.ts` helpers — never by string concatenation elsewhere.
- No runtime logic beyond parsing/validation helpers; no Node/Bun APIs in `src/` (boundary rule).
- After changing a stored format, regenerate the JSON Schemas; the drift test fails otherwise.
