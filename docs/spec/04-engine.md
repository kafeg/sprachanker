# 04 — Engine

`packages/engine` is pure TypeScript: no network, no filesystem, no clock (time and randomness are
parameters). It runs on the server and in the browser (instant feedback for closed exercises). The
server re-checks every answer with the same code; the stored outcome is the server's, never the
client's. Answers of closed exercises are visible to the client — acceptable for self-study.

## Lesson composition

The server returns a lesson's canonical file with its locale file for the profile's edition as they
are (`GET /api/lesson`); the player combines them. `speech_selfrate` items are recorded (08) and not
scored.

The lesson flow (the plan's steps, `lessonSteps` in `packages/engine/src/compose/steps.ts`; owner
2026-10-06): overview (synopsis, goals, the video or recording with its transcript under it) → "Words
of the lesson" (cards; when it has words) → one "Grammar" step per grammar page (a page is one topic) → the exercises →
one "Culture" step per culture page → AI practice when an assistant is set up and its place is on (07): "Write it yourself",
scene, "Going over mistakes" (owner 2026-10-07: the run's status counted by the app — exercises
worked, scored items right at the first attempt, mistakes by exercise — then the tutor goes through
the mistakes one at a time in the lesson's chat, inline on the step) → summary of all of it. The steps
come from what the provider's normaliser put into the canonical and locale files, the same way for
every course. Every step has a mark in the plan and "Next" goes through all of them; any step can be
skipped (and shows it). The lesson is completed when every step is done or skipped: an exercise
answered, a reading step opened, an AI step done once (the mistakes step: the tutor's first reply, or
opened with every exercise worked and no mistakes). AI steps are in the plan only while an assistant
is set up, so a lesson never depends on one. The reference tabs (vocabulary, grammar, culture, script,
homework, downloads) stay available at any time for looking things up.

Planned: composing with enrichment — rule tags, contrastive notes for the edition's source language, extra
exercises after the source's, authored scenes (on the lesson's scene step, not an exercise type);
stale entries skipped and reported (plan, "Enrichment and rules").

## Checking

Each exercise type (02) has a zod schema (schema), a checker (engine), a renderer (`apps/web`) and tests.
Checkers (`packages/engine/src/check/index.ts`) exist for every scored type, renderers for every type
but `unknown`. What the player asks before checking
is the engine's too (`check/answers.ts`): whether an exercise is checked at all, whether an answer is
complete enough to check, the words of an answer said aloud, a spoken answer the AI is to check
(`spokenFreely`: a `speech_selfrate` item without text, 08).

```ts
type Outcome = {
  result: "correct" | "partial" | "wrong" | "unscored";
  score: number;          // 0..1; partial = share of matched ids or words
  diff?: TokenDiff[];     // text and speech
  parts?: Record<string, boolean>;  // gaps by gap id, match pairs by left id: what the item marks
};
```

The renderers mark gaps and pairs from `parts` (an outcome without `parts` counts as a whole);
the UI never re-checks an answer.

- Matching is by ids, never by display position. Exception: options with identical content are
  interchangeable (`order` with repeated letters, `match` with the same form twice on either side, a
  word bank with duplicates), so ids with equal content compare equal. Content is the text as written
  (only whitespace evened out: "Berlin?" and "Berlin." differ), else the picture, else the id.
- `partial` only for multi-select, `order` with a correct prefix (parts beyond the sequence cost like
  missing ones), and dictation/speech with ≥ 80% of words matched — of the reference or the answer,
  whichever is longer, so extra words cost; a dash or a lone punctuation mark or symbol ("≈", "→") is no
  word. With several accepted texts, an exact match wins. Otherwise results are binary.
- **Attempts**: the learner may retry an item; every attempt is recorded, but only the **first attempt**
  counts for the lesson score and statistics. Items may be skipped: a skipped item that would be checked
  counts as wrong (score 0; its exercise is marked wrong) — a skip before the first answer is the first
  attempt, so answering after it does not count — a skipped speaking (`speech_selfrate`) or
  otherwise unscored item costs nothing (its exercise is marked skipped); the summary lists them as skipped.
