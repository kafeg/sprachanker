# packages/schema

Domain types and file formats. Spec: `docs/spec/01-domain.md`, `docs/spec/02-course-format.md`.
Depends on nothing (zod only). Every other module imports types from here.

## Layout

```
src/
  lang.ts            # Lang, edition ids
  keys.ts            # key schemas (branded), builders, parsers, lemma slugs, part of speech, gender
  common.ts          # sha256, blob refs, media, library paths, localized text, `format` literal
  catalog.ts         # CatalogEntry, kind, licence
  manifest.ts        # course.json
  canonical.ts       # course index, lesson, vocab entries, unmapped
  exam.ts            # exam, sections, pools, thresholds
  locale.ts          # localised course/lesson/exam texts per edition (same key paths as canonical)
  exercise/          # item fields and stored answers per type, grouped by family; outcome.ts; index.ts (union)
  rules.ts           # grammar rules registry
  enrichment.ts      # enrichment
  learner.ts         # runs, event payloads per event type, cards, settings (created in stage 4)
json-schema/        # generated JSON Schemas, committed; `bun run --filter @sprachanker/schema gen`
scripts/gen-json-schema.ts
test/               # bun test (Bun types via tsconfig.dev.json; src has no runtime types)
```

## Rules

- Types are zod schemas; TS types are inferred (`z.infer`). No hand-written duplicate interfaces.
- Adding an exercise type: add it to its family file in `exercise/` and to the union in
  `exercise/index.ts`, then checker in engine, renderer in `apps/web` and a fixture item (root rule 2).
- Changing a stored format: bump its version constant; add a migration (server) or re-normaliser path.
- Keys are built only through `keys.ts` helpers — never by string concatenation elsewhere.
- No runtime logic beyond parsing/validation helpers; no Node/Bun APIs in `src/` (boundary rule).
- After changing a stored format, regenerate the JSON Schemas; the drift test fails otherwise.
