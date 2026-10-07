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

Focus (owner, 2026-10-07): German. All courses offers DW; the rest stays CLI-only (03, "Offered for now").

## Next, in order

### 1. Profiles
Specs: 05, 06, 09.
- `server.sqlite` (profiles, devices); a profile database per profile (the one `profiles/local` today
  becomes the owner's); owner setup link (`sprachanker owner-link`); owner-only areas (06, "Profiles
  and access"); device tokens; optional PIN with rate limiting; profiles in the PWA (choose, create,
  switch); the owner resets another profile's PIN and deletes profiles.
- Decided (owner, 2026-10-07): registration of new profiles is **open by default**, the owner closes
  it; LLM provider settings stay **per profile** (07).
- **Accept**: integration and migration tests (the owner's existing data becomes the owner profile);
  two profiles on Mac and iPhone with separate progress; a run continues on a second device with events
  from both stored; Host check, CSRF header and PIN rate limit covered by tests; e2e for choosing and
  creating a profile on desktop and phone.

### 2. AI examples for a word (owner's request, 2026-10-07)
Specs: 04, 07, 09.
- On request only: an "Example" button on a card's answer side and in the word sheet asks the model for
  an example sentence with its translation in the card's translation language.
- Kept with the card and never shown by itself: what was generated comes back only when examples are
  asked for again (the learner can ask for a new one). Marked as AI like "Why is this wrong?"
  (`AssistantLabel` under it).
- Vocabulary: the words of the course up to the card's lesson, plus basic A1 words the prompt allows
  (early lessons have almost none), plus the word itself. Words of the example not met in the course yet
  are found by us (the course's vocabulary, not the model) and highlighted with their translation.
- Checks: the sentence contains the word (a form of it); one repair attempt as other structured tasks.
- **Accept**: llm task tests against the fake endpoint; server tests (stored, hidden, reused); e2e with
  the fake server on desktop and phone.

### 3. Speech
Specs: 08, 06.
- whisper-server and TTS sidecars with supervision, capture → WAV, `speech_repeat`, push-to-talk, TTS;
  how the binaries are obtained (`native/` builds or prebuilt) is decided in this item's plan.
- **Accept**: latency target (08) met on the owner's Mac with his own phrases; recordings replayable in
  the Notebook; speech disabled with a clear message on plain HTTP.

### 4. Exams: Leben in Deutschland
Specs: 02, 03, 06, 09.
- Provider `bamf-lid` (official PDF), exam player and Exams screen: pools, state filter, timer, practice
  of wrong answers.
- **Accept**: a timed exam with Berlin questions end to end; results in the Notebook.

### 5. MVP acceptance
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
- Review (09): a deck's words list; the course map's exams and can-do list; speech and SRS settings.

## After the MVP
Order decided by the week of use.
- **Enrichment and rules** (02, 04, 07): `enrich check`, the rules registry for A1, A1 enrichment chapter
  by chapter (rule tags, contrastive notes, speaking, scenes), mistakes by rule, rule mastery, weak spots,
  "Practise this", can-do list. Accept: A1 units 0–2 enriched and reviewed; a practice set from du/Sie
  mistakes runs end to end.
- **Anki decks and word images** (04): `packages/anki-export` (`.apkg` export and import, stored decks),
  word images. Accept: an exported A1 deck opens in Anki with audio; an imported deck links matching words.
- **More sources**: B1 glossary, Deutsch im Blick interviews, Starter English (03).
- **Desktop app** (06, 09): Tauri shell, first-run wizard (incl. LM Studio), network options with QR,
  signed bundles for macOS then Windows and Linux, auto-update. Accept: fresh machine → lesson 1 in
  under 30 minutes (without the course download); headless `serve` works on a second machine.
- **Later**: missions, unit reviews, in-lesson adaptivity, LLM verdicts for `respond` (`check_answer`),
  per-task LLM routes, handoff to other assistants, LLM golden tests, Goethe A1 practice sets, FSRS for
  Leben in Deutschland, badges, a local CA for LAN HTTPS, Qwen3-TTS and cloud speech, offline use and push
  notifications, a reader for books and texts, `.apkg` with scheduling, FSRS parameter optimisation,
  Docker image, project website, native mobile via Tauri.
