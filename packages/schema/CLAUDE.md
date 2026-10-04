# packages/schema

Domain types and file formats. Spec: `docs/spec/01-domain.md`, `docs/spec/02-course-format.md`.
Depends on nothing (zod only). Every other module imports types from here.

## Layout (target)

```
src/
  lang.ts            # Lang, edition ids
  catalog.ts         # CatalogEntry, Kind, licence
  keys.ts            # lesson/exercise/item/vocab key builders + parsers, fingerprint helpers
  canonical.ts       # course index, lesson, pages, vocab, media refs (blob:sha256:…)
  exam.ts            # exam, sections, pools, pass rules
  locale.ts          # localised course/lesson/exam texts per edition (same key paths as canonical)
  exercise/          # one file per exercise type: item fields, stored answer, Outcome
  rules.ts           # grammar rules registry
  enrichment.ts      # enrichment, scenes, missions
  manifest.ts        # course.json
  learner.ts         # runs, event payloads per event type, cards, decks, lexeme_user, settings
  api/               # request/response schemas shared by server and web
json-schema/        # generated JSON Schemas, committed (CI checks drift)
scripts/gen-json-schema.ts
```

## Rules

- Types are zod schemas; TS types are inferred (`z.infer`). No hand-written duplicate interfaces.
- Adding an exercise type: add `exercise/<type>.ts` here, then checker in engine and renderer in ui-kit
  (root rule 2).
- Changing a stored format: bump its version constant; add a migration (server) or re-normaliser path.
- Keys are built only through `keys.ts` helpers — never by string concatenation elsewhere.
- No runtime logic beyond parsing/validation helpers.
