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
   scene, "Going over mistakes" (owner 2026-10-07: the run's status counted by the app — exercises
   worked, scored items right at the first attempt, mistakes by exercise — then the tutor goes through
   the mistakes one at a time in the lesson's chat, inline on the step) → summary of all of it. The steps come from what
   the provider's normaliser put into the canonical and locale files, the same way for every course.
   Every step has a mark in the plan and "Next" goes through all of them; any step can be skipped (and
   shows it). The lesson is completed when every step is done or skipped: an exercise answered, a
   reading step opened, an AI step done once (the mistakes step: the tutor's first reply, or opened
   with every exercise worked and no mistakes). AI steps are in the plan only while an assistant is set
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
  parts?: Record<string, boolean>;  // gaps by gap id, match pairs by left id: what the item marks
};
```

The renderers mark gaps and pairs from `parts` (an outcome stored before parts counts as a whole);
the UI never re-checks an answer.

- Matching is by ids, never by display position. Exception: options with identical content are
  interchangeable (`order` with repeated letters, `match` with the same form twice on either side, a
  word bank with duplicates), so ids with equal content compare equal. Content is the text as written
  (only whitespace evened out: "Berlin?" and "Berlin." differ), else the picture, else the id.
- `partial` only for multi-select, `order` with a correct prefix (parts beyond the sequence cost like
  missing ones), and dictation/speech with ≥ 80% of words matched — of the reference or the answer,
  whichever is longer, so extra words cost; a dash or lone punctuation mark is no word. With several
  accepted texts, an exact match wins. Otherwise results are binary.
- **Attempts**: the learner may retry an item; every attempt is recorded, but only the **first attempt**
  counts for the lesson score and statistics. Items may be skipped: a skipped item that would be checked
  counts as wrong (score 0; its exercise is marked wrong) — a skip before the first answer is the first
  attempt, so answering after it does not count — a skipped self-rated or otherwise unscored item
  costs nothing (its exercise is marked skipped); the summary lists them as skipped.
- **Text normalisation**: NFC; unify quotes, apostrophes and dashes; collapse whitespace; strip final
  punctuation; case-insensitive except where the target language makes case meaningful (German: a
  token capitalised in the reference and not sentence-initial is compared case-sensitively; a gap
  starts a sentence only when nothing but a sentence's end comes before it). Speech is
  always compared case-insensitively. Normalisation and the per-language case rule live in
  `packages/engine/src/text/normalise.ts`, the word diff in `packages/engine/src/text/diff.ts`.
- `respond`: scored from the rubric's required groups (each a phrase said as whole words) if it has
  them, otherwise `unscored`; the outcome
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
- **Lexeme state**: as Anki counts its cards — new until a face is answered, learning while a face is
  learning or relearning, else review; each face keeps its FSRS state (stability, due, lapses).
- **Item history**: attempts per item (lesson progress — status `new | in_progress | done`, best
  score — is built).
- **Can-do**: a course goal is achieved when its linked lessons are completed.

## Spaced repetition (stage 6)

Anki one-to-one (owner, 2026-10-07): the study queue, its limits, the reviewer's ratings, keys and
actions behave as in Anki (v3 scheduler, FSRS), so the learner's habits and decks carry over and
`.apkg` decks imported later (stage 10) fit in. Scheduling and the queue are pure functions in
`packages/engine/src/srs/`; the server keeps the cards and answers (`services/cards.ts`).

- FSRS via `ts-fsrs`, default parameters, desired retention 0.9 (`srs.retention`), Anki's default
  steps: learning 1m 10m, relearning 10m; Hard on a new card is 6m; intervals fuzzed, the fuzz seeded
  by the face and its review count (as Anki seeds it by card), so the interval a button shows is the
  one the answer gets. A face lapsed 8 times is a leech (marked on the card); a face in FSRS's own
  "new" state (an imported deck) is new.
- **The day** starts at 4 AM local time (Anki's "next day starts at"); limits and burying count from it.
- **The queue** (`studyQueue`): learning faces due now first; then reviews and new faces mixed evenly;
  new faces gathered by the order the cards were made, card 1 (recognition) of every note before card 2
  (production) before card 3 (listening). Limits per day: 20 new (`srs.newPerDay`), 200 reviews
  (`srs.reviewsPerDay`), new faces counting against the review limit too. When nothing else is left,
  learning faces due within 20 minutes are shown ahead (learn ahead). Siblings are not buried.
- **Counts** as in Anki: new · learning · to review, the current card's queue underlined.
- **The reviewer**: the question; Show answer (Space, Enter, a tap) shows the question and the answer
  under a line; Again, Hard, Good, Easy (1–4; Space/Enter is Good) with the next interval on each.
  Undo (U, Ctrl+Z) takes back today's latest answer and shows that card next. The More menu: replay
  audio (R, F5), bury card or note until tomorrow (-, =), suspend card or note (@, !), mark the note (*),
  seven flags (Ctrl+1–7). The word's recording plays by itself on the side that holds it. A deck's
  overview has the counts, Study now and Unbury; a finished deck says when the next learning card is
  due and whether new cards or reviews wait behind a limit.
- **Cards** come from the lesson's "Words" step (one card per lexeme and translation language — the
  edition's source language: a word learned through Russian and through English is two notes, since
  each shows its own translation; meeting it again in the same language reuses it; owner, 2026-10-07),
  words the learner adds, phrases in enrichment (`cards.phrases`), and sentences from mistakes.
- **Faces**: recognition (target → native), production (native → target), listening (audio → meaning).
  Enabled per card; the profile sets the default (recognition + production).
- **"Words of the lesson"** is the same reviewer over the lesson's words in the edition's translation
  language, recognition only and without the day's new limit (the learner chose to learn them now);
  otherwise exactly Anki's reviewer: a new word goes through the learning steps (1m, 10m), shown again
  within the 20-minute learn-ahead (owner, 2026-10-07: identical to Anki everywhere). The step is done
  once nothing is left to study now; the learning faces go on in Review.
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
