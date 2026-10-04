# 01 — Domain model

Types live in `packages/schema`. Names below are the canonical names in code.

## Languages

- `Lang` — BCP-47 primary tag: `de`, `en`, `ru`, …
- A learner has a **native language** (language of explanations, `ui` default) and studies a **target
  language**. A course edition is described by `source → target`, e.g. `ru → de`. `de → de` is valid
  (monolingual edition).
- UI language (`en`, `ru`, `de`) is independent from both.

## Catalog

```
Provider        e.g. "dw" (Deutsche Welle), "coerll", "sprachanker", "bamf", "goethe"
└─ Series       e.g. "dw.nicos-weg"         (a product of a provider; may span levels; id = <provider>.<series>)
   └─ Course    e.g. "dw.nicos-weg/a1"      (installable unit; one level or one exam)
      └─ Edition  e.g. "ru-de", "en-de"     (localisation of a course for a source language)
```

- **CatalogEntry**: `id`, `provider`, `series`, `kind`, `level?` (CEFR), `target`, `editions[]`,
  `licence`, `attribution`, `homepage`, `approxSize`, `providerVersion`.
- **Kind**: `course` | `exam` | `reader` (later) | `deck`.
- The catalog is the union of all providers' declared entries (03). Installed state comes from the library.
- UI groups entries by target language → series → level and filters by source language, kind, level,
  licence. By default it shows entries whose editions match the profile's native language.

## Course content

- **Course** (installed): metadata + ordered **Units** (chapters, e.g. "Einheit 1 Kennenlernen") +
  **Lessons**. Exams have **Sections** instead of lessons.
- **Lesson**: `key` (language-independent, see 02), title, synopsis, goals ("can-do"), media (video,
  audio), ordered **Pages**, and **tabs**: grammar, vocabulary, culture, script. Pages contain
  **Exercises**.
- **Exercise**: `key`, `type` (see 04), instruction, items, optional info box, optional `newWords`,
  scoring. Exercise data is split into a language-independent part (canonical) and a localised part
  (locale) — see 02.
- **Lexeme / VocabEntry**: target form, part of speech, gender, plural, notes, translations per source
  language, audio, image ref, links to lessons where it appears. Identity across sources = lexeme key
  (normalised lemma + POS, + gender for nouns; see 02).
- **GrammarRule**: stable id (`de.greeting.du-sie`), title and explanation per learner language,
  examples, related rules. One registry in the repository (`courses/_shared/rules/`, 02); providers and
  enrichment only reference ids.
- **Goal (can-do)**: keyed statement of what the learner can do; texts in locale files; linked to lessons.
- **Exam**: sections drawing items from pools (fixed order or random draw, optional filter such as
  federal state), time limit, pass mark, optional LLM rubrics (02).
- **Enrichment**: our additions attached to lesson/exercise keys: contrastive notes, speaking items,
  scenes, missions, hints, extra exercises, rule tags (02, 04).

## Learner

- **Profile**: id, display name, optional PIN, native language, target languages, UI language, settings
  (LLM routing, speech, voices, display), created devices. Separate SQLite file per profile (05).
- **Device**: a browser/PWA paired to a profile (token). Owner device = the desktop app.
- **Run**: one attempt of a lesson, exam, review session, practice set or scene. `mode`:
  `first | redo | practice | review | exam | scene | chat`. Has `contentVersion` and result.
- **Event**: append-only record inside a run (`page_shown`, `item_shown`, `answered`, `llm_verdict`,
  `hint_used`, `speech`, `llm_turn`, `card_created`, `card_review`, `note` — 05) with a snapshot of what
  was shown.
- **Mistake**: derived from events: rule ids, lexemes, exercise key, source (exercise/speech/LLM).
- **Card**: SRS item built from a lexeme (one per lexeme), a sentence (e.g. from a mistake), or an
  imported/custom note. Each enabled face (recognition, production, listening) has its own FSRS state.
- **Deck**: virtual `lesson:<key>`, `course:<key>`, `mine`; stored `imported` (`.apkg`) and `custom`.
- **Mastery**: per rule and per lexeme, derived from events and FSRS state.
- **CanDo**: course goals ("can greet formally") marked as achieved from completed lessons and scenes.
- **Conversation**: LLM dialogue tied to a context (lesson, scene, chat, review) — stored as runs/events.

## Invariants

- Content is immutable once installed; updates create a new `contentVersion`. Runs reference the version
  they used and carry snapshots, so old runs stay readable after content changes.
- Events are never updated or deleted (except explicit user deletion of a profile or recordings).
- Derived tables can be dropped and rebuilt from events at any time.
- Nothing in the domain assumes German or Russian.
