# 04 — Engine

`packages/engine` is pure TypeScript: no network, no filesystem, no clock (time and randomness are
parameters). It runs on the server and in the browser (instant feedback for closed exercises). The
server re-checks every answer with the same code; the stored outcome is the server's, never the
client's. Answers of closed exercises are visible to the client — acceptable for self-study.

## Lesson composition (planned)

Today the server returns a lesson's canonical and locale files as they are (`GET /api/lesson`) and the
player combines them; `speech_selfrate` items are shown for self-rating and not scored. Planned:

`compose(canonical, locale, enrichment, profile) → ComposedLesson`

1. Take canonical pages and attach locale texts of the profile's edition.
2. Upgrade self-rated speaking: a `speech_selfrate` item with a reference text becomes `speech_repeat`;
   one without becomes `respond`. Enrichment may override this (`upgrade`, 02).
3. Apply enrichment: rule tags, contrastive notes for the native language, extra exercises, scenes.
   Skip stale entries (fingerprint mismatch) and report them.
4. Lesson flow (the plan's steps, owner 2026-10-06; built in stage 6): overview (synopsis, goals, the
   video or recording with its transcript under it) → "Words of the lesson" (cards) → one "Grammar"
   step per grammar page (a page is one topic) → the exercises (source pages, then ours) → one
   "Culture" step per culture page → AI practice when an assistant is set up: "Write it yourself",
   scene, session review (last, so it can take the writing and the scene into account) → summary of
   all of it (score, mistakes by rule, writing, scene, review, new cards). The steps come from what
   the provider's normaliser put into the canonical and locale files, the same way for every course.
   Every step has a mark in the plan and "Next" goes through all of them; any step can be skipped (and
   shows it). The lesson is completed when every step is done or skipped: an exercise answered, a
   reading step opened, an AI step done once. AI steps are in the plan only while an assistant is set
   up, so a lesson never depends on one. The reference tabs (vocabulary, grammar, culture, script)
   stay available at any time for looking things up.

## Checking

Each exercise type (02) has a zod schema (schema), a checker (engine), a renderer (`apps/web`) and tests.
Checkers (`packages/engine/src/check/index.ts`) exist for every scored type; renderers exist for the
closed types, `dictation` and `speech_selfrate` — `speech_repeat`, `respond` and `scene` get theirs with
speech (stage 7) and their LLM checks.

```ts
type Outcome = {
  result: "correct" | "partial" | "wrong" | "unscored";
  score: number;          // 0..1; partial = share of matched ids or words
  diff?: TokenDiff[];     // text and speech
  ruleIds: string[];      // canonical ruleIds + enrichment
  lexemes: string[];
  needsLlm?: boolean;     // respond: deterministic part done, LLM verdict pending
};
```

- Matching is by ids, never by display position. Exception: options with identical content are
  interchangeable (`order` with repeated letters, `match` with the same form twice, a word bank with
  duplicates), so ids with equal content compare equal.
- `partial` only for multi-select, `order` with a correct prefix, and dictation/speech with ≥ 80% of
  words matched; otherwise results are binary.
- **Attempts**: the learner may retry an item; every attempt is recorded, but only the **first attempt**
  counts for the lesson score and statistics. Items may be skipped: a skipped item that would be checked
  counts as wrong (score 0; its exercise is marked wrong), a skipped self-rated or otherwise unscored
  item costs nothing (its exercise is marked skipped); the summary lists them as skipped.
- **Text normalisation**: NFC; unify quotes, apostrophes and dashes; collapse whitespace; strip final
  punctuation; case-insensitive except where the target language makes case meaningful (German: a
  token capitalised in the reference and not sentence-initial is compared case-sensitively). Speech is
  always compared case-insensitively. Normalisation and the per-language case rule live in
  `packages/engine/src/text/normalise.ts`, the word diff in `packages/engine/src/text/diff.ts`.
- `respond`: scored from the rubric's required groups if it has them, otherwise `unscored`; the outcome
  carries `needsLlm` and the reference is shown either way. Planned: an LLM verdict on top (07, Later).
- `unknown` is never rendered; the page shows "not supported yet".

## Learner model

Pure functions over events and cards (05). Built: lesson result (mean first-attempt score), resume
page and lesson progress (`packages/engine/src/learner/progress.ts`; the best score counts only runs
that scored an item, so a lesson of words only is done without a score); mistakes (items whose first attempt in the latest run
that answered them was wrong or partial; `learner/mistakes.ts`), read by the server per request.
The rest is planned:

- **Mistakes** with rule ids and lexemes, from closed exercises (via rule tags), speech diffs and LLM
  corrections (07).
- **Rule mastery**: accuracy over recent attempts per rule (formula fixed in stage 9a).
- **Lexeme state**: seen, practised, FSRS stability; "in long-term memory" when stability ≥ 21 days.
- **Item history**: attempts per item (lesson progress — status `new | in_progress | done`, best
  score — is built).
- **Can-do**: a course goal is achieved when its linked lessons are completed.

## Spaced repetition (stage 6)

Built: scheduling and the review queue (`packages/engine/src/srs/`), cards from a lesson's words and
ratings on the server (`services/cards.ts`), the Review screen with two ratings — "Forgot" (again) and
"Remembered" (good); FSRS works with these two, and there is no setting for four.

- FSRS via `ts-fsrs`, default parameters, desired retention 0.9 (profile setting `srs.retention`).
- The review queue: due faces first (most overdue first), then new faces in the order the cards were
  made, as many as the day still allows (`srs.newPerDay`, default 10, counted from the start of the
  learner's day: local midnight). A card shows one face a day; after "again" that face comes back the
  same day. A card's next face is introduced once the faces before it are in review (recognition, then
  production, then listening).
- **Cards** come from the lesson's "Words" step (one card per lexeme; meeting it again reuses it),
  words the learner adds, phrases in enrichment (`cards.phrases`), and sentences from mistakes.
  The learner can mark a card "already known" (suspended).
- **Faces**: recognition (target → native), production (native → target), listening (audio → meaning).
  Enabled per card; the profile sets the default (recognition + production).
- **Review session** = due cards plus a limited number of new cards (profile limits; beginner-friendly
  defaults fixed in stage 6, e.g. 10 new cards a day). At most one face of a card per day.
- **Practice set ("Practise this")**: a run with the original items selected in the Notebook (e.g. all
  du/Sie mistakes this week).

## Scenes

`scene_setup` drafts a scene from the lesson's goals and words (title, situation, partner, 1–3 goals,
opening line); `scene_turn` runs it (`packages/llm/src/tasks/scene.ts`, 07). Planned: authored scenes in
enrichment (setting, roles, goals, allowed vocabulary and rules, register, success criteria).

## After MVP

- **Anki** (`packages/anki-export`, stage 10): `.apkg` export per deck with media (no scheduling) and
  import into stored decks, linking notes to existing lexemes.
- **Word images** (stage 10): candidates from ARASAAC (CC BY-NC-SA), OpenMoji (CC BY-SA) and course
  images, fetched at runtime into the profile's media with licence and attribution, never bundled;
  per-word learner data (chosen image, note, own translation) is stored then.