- **Text normalisation**: NFC; unify quotes, apostrophes and dashes; collapse whitespace; strip final
  punctuation; case-insensitive except where the target language makes case meaningful (German: a
  token capitalised in the reference and not sentence-initial is compared case-sensitively; a gap
  starts a sentence only when nothing but a sentence's end comes before it). Speech is compared as
  heard: case and hyphens aside, and words joined differently are one word said ("Goodbye" for "Good
  bye" and the other way round); dictation compares how words are joined. Normalisation and the per-language case rule live in
  `packages/engine/src/text/normalise.ts`, the word diff in `packages/engine/src/text/diff.ts`.
- `respond`: scored from the rubric's required groups (each a phrase said as whole words) if it has
  them, otherwise `unscored`; the reference is shown either way. An LLM verdict on top: plan, "Later".
- `unknown` is never rendered; the page shows "not supported yet".

## Learner model

Pure functions over events and cards (05), read by the server per request:

- **Lesson result**: the mean first-attempt score of scored items (`learner/progress.ts`).
- **Lesson progress** (`lessonProgress`, the single reading used by the course list, the course map
  and the lesson): a lesson is done once a run of it was completed; it is in progress while an active
  run has answers, skips or steps done (also when it is done again); the best score counts only runs
  that scored an item, so a lesson of words only is done without a score. The lesson to go on with
  (`courseProgress`) is the one worked on most recently, else the first not done.
- **Resume page** (`resumePage`): the last exercise shown in the active run, where it is in the
  lesson now (its page number when the lesson no longer has it).
- **Item history** (`itemTries`, the Notebook's pass): an item's answers in a run, whether it was
  skipped without one, the attempt it was right at when the first was not.
- **Mistakes** (`learner/mistakes.ts`): items whose first attempt in the latest run that answered them
  was wrong or partial — an answer said aloud without a phrase read by the model's check of it (08) —
  with the answer, the model's correction, and whether a later answer got it right.
- **Study days** (`learner/activity.ts`): what each day held, counted by module (schema `stats.ts`:
  lessons, exams, review, AI practice; a run's module is its kind's) — lesson work (answers, skips,
  steps), exam answers, card answers (one taken back by undo does not count), new cards learnt, answers
  to cards in review and those not "Again" (the share remembered), AI practice (the learner's messages,
  checks asked for, in whichever run: a lesson's, an exam's, a chat or a scene) — and the totals of a
  span of days. The day starts at 4 AM (Spaced repetition, below).

Every module reports what the Notebook shows of it the same way (schema `stats.ts`: its headline
figures, its entries with their figures and latest runs; the server's modules each give their
`standing`): the words known (every face of the note in review) and each deck (`srs/deck.ts`) are
review's, the lessons done and worked on the lessons', the mock exams handed in the exams'. Planned:
mistakes by rule and lexeme, rule mastery, weak spots,
"Practise this", the can-do list (plan, "Enrichment and rules").

## Spaced repetition

Anki one-to-one (owner, 2026-10-07): the study queue, its limits, the reviewer's ratings, keys and
actions behave as in Anki (v3 scheduler, FSRS), so the learner's habits and decks carry over and
imported `.apkg` decks fit in. Scheduling and the queue are pure functions in
`packages/engine/src/srs/`; the server keeps the cards and answers (`services/cards.ts`).

- FSRS via `ts-fsrs`, default parameters, desired retention 0.9 (`srs.retention`), Anki's default
  steps: learning 1m 10m, relearning 10m; Hard on a new card is 6m; intervals fuzzed, the fuzz seeded
  by the face and its review count (as Anki seeds it by card), so the interval a button shows is the
  one the answer gets. A face lapsed 8 times is a leech (marked on the card); a face in FSRS's own
  "new" state (an imported deck) is new.
- **The day** starts at 4 AM local time (Anki's "next day starts at"; not a setting); limits and
  burying count from it.
- **The queue** (`studyQueue`): learning faces due now first; then reviews and new faces mixed evenly;
  new faces gathered by the order the cards were made, card 1 (recognition) of every note before card 2
  (production) before card 3 (listening). Limits per day: 20 new (`srs.newPerDay`), 200 reviews
  (`srs.reviewsPerDay`), new faces counting against the review limit too (as Anki by default). When nothing else is left,
  learning faces due within 20 minutes are shown ahead (learn ahead). Siblings are not buried.
- **Counts** as in Anki: new · learning · to review, the current card's queue underlined.
- **The reviewer**: the question; Show answer (Space, Enter, a tap) shows the question and the answer
  under a line; Again, Hard, Good, Easy (1–4; Space/Enter is Good) with the next interval on each.
  Undo (U, Ctrl+Z) takes back today's latest answer in the deck being studied (one in another deck
  is not this one's: a lesson's "Words" step never takes back the morning's review) and shows that
  card next. The More menu: replay audio (R, F5), bury card or note until tomorrow (-, =), suspend card or note (@, !), mark the note (*),
  seven flags (Ctrl+1–7). The word's recording plays by itself on the side that holds it. A deck's
  overview has the counts, Study now and Unbury; a finished deck says when the next learning card is
  due and whether new cards or reviews wait behind a limit.
- **Cards** come from the lesson's "Words" step and from taking a course's or an imported deck (below)
  (`services/cards.ts`): one card per lexeme and translation language — the edition's source language:
  a word learned through Russian and through English is two notes, since each shows its own
  translation; meeting it again in the same language reuses it (owner, 2026-10-07). A word added from
  its sheet: plan, "Open items in built areas", Review.
- **Decks** are virtual, as in Anki's deck list (`services/study.ts`): a language (`lang:<code>`) with
  its courses under it (`course:<key>`, by the lesson a word was first met in) — German and English
  never share a deck; an imported deck (`deck:<id>`: the cards of its words' lexemes in its translation
  language, so a word a course gave a card is studied in both); a lesson's own words in an edition
  (`lesson:<edition>:<key>`) in its "Words" step. A card belongs to the deck it was made in (a course's,
  by its display, or an imported deck's) for the deck list, My words and leaving.
- **Faces**: recognition (target → native), production (native → target), listening (audio → meaning).
  Enabled per card; the profile sets the default (recognition + production).
- **Deck options** are the profile's (Settings → Review, owner 2026-10-08), Anki's defaults where unset:
  new cards and reviews per day (20, 200), desired retention (0.9), the card types of a new word
  (recognition, production). The steps, the day's start and new cards within the review limit are
  Anki's defaults and not settings (owner, 2026-10-11).
- **AI examples** (owner, 2026-10-07): on request only — "Example" under a card's answer and in the
  word sheet — the model writes a sentence with the word (07, `word_example`). Each is kept with the
  card and never shown by itself: asking again shows the newest kept, "Another example" asks anew.
  The sentence's words are matched against the course's words up to the card's lesson (their forms,
  and a form differing only by an ending: `text/words.ts`); the others are marked new, translated by
  the course's later lessons, else by the model's glossary.
- **Imported decks** (plan, "Anki decks and word images"): an `.apkg` file (`packages/anki-export`:
  the collection in any of Anki's formats — `collection.anki21b`, else `.anki21`, else `.anki2`, never
  merged — its notes and media) becomes a deck of words in a language with translations in another,
  both chosen when importing. Each note is a word, its fields by name: word (Wort, Word, Front…),
  translation (Übersetzung, Translation, Back…), plural, part of speech (Wortart, part_of_speech…); or
  named by language, in English, German or the language itself (`german`, `russian`, `Deutsch`,
  `Русский`): the field of the words' language is the word, that of the translation language its
  translation, `audio_<language>` its audio, `sentence_<n>_<language>` with `audio_sentence_<n>_…`
  the deck's own example sentences — in the words' language, with their translation and audio, shown
  on the card's answer and in the word sheet; else the first field the word and the second its
  translation. HTML as text, the first `[sound:…]` of the word's field its audio; the audio kept with
  the deck (audio files only), each file named by its name's slug and a hash of the name — the same in
  every import, never shared by names that differ only in case. Its lexeme is made by the courses' rules (schema `shapeHeadword`,
  `germanGender`: "der Abend" a masculine noun — der/die/das before one word, or before more when the
  deck says it is a noun —, a phrase a phrase whatever the deck calls it); the deck's part of speech
  is taken where it names one: Nomen, Verb, Adjektiv…, and codes as `nf`/`nm`/`nn` (a noun's gender),
  `die (pl)` (plural only), `der, die` (either gender), only the first of several (`adj; adv`); a
  note without a word, or whose word makes no entry (no lemma, a key too long), is left out — the
  preview and the import say how many and why. So a word a course has links to its card. A card made from a
  deck's word has the deck in its source (`deck:<id>/<guid>`): two decks sharing a note never take
  each other's cards. Decks are the
  server's, every profile's to take (05, `decks/`); a package is uploaded once (kept beside the decks
  until imported, at most 512 MB, unpacking to at most 512 MB at a time — the collection, a batch of
  its media: a decompression bomb is refused) and previewed — its deck's name, words with audio and examples, the
  languages its fields are named by, the first words — then imported. A file imported again — most
  of its notes those of a deck here (by guid), and that deck mostly them, in the same languages: the
  preview names each such deck with its languages, the same file imported in two language pairs being
  two — updates that deck (another deck sharing a note, or the same in other languages,
  is one of its own), and cards follow their words (relinking); a card of a word the update drops
  keeps what it showed, its audio too (the deck's earlier audio stays); a deck is deleted only while no
  profile has cards made from it (they leave it first: nobody's progress goes unasked). Planned
  (phases after the import): audio read aloud by the server's engine for a deck's words without it,
  and examples by the AI for a whole deck's words without the deck's own (plan, item 1), kept beside
  the deck (`extras.json`, 05).
- **Decks to take** (owner, 2026-10-08/09): each course of My courses (begun) and language pair offers
  its words as one deck; so does each imported deck. Taking it makes every lesson's words cards at once, new and in course order
  (Anki: a deck imported); words with a card already keep it. **Leaving** a course's deck (after asking)
  removes its cards with their progress (faces and every answer to them, as a reset does); a card of a word another of the learner's decks has (a course
  or an imported deck with cards, in the same translation language) moves there with its progress
  instead (its word and display become that deck's). An imported deck is taken and left alike. **More new cards today** adds to a deck's daily limit for the
  study day (Anki's custom study "increase today's new card limit"; a course's extra counts in its
  language deck too, and the review limit grows as much so it does not hold them back).
- **"Words of the lesson"** is the same reviewer over the lesson's words in the edition's translation
  language, one face per word — recognition, or the card's first face when the learner's cards have
none (engine `lessonFace`) — and without the day's new limit (the learner chose to learn them now);
  otherwise exactly Anki's reviewer: a new word goes through the learning steps (1m, 10m), shown again
  within the 20-minute learn-ahead (owner, 2026-10-07: identical to Anki everywhere). The step is done
  once nothing is left to study now; the learning faces go on in Review.
- Planned: `.apkg` export, word images (plan, "Anki decks and word images").

## Exams

An installed exam (02) is taken in runs of kind `exam` (05). Pure functions in
`packages/engine/src/exam/`, randomness a parameter (the server passes WebCrypto's):

- **Open questions**: each section's pool, narrowed by its filter to the questions tagged with the
  profile's setting (`exam.federalState`); an exam with a setting unset cannot be drawn
  (`missingSettings`), and its page asks for it first.
- **Mock exam** (`drawExam`): each section draws its `draw` questions at random from its open pool, in
  section order — as the real test does (LiD: 30 general, 3 of the state); a section asking its whole
  pool (a Teil) asks it in its order. Of the whole exam or of one module, timed by it (`timeOf`);
  answers can be changed until it is handed in; nothing is checked before.
- **Practice** (`practiceOrder`): every open question (of one module, when chosen), those answered
  wrongly last time first, then those not seen, then those known, each group shuffled; each answer
  checked at once.
- **A question's state** (`questionStats`): its latest answer in any exam run, right or wrong, and how
  often it was answered (an open answer no check scored says nothing). **Readiness**: the share of the open questions whose latest answer was right.
- **Checking**: a question is the item of its kind it is (`checkQuestion`, "Checking" above).
- **Open answers** (writing, speaking) are rated by their criteria (`exam_rated`, 05): the levels
  chosen give their points (`ratedPoints`; a criterion that `voids` at 0 makes the answer 0), scaled
  to the question's points; until rated an answer counts 0 and the result says how many wait
  (`pending`).
- **Result** (`examResult`): each question's latest answer in the run scores its points times its
  outcome's score (a choice 0 or 1; an open answer by its latest rating), by the section the plan keeps for it
  (`sectionsOf`, when the run starts) and, with modules, by module, scaled to the module's `scaleTo`
  (rounded to whole points where the module says; the sum rounded where the exam says).
  The run is judged by the pass marks over the modules it took (`marksOf`: a module taken alone by its
  own, none when it has none); a mark is reached at its `minPoints` (of the scaled points of its
  modules, or of the points), and the exam is passed when any or all of them are (`passWhen`). A mock exam is scored over all it
  asked, unanswered ones as wrong; practice over the questions answered.

## Scenes

`scene_setup` drafts a scene from the lesson's goals and words (title, situation, partner, 1–3 goals,
opening line); `scene_turn` runs it (`packages/llm/src/tasks/scene.ts`, 07). Authored scenes in
enrichment: plan, "Enrichment and rules".
