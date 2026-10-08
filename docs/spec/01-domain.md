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
Series      e.g. "dw.nicos-weg"         (<publisher>.<series>; a product that may span levels)
└─ Course   e.g. "dw.nicos-weg/a1-ru"   (installable unit: one level in one language pair, or one exam)
   └─ Edition  e.g. "ru-de"             (localisation of a course for a source language)
```

- A **provider** (03) is the importer that produces series: `courses/dw` produces `dw.nicos-weg` and
  `dw.deutschtrainer`, a course per DW course and language; the other providers one series each. The
  courses each one offers: 03.
- **CourseOffer** (course-kit `provider.ts`): course, edition, title, source (publisher, URL, licence)
  and approximate size, declared by a provider without the network. Courses (Available, Downloaded)
  lists each as a **CatalogEntry** (`packages/server/src/services/downloads.ts`): the offer with its
  series and key, whether it is installed, its state (`available`, `queued`, `downloading`,
  `incomplete`, `ready`) and the media missing (03, 06).

## Course content

- **Course**: metadata + ordered **Units** + **Lessons**; a course of kind `exam` has exams only.
- **Lesson**: key (language-independent, 02), title, synopsis, goals, media, ordered **Pages**, vocab
  entries, tabs (grammar, culture, script, homework) and downloads (printable material). Pages contain
  **Exercises**.
- **Exercise**: key, type (02/04), instruction, items, optional info box, new words, rule ids. Data is
  split into a language-independent part (canonical) and a localised part (locale) — 02.
- **Lexeme**: identity of a word across lessons and courses (lexeme key, 02); vocab entries in lessons
  point to it.
- **GrammarRule**: stable id (`de.greeting.du-sie`), title and explanation per learner language. One
  registry in the repository (02).
- **Goal (can-do)**: keyed statement of what the learner can do, linked to lessons.
- **Exam**: sections drawing items from pools, time limit, pass mark (02). For a source with real exam
  rules (plan, "Exams"); a course's final test without them is just a lesson.
- **Enrichment**: our additions attached to lesson/exercise keys: contrastive notes, rule tags, extra
  exercises, scenes. Format fixed (02); planned (plan, "Enrichment and rules").

## Learner

- **Profile**: display name, native and target languages, UI language, settings (incl. own
  LLM and speech choices). Separate SQLite file per profile (05).
- **Device**: a browser/PWA logged in to a profile (token).
- **Run**: one pass of a lesson, exam, day of review, scene or chat (`kind`: `lesson`, `exam`,
  `review`, `scene`, `chat`), with its course and edition when tied to one, and a result (05).
- **Event**: append-only record inside a run (05) with a snapshot of what was shown.
- **Mistake**: derived from events: an item whose first attempt was wrong or partly right — its item,
  exercise and lesson keys, the answer, the result, the model's correction of a spoken answer, and
  whether a later answer fixed it (04, "Learner model").
- **Card**: Anki's note, made from a lexeme (04, "Spaced repetition"). Each enabled face
  (recognition, production, listening) is one of Anki's cards with its own FSRS state.
- **Deck**: as in Anki's deck list (04, "Spaced repetition").
- **Conversation**: an LLM dialogue (scene, chat) stored as a run with events.

## Invariants

- Installed content changes only through an update (normalising again, 03). Runs carry snapshots, so
  old runs stay readable after content changes or removal. Planned: a `contentVersion` per edition
  (plan, "Open items in built areas", Library).
- Events are never updated; they are deleted only with the whole profile or at the learner's confirmed
  request (resetting progress, deleting a tutor chat).
- Statistics are derived from events by pure functions (04, 05); nothing derived is a source of truth.
- Nothing in the domain assumes German or Russian.
