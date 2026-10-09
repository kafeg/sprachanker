# packages/engine

Pure learning logic. Spec: `docs/spec/04-engine.md`. Depends on `packages/schema` only.
No network, no filesystem, no `Date.now()` — time and randomness are parameters. Runs in Bun and browser.

## Layout

```
src/
  compose/        # steps.ts: the lesson plan as steps, what is done, where a run resumes
  check/          # index.ts: checkItem(exercise, item, answer) → Outcome (+ diff, rule ids), one case per
                  # type; itemScored; answers.ts: checked or not, an answer complete, the words said
  text/           # normalisation and word diff used by checkers and speech; words (a sentence's words
                  # met or new against a vocabulary)
  learner/        # mistakes, lesson progress, study days (activity); planned: rule mastery, can-do
  srs/            # ts-fsrs wrapper, Anki's study queue (limits, the day's start hour, learn ahead),
                  # interval text; day.ts: the day's card answers (limits used, undo, the face just taken back)
```

## Planned

- `compose/`: canonical + locale + enrichment → a composed lesson, stale detection (04).
- `packages/anki-export`: `.apkg` import and export (plan, "Anki decks and word images").

## Rules

- Every checker has table-driven tests including tricky normalisation (quotes, capitalisation that
  matters, accepted variants).
- Derivations from events (learner/, srs/day.ts) are deterministic: same events → same result; they
  read `TypedEvent`s and narrow on `type`, never casting a payload.
- Keep functions small and pure; side effects belong to the server.
