# 01 — Domain model

Types live in `packages/schema`. Names below are the canonical names in code.

## Languages

- `Lang` — BCP-47 primary tag: `de`, `en`, `ru`, …
- A learner has a **native language** (language of explanations) and studies a **target language**.
  A course edition is described by `source → target`, e.g. `ru → de`; `de → de` is a monolingual edition.
- **A language pair of a source course is a course of its own**: DW's Nicos Weg A1 for Russian
  speakers and for English speakers are separate courses (`a1-ru`, `a1-en`) with their own exercises
  and progress — the source publishes them separately and they differ. A course has several editions
  only when they are translations of the same content (the test fixture).
- UI language (`en`, `ru`, `de`) is independent from both.
- Of a course with several editions, a profile studies the one last opened from the course list (a
  card per edition), else the one whose source is its UI language, else the first.

## Catalog

```
Series      e.g. "dw.nicos-weg"       (<publisher>.<series>; a product that may span levels)
└─ Course   e.g. "dw.nicos-weg/a1"    (installable unit: one level or one exam)
   └─ Edition  e.g. "ru-de"           (localisation of a course for a source language)
```

- A **provider** (03) is the importer that produces series. `courses/dw` produces `dw.nicos-weg` and
  `dw.deutschtrainer` (CLI ids `dw-<series>`), a course per DW course and language (`a1-ru`, `a1-en`,
  `a2-ru`, `a2-en`, `b1-de`, `a1-a2-ru`); the other providers one series each (03).
- **CatalogEntry**: course key, series, `kind` (`course` | `exam`), `level?` (CEFR), `target`,
  editions, licence, attribution, homepage, approximate size; declared by the providers built into the
  app and listed in Courses (Available, Downloaded) with each course's state (03, 06).

## Course content

- **Course**: metadata + ordered **Units** + **Lessons**; a course of kind `exam` has exams only.
- **Lesson**: key (language-independent, 02), title, synopsis, goals, media, ordered **Pages**, and
  tabs (grammar, vocabulary, culture, script). Pages contain **Exercises**.
- **Exercise**: key, type (02/04), instruction, items, optional info box, new words, rule ids. Data is
  split into a language-independent part (canonical) and a localised part (locale) — 02.
- **Lexeme**: identity of a word across lessons and courses (lexeme key, 02); vocab entries in lessons
  point to it.
- **GrammarRule**: stable id (`de.greeting.du-sie`), title and explanation per learner language. One
  registry in the repository (02).
- **Goal (can-do)**: keyed statement of what the learner can do, linked to lessons.
- **Exam**: sections drawing items from pools, time limit, pass mark (02). Used where a source has real
  exam rules (Leben in Deutschland); a course's final test without them is just a lesson.
- **Enrichment**: our additions attached to lesson/exercise keys: contrastive notes, rule tags, extra
  exercises, scenes (02, 04).

## Learner

- **Profile**: display name, optional PIN, native and target languages, UI language, settings (incl. own
  LLM and speech choices). Separate SQLite file per profile (05).
- **Device**: a browser/PWA logged in to a profile (token).
- **Run**: one attempt of a lesson, exam, review session, practice set, scene or chat; has a `kind`,
  the content version it used, and a result.
- **Event**: append-only record inside a run (05) with a snapshot of what was shown.
- **Mistake**: derived from events: rule ids, lexemes, exercise key, source (exercise/speech/LLM).
- **Card**: SRS item built from a lexeme (one per lexeme and translation language), a sentence, or a
  custom note — Anki's note.
  Each enabled face (recognition, production, listening) is one of Anki's cards with its own FSRS state.
- **Deck**: virtual, as in Anki's deck list: a language (`lang:<code>`) with its courses under it
  (`course:<key>`, by the lesson a word was first met in) — German and English never share a deck; a
  lesson's own words in an edition (`lesson:<edition>:<key>`) in its "Words" step. Stored decks come with `.apkg` (after the MVP).
- **Mastery**: per rule and per lexeme, derived from events and FSRS state.
- **Conversation**: an LLM dialogue (scene, chat) stored as a run with events.

## Invariants

- Installed content changes only through an update, which creates a new `contentVersion`. Runs carry
  snapshots, so old runs stay readable after content changes or removal.
- Events are never updated; they are deleted only with the whole profile or at the learner's confirmed
  request (resetting progress, deleting a tutor chat).
- Statistics are derived from events by pure functions (04, 05); nothing derived is a source of truth.
- Nothing in the domain assumes German or Russian.
