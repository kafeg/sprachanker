# packages/engine (+ packages/anki-export)

Pure learning logic. Spec: `docs/spec/04-engine.md`. Depends on `packages/schema` only.
No network, no filesystem, no `Date.now()` — time and randomness are parameters. Runs in Bun and browser.

## Layout (target)

```
src/
  compose/        # canonical + locale + enrichment → ComposedLesson; stale detection
  check/          # one checker per exercise type: check(item, answer) → Outcome (+ diff, rule ids)
  text/           # normalisation and word diff used by checkers and speech
  learner/        # mistakes, rule mastery, lexeme state, can-do
  srs/            # ts-fsrs wrapper, card creation rules, review session builder, practice sets
  replay/         # derive stats from an event stream (used by server rebuild)
```

`packages/anki-export`: `.apkg` read/write (SQLite inside zip + media). Maps notes ↔ cards via schema
types; no engine internals.

## Rules

- Every checker has table-driven tests including tricky normalisation (quotes, capitalisation that
  matters, accepted variants).
- Derivations (`replay/`) must be deterministic: same events → same tables.
- Keep functions small and pure; side effects belong to the server.
