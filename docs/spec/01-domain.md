# 01 — Domain model

Types live in `packages/schema`. Names below are the canonical names in code.

## Languages

- `Lang` — BCP-47 primary tag: `de`, `en`, `ru`, …
- A learner has a **native language** (language of explanations) and studies a **target language**.
  A course edition is described by `source → target`, e.g. `ru → de`; `de → de` is a monolingual edition.
- UI language (`en`, `ru`, `de`) is independent from both.
- A profile studies the edition last opened from the course list (each card is a course in one edition),
  else the one whose source is its UI language, else the course's first edition.

## Catalog

```
Series      e.g. "dw.nicos-weg"       (<publisher>.<series>; a product that may span levels)
└─ Course   e.g. "dw.nicos-weg/a1"    (installable unit: one level or one exam)
   └─ Edition  e.g. "ru-de"           (localisation of a course for a source language)
```

- A **provider** (03) is the importer that produces series. `courses/dw` produces `dw.nicos-weg` and
  `dw.deutschtrainer` (CLI ids `dw-<series>`); `courses/coerll-dib` produces `coerll.dib`.
- **CatalogEntry**: course key, series, `kind` (`course` | `exam`), `level?` (CEFR), `target`,
  editions, licence, attribution, homepage, approximate size. Planned (schema only): declared statically
  by providers for the install screen; today the CLI imports from each provider's own course list and
  installed state comes from the library.

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
- **Card**: SRS item built from a lexeme (one per lexeme), a sentence, or a custom note. Each enabled
  face (recognition, production, listening) has its own FSRS state.
- **Deck**: virtual (`lesson:<key>`, `course:<key>`, `mine`); stored decks come with `.apkg` (stage 10).
- **Mastery**: per rule and per lexeme, derived from events and FSRS state.
- **Conversation**: an LLM dialogue (scene, chat) stored as a run with events.

## Invariants

- Installed content changes only through an update, which creates a new `contentVersion`. Runs carry
  snapshots, so old runs stay readable after content changes or removal.
- Events are never updated or deleted (except by deleting the whole profile).
- Statistics are derived from events by pure functions (04, 05); nothing derived is a source of truth.
- Nothing in the domain assumes German or Russian.
