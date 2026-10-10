# packages/schema

Domain types and file formats. Spec: `docs/spec/01-domain.md`, `docs/spec/02-course-format.md`.
Depends on nothing (zod only). Every other module imports types from here.

## Layout

```
src/
  lang.ts            # Lang, edition ids
  library-state.ts   # the importer's and server's own files beside a series: media.json, keys.json, a
                     # download's marker (checked when read, no `format`)
  keys.ts            # key schemas (branded), builders, parsers, lemma slugs, part of speech, gender,
                     # choice option ids
  common.ts          # sha256, media paths, media, library paths, localized text, `format` literal
  canonical.ts       # course index, lesson, vocab entries, unmapped
  exam.ts            # exam, sections, pools, thresholds; a question as a one-item exercise, an exam's language
  locale.ts          # localised course/lesson/exam texts per edition (same key paths as canonical)
  exercise/          # item fields and stored answers per type, grouped by family; outcome.ts; index.ts (union,
                     # ItemOf)
  rules.ts           # grammar rules registry
  enrichment.ts      # enrichment
  learner.ts         # runs (RunHeader: what every run is; lesson and exam runs extend it; status and end
                     # reason), event payloads per event type (EVENT_PAYLOADS; TypedEvent: an event typed
                     # by its type; llm_verdict a union by task), step ids and AI practice kinds, cards
  assistant.ts       # the AI's answers as kept: corrections, writing and spoken checks, word examples,
                     # scene setups, an exam answer's proposed rating, a speaking part's next lines
  stats.ts           # how every module reports its statistics: modules, a run's module, a study day, a
                     # module's standing (figures, entries, run summaries), an entry in full
  settings.ts        # every setting key with its schema and owner (LEARNER_SETTINGS, SERVICE_SETTINGS),
                     # SETTING_DEFAULTS; a profile's colours, its name's limit, nextProfileColour (a new
                     # profile's colour: shared by the server's default and the onboarding's choice)
  errors.ts          # ERROR_CODES: what the server refuses, shared with the web
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
  dropped silently (02). Event payloads and API shapes are not strict.
- Event payloads only grow (05): every stored shape is on record in `test/stored-events/` and must
  keep reading; a change that cannot be additive comes with an upgrade of the stored events.
- Keys are built only through `keys.ts` helpers — never by string concatenation elsewhere.
- No runtime logic beyond parsing/validation helpers; no Node/Bun APIs in `src/` (boundary rule).
- After changing a stored format, regenerate the JSON Schemas; the drift test fails otherwise.
