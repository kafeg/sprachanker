# packages/engine (+ packages/anki-export)

Pure learning logic. Spec: `docs/spec/04-engine.md`. Depends on `packages/schema` only.
No network, no filesystem, no `Date.now()` — time and randomness are parameters. Runs in Bun and browser.

## Layout (target)

```
src/
  compose/        # canonical + locale + enrichment → ComposedLesson; stale detection
  check/          # one checker per exercise type: check(item, answer) → Outcome (+ diff, rule ids)
  text/           # normalisation and word diff used by checkers and speech; words (a sentence's words
                  # met or new against a vocabulary)
  learner/        # mistakes, lesson progress, study days (activity); planned: rule mastery, can-do
  srs/            # ts-fsrs wrapper, Anki's study queue (limits, 4 AM day, learn ahead), interval text;
                  # day.ts: the day's card answers (limits used, undo, the face just taken back)
  replay/         # derive stats from events + cards (server caches the result in memory)
```

`packages/anki-export` (planned): `.apkg` read/write (SQLite inside zip + media). Maps notes ↔ cards via schema
types; no engine internals.

## Rules

- Every checker has table-driven tests including tricky normalisation (quotes, capitalisation that
  matters, accepted variants).
- Derivations (`replay/`) must be deterministic: same events → same stats.
- Keep functions small and pure; side effects belong to the server.
