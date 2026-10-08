# Plan

What is left to build, in order. What is built is described by the spec (`docs/spec/`) and the code;
how it fits together, by `docs/architecture.md`. Each item names the spec files it touches.

## How we work

1. **Plan** (before code): goals, modules touched, files, what is reused, risks, how acceptance is
   checked, the details the spec leaves open. Larger than about three sessions → split it. The owner
   approves. New screens or redesigns: rendered mockup options first, the owner picks.
2. **Implement** in small commits to `main`, each with tests; `bun run check` and `bun run e2e` green
   (check their exit codes, not a piped tail).
3. **Demo**: commands to run, what to look at, on Mac and iPhone.
4. **Review checklist**: engineering principles (root CLAUDE.md) · boundaries · tests · spec, this plan
   and CLAUDE.md current · no third-party content · i18n keys complete.
5. **Stop and report after every item**: what was built, what was learned, open problems, an honest
   view of direction and remaining scope, proposed spec/plan edits, the next item's plan.

## MVP boundary

**MVP = what two people need for a week of real study**: courses installed from the interface, the
lesson player, cards and review, two profiles on Mac and phones, speech checks, Leben in Deutschland,
LLM via external providers — `sprachanker serve` with browser/PWA access. Do not build post-MVP features
early. Built early at the owner's request: courses beyond Nicos Weg A1 (DW in Russian, English and
German; Deutsch im Blick and four English courses importable with the CLI) and the LLM features.

Focus (owner, 2026-10-07): German — the onboarding's language pair filters Courses; every provider is
offered (03, "Offered in the app").

## Next, in order

### 1. Speech
Specs: 08, 06.
- whisper-server and TTS sidecars with supervision, capture → WAV, `speech_repeat`, push-to-talk, TTS;
  how the binaries are obtained (`native/` builds or prebuilt) is decided in this item's plan.
- **Accept**: latency target (08) met on the owner's Mac with his own phrases; recordings replayable in
  the Notebook; speech disabled with a clear message on plain HTTP.

### 2. Exams: Leben in Deutschland
Specs: 02, 03, 06, 09.
- Provider `bamf-lid` (official PDF), exam player and Exams screen: pools, state filter, timer, practice
  of wrong answers.
- Offered as a course (owner, 2026-10-08): "Leben in Deutschland" is listed in Courses (Available,
  then Downloaded and My courses) and installed from the interface like any course, its exam opened
  from its course page.
- **Accept**: a timed exam with Berlin questions end to end; results in the Notebook.

### 3. Notebook: more pictures (owner's request, 2026-10-07)
Specs: 04, 05, 09.
- Reviews and new cards per day, the share remembered over time, words by state (new, learning,
  known), lessons and courses done; a review day opens to its answers as a lesson pass does.
- Time spent: card answers carry no time yet (`CardReviewPayload`); measuring it is part of this item.
- **Accept**: engine tests of the derivations; e2e on desktop and phone.

### 4. MVP acceptance
- The owner's demo of cards, review and the Notebook on Mac and iPhone (open since 2026-10-07).
- The owner and his wife use the MVP for at least one week of real study on phones and Mac; their
  findings decide the order of the work after the MVP.

## Open items in built areas
Taken along when an item above touches the area, or on request.
- Library (02, 03): key map per provider (keys stay when the source reorders), series manifest with
  `contentVersion`, `normalise <series>` from `raw/` offline, `verify` checks for manifest hashes and
  rule ids; content updated while a run is active ends the run (05).
- Engine (04): compose with the selfrate upgrade and enrichment.
- Server (05, 06): export/import of a profile, structured logs, recordings served only to their profile.
- Review (09): the course map's exams and can-do list; speech settings; a word anywhere in a lesson
  opens its sheet (09, "word sheet": forms, translation, audio, examples from lessons met, answers,
  "add to cards").
- Tests (10): the web tests log `ECONNREFUSED 127.0.0.1:4580` — a request escapes the filled query
  cache; find it and make the tests quiet.

## After the MVP
Order decided by the week of use.
- **Enrichment and rules** (02, 04, 07): `enrich check`, the rules registry for A1, A1 enrichment chapter
  by chapter (rule tags, contrastive notes, speaking, scenes), mistakes by rule, rule mastery, weak spots,
  "Practise this", can-do list. Accept: A1 units 0–2 enriched and reviewed; a practice set from du/Sie
  mistakes runs end to end.
- **Anki decks and word images** (04): `packages/anki-export` (`.apkg` export and import, stored decks),
  word images. Decks are got like courses (owner, 2026-10-08): Review → Decks lists decks to download
  (a catalogue of shared decks; AnkiWeb asks for an account after a few searches, so its decks come
  by link or as an `.apkg` file) and the profile's own; a downloaded deck is taken and left like a
  course's. Accept: an exported A1 deck opens in Anki with audio; an imported deck links matching words.
- **Books** (owner, 2026-10-08): free books downloaded and read like courses — a library of books to
  download (public-domain sources such as Project Gutenberg; the sources and their terms decided in the
  item's plan), "My books" with the place read; a reader with the translation beside (by sentence or
  paragraph), a word tapped opens its sheet (dictionary: the course's words, else the model) and goes
  to cards, the AI to explain a sentence or the grammar, and read aloud (speech). Accept: a German book
  downloaded, read on Mac and iPhone with translation, words added to Review.
- **More sources**: B1 glossary, Deutsch im Blick interviews, Starter English (03).
- **Desktop app** (06, 09): Tauri shell, first-run wizard (incl. LM Studio), network options with QR,
  signed bundles for macOS then Windows and Linux, auto-update. Accept: fresh machine → lesson 1 in
  under 30 minutes (without the course download); headless `serve` works on a second machine.
- **Later**: missions, unit reviews, in-lesson adaptivity, LLM verdicts for `respond` (`check_answer`),
  per-task LLM routes, handoff to other assistants, LLM golden tests, Goethe A1 practice sets, FSRS for
  Leben in Deutschland, the FSRS optimizer in the Review settings (once there is history), badges, a local CA for LAN HTTPS, Qwen3-TTS and cloud speech, offline use and push
  notifications, `.apkg` with scheduling,
  Docker image, project website, native mobile via Tauri.
