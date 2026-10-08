# Plan

What is left to build, in order. What is built is described by the spec (`docs/spec/`) and the code;
how it fits together, by `docs/architecture.md`. Each item names the spec files it touches.

## How we work

1. **Plan** (before code): goals, modules touched, files, what is reused, risks, how acceptance is
   checked, the details the spec leaves open. Larger than about three sessions → split it. The owner
   approves. New screens or redesigns: rendered mockup options first, the owner picks.
2. **Implement** in small commits to `main`, each with tests; `bun run check` and `bun run e2e` green
   (check their exit codes, not a piped tail).
3. **Demo**: commands to run, what to look at, on the Mac (phones: item "Phones").
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

### 1. Speech (owner's decisions, 2026-10-08)
Specs: 08, 06, 09. Recording is built (08); three steps left, each planned, built and accepted on
its own.
1. **Recognition**: `whisper-server` (large-v3-turbo; how the binary is obtained — `native/` build or
   prebuilt — and whether Parakeet v3 is offered too is decided in the step's plan), the model
   downloaded as a job, `speech_repeat`: the transcript compared word by word with the item's text
   (engine diff: words matched and missed, "heard: …"), the outcome from it (≥ 80% of words, 04);
   recorded speaking with a reference text becomes `speech_repeat`; free speaking ("answer it
   yourself") is checked by the AI from the transcript when one is set up, else counts when recorded;
   verdicts are kept as text in the run (heard, words matched, the AI's note), so the Notebook, going
   over mistakes and the tutor read them;
   lenient by nature (whisper corrects what it hears), no pronunciation grade.
   Accept: the latency target (08) on the owner's Mac with his phrases.
2. **Speaking where text is typed**: spoken answers in `respond`, scenes and the tutor (the transcript
   editable before it is sent). Not on review cards for now.
3. **Synthesis**: the device's voices by default (Web Speech API; Apple's enhanced voices); in the
   settings Piper or Qwen3-TTS on the server instead. Used for words without a recording, AI examples
   (a play button), tutor and scene replies (read aloud on request or automatically).
- Settings → Speech gains: recognition on/off and its model (size, download), push-to-talk mode,
  synthesis engine and a voice per language with "Listen", speed, reading AI replies aloud.
- **Accept** (the item): the three steps on the Mac; the iPhone in item "Phones".

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

### 4. Phones (owner, 2026-10-08: functionality first, phones after)
Specs: 06, 09.
- The app on the owner's and his wife's iPhones: HTTPS through Tailscale (`tailscale serve`, 06) set
  up and described, installed as a PWA, signing in on a phone (device token, PIN).
- Everything built so far checked on the iPhone: lessons, review, the Notebook, profiles, the AI;
  speech — the microphone and recording (built), recognition and synthesis (item 1) — in Safari and
  the PWA; layouts at phone width; what breaks is fixed here.
- **Accept**: a lesson with speaking and a review session done on each iPhone through Tailscale.

### 5. MVP acceptance
- The owner's demo of cards, review and the Notebook on the Mac (open since 2026-10-07).
- The owner and his wife use the MVP for at least one week of real study on phones and Mac; their
  findings decide the order of the work after the MVP.

## Open items in built areas
Taken along when an item above touches the area, or on request.
- Library (02, 03): key map per provider (keys stay when the source reorders), series manifest with
  `contentVersion`, `normalise <series>` from `raw/` offline, `verify` checks for manifest hashes and
  rule ids; content updated while a run is active ends the run (05).
- Engine (04): compose with the selfrate upgrade and enrichment.
- Server (05, 06): export/import of a profile, structured logs, recordings served only to their profile.
- Lesson (09): the lesson's review back, together with going over mistakes — one analysis across the
  exercises (answers, speech verdicts, writing, scenes, mistakes) (owner, 2026-10-08).
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
  to cards, the AI to explain a sentence or the grammar, and read aloud (speech: a word or sentence
  heard, for its pronunciation). Accept: a German book
  downloaded, read on Mac and iPhone with translation, words added to Review.
- **More sources**: B1 glossary, Deutsch im Blick interviews, Starter English (03).
- **Desktop app** (06, 09): Tauri shell, first-run wizard (incl. LM Studio), network options with QR,
  signed bundles for macOS then Windows and Linux, auto-update. Accept: fresh machine → lesson 1 in
  under 30 minutes (without the course download); headless `serve` works on a second machine.
- **Later**: missions, unit reviews, in-lesson adaptivity, LLM verdicts for `respond` (`check_answer`),
  per-task LLM routes, handoff to other assistants, LLM golden tests, Goethe A1 practice sets, FSRS for
  Leben in Deutschland, the FSRS optimizer in the Review settings (once there is history), badges, a local CA for LAN HTTPS, Qwen3-TTS and cloud speech, pronunciation by sounds
  (researched 2026-10-08 and set aside by the owner: a local phoneme recogniser against espeak-ng
  references is unreliable for German learners without annotated learner speech, and nothing ready
  names their wrong sounds; a prototype on the owner's phrases would decide), offline use and push
  notifications, `.apkg` with scheduling,
  Docker image, project website, native mobile via Tauri.
