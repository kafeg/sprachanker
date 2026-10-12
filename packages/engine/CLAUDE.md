# packages/engine

Pure learning logic. Spec: `docs/spec/04-engine.md`. Depends on `packages/schema` only.
No network, no filesystem, no `Date.now()` — time and randomness are parameters. Runs in Bun and browser.

## Layout

```
src/
  compose/        # steps.ts: the lesson plan as steps (going over mistakes only with some:
                  # practiceInPlan), what is done, where a run resumes
  check/          # index.ts: checkItem(exercise, item, answer) → Outcome (+ diff, parts), one case per
                  # type; itemScored; answers.ts: checked or not, an answer complete, the words said;
                  # understanding.ts: Understanding's questions as items of their types, its stage;
                  # mistake-items.ts: going over mistakes' new items as items of their types, a
                  # review's items numbered across its groups, where the learner is
  text/           # normalisation and word diff used by checkers and speech; words (a sentence's words
                  # met or new against a vocabulary; whether it uses a word, or a form given of it —
                  # irregular-verbs: the commonest German ones' forms no stem finds)
  learner/        # mistakes, practice (how each AI practice step went: its first work marked as an
                  # exercise), going-over (a run's mistakes to go over in the lesson and whether it has
                  # any; a mistake's wrong parts only, grouped by type, those said aloud and
                  # Understanding's listed only), lesson progress, study days (activity: counted by
                  # module, the run's kind, the time each took); series: a span cut into bars (days, weeks, months) for the
                  # Notebook's pictures; planned: rule mastery, can-do
  exam/           # exams: the settings as an exam reads them, the questions open to a learner (a
                  # question's line), a mock exam drawn, practice's order, each
                  # question's state, readiness, a question checked, a run's result (a result read
                  # on the exam's scale: withScore); conversation.ts: a speaking part's latest
                  # conversation and its answer
  speech/         # voices.ts: a server voice's gender and age; a text's people given voices
                  # (castVoices), a speaker's gender by name (speakerVoices, older texts); a text's
                  # pieces read aloud (readingPieces: the web's requests, the server's read ahead)
  srs/            # ts-fsrs wrapper, Anki's study queue (limits, the day's start hour, learn ahead),
                  # interval text; state.ts: a face's FSRS state by name (never its number); day.ts: the day's card answers (limits used, undo, the face just taken back);
                  # deck.ts: a deck's standing for the Notebook (words by state, due, the month's answers)
```

## Planned

- `compose/`: canonical + locale + enrichment → a composed lesson, stale detection (04).

## Rules

- Every checker has table-driven tests including tricky normalisation (quotes, capitalisation that
  matters, accepted variants).
- Derivations from events (learner/, exam/, srs/day.ts) are deterministic: same events → same result; they
  read `TypedEvent`s and narrow on `type`, never casting a payload.
- Keep functions small and pure; side effects belong to the server.
- Folders depend one way: `learner/` may read `srs/`, never the reverse (dependency-cruiser
  `engine-folders-one-way`).
