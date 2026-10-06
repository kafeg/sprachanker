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
4. Lesson flow: overview (synopsis, goals, video) → source pages → our pages (note, speaking, scene) →
   summary (score, mistakes by rule, new cards). Tabs (grammar, vocabulary, culture, script) are
   available at any time.

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
  counts for the lesson score and statistics. Items may be skipped: skipped items are excluded from the
  score and listed as skipped in the summary.
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
page and lesson progress (`packages/engine/src/learner/progress.ts`); mistakes (items whose latest
first attempt was wrong or partial) are derived by the server (`packages/server/src/services/mistakes.ts`).
The rest is planned:

- **Mistakes** with rule ids and lexemes, from closed exercises (via rule tags), speech diffs and LLM
  corrections (07).
- **Rule mastery**: accuracy over recent attempts per rule (formula fixed in stage 9a).
- **Lexeme state**: seen, practised, FSRS stability; "in long-term memory" when stability ≥ 21 days.
- **Item history**: attempts per item (lesson progress — status `new | in_progress | done`, best
  score — is built).
- **Can-do**: a course goal is achieved when its linked lessons are completed.

## Spaced repetition (planned, stage 6)

- FSRS via `ts-fsrs`, default parameters, desired retention 0.9 (profile setting).
- **Cards** come from new words of a completed page (one card per lexeme; meeting it again reuses it),
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
