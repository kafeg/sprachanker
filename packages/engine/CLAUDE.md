# packages/engine

Pure learning logic. Depends on `packages/schema` only.
No network, no filesystem, no `Date.now` — time and randomness are parameters. Runs in Bun and browser.

## Layout

```
src/
  compose/        # steps.ts: the lesson plan as steps (going over mistakes only with some:
                  # practiceInPlan), what is done, where a run resumes
  check/          # index.ts: checkItem(exercise, item, answer, lang, heard?) → Outcome (+ diff, parts),
                  # one case per type; itemScored; outcome.ts: graders and words against references
                  # (spokenCheck); spoken.ts: an answer said aloud judged against the line to say or
                  # the source's answer as heard (a frame completed, the shortest runs of sentences:
                  # spokenAnswers, judgeSpoken; neither right nor clearly missed: its words against
                  # the closest answer, never wrong), what only the AI can check (spokenFreely), the
                  # recording an item is checked by (answerToHear); answers.ts: checked or not, an answer complete, the
                  # words said (a line's alternatives);
                  # understanding.ts: Understanding's questions as items of their types, its stage;
                  # mistake-items.ts: going over mistakes' new items as items of their types, a
                  # review's items numbered across its groups, where the learner is
  text/           # normalisation and word diff used by checkers and speech (a word as heard: wordAsHeard);
                  # language-forms.ts: what each language writes two ways and says one way, data by
                  # language (numbers in digits — numbers.ts: de, en —, short forms "geht's",
                  # "don't", spellings "ß"/"ss", nouns capitalised); words (a sentence's words
                  # met or new against a vocabulary; whether it uses a word, or a form given of it —
                  # irregular-verbs: the commonest German ones' forms no stem finds)
  learner/        # mistakes, practice (how each AI practice step went: its first work marked as an
                  # exercise), going-over (a run's mistakes to go over in the lesson and whether it has
                  # any; a mistake's wrong parts only, grouped by type, those said aloud and
                  # Understanding's listed only), lesson progress (an exercise's mark: a spoken answer by its check —
                  # the engine's, else the model's —, answerMark; answers from before the engine judged
                  # them judged as a run is read: judgedEvents), study days (activity: counted by
                  # module, the run's kind, the time each took); series: a span cut into bars (days, weeks, months) for the
                  # Notebook's pictures; planned: rule mastery, can-do
  exam/           # exams: the settings as an exam reads them, the questions open to a learner (a
                  # question's line), a mock exam drawn, practice's order, each
                  # question's state, readiness, a question checked, a run's result (a result read
                  # on the exam's scale: withScore); conversation.ts: a speaking part's latest
                  # conversation and its answer; timing.ts: a Teil's own time (else its share of
                  # the module's), a module's preparation as a run's events hold it
  speech/         # voices.ts: a server voice's gender and age; a text's people given voices
                  # (castVoices), a speaker's gender by name (speakerVoices, older texts); a text's
                  # pieces read aloud (readingPieces: the web's requests, the server's read ahead)
  srs/            # ts-fsrs wrapper made to schedule as Anki (fsrs-rs's same-day Hard, Anki's steps, Easy
                  # above Good, days counted from 4 AM), Anki's study queue (limits, the day's start hour,
                  # learn ahead, new cards mixed in as Anki orders the day), interval text; state.ts: a face's FSRS state by name (never its number); day.ts: the day's card answers (limits used, undo, the face just taken back);
                  # deck.ts: a deck's standing for the Notebook (words by state, due, the month's answers)
```

## Planned

- `compose/`: canonical + locale + enrichment → a composed lesson, stale detection.

## Rules

- Every checker has table-driven tests including tricky normalisation (quotes, capitalisation that
  matters, accepted variants).
- Derivations from events (learner/, exam/, srs/day.ts) are deterministic: same events → same result; they
  read `TypedEvent`s and narrow on `type`, never casting a payload.
- Keep functions small and pure; side effects belong to the server.
- How a word is compared (heard, typed, misspelt) is language-specific only in data (`text/language-forms.ts`,
  the article lists in `text/normalise.ts`); a language without an entry gets the plain comparison.
- A ts-fsrs update means comparing review with Anki again (its Python library, the tests' numbers):
  `srs/index.ts` hard-codes FSRS-6's same-day stability, re-does its Hard step and Easy fuzz, and
  `dayShift` assumes ts-fsrs counts days by UTC dates.
- Folders depend one way: `learner/` may read `srs/`, never the reverse (dependency-cruiser
  `engine-folders-one-way`).
