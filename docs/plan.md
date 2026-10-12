# Plan

What is left to build. What is built is described by the spec (`docs/spec/`) and the code; how it
fits together, by `docs/architecture.md`.

## Direction

- Past the first version's scope (owner, 2026-10-08): the items below are what the owner wants next,
  in this order; anything else waits for "After the week of use".
- Exams taken up now, ahead of item 1: Goethe A1–B1 next (owner, 2026-10-10).
- German first (owner, 2026-10-07): every provider is offered (03, "Offered in the app").
- The desktop browser now; phones when convenient (item "Phones": Tailscale is known to work).

## Next, in order

### 1. Interface in every language a course explains in (owner, 2026-10-09)
Specs: 09, 10.
- The UI catalogs beyond en/ru/de: every source language of the installed providers (DW: Arabic,
  Bosnian, Greek, Spanish, Persian, French, Hindi, Hungarian, Indonesian, Polish, Portuguese,
  Romanian, Swahili, Turkish, Ukrainian, Chinese, …): translated (model-assisted, then checked by the
  catalog tests), a file `apps/web/src/i18n/<code>.json` each — the language list, right to left, the
  fonts and the tests take a new file as it is (09, 10).
- **Accept**: catalog tests over every language; RTL screens in e2e (`e2e/rtl.e2e.ts`, run once
  `ar.json` is there).

### 4. Phones (owner, 2026-10-08: functionality first, phones after)
Specs: 06, 09.
- Done, described in 06 ("Network and HTTPS", "Host check"): the server answers to its tailnet name
  and to `serve --allow-host`; HTTPS through `tailscale serve`; the addresses (`GET /api/addresses`),
  shown in Settings → General → Other devices and the sidebar's "On a phone" (09; owner's choice C):
  each with Copy and a QR code, what one lacks said (no microphone without HTTPS, how to open the
  server to the network, how to serve the tailnet, Funnel refused).
- Remaining: trying it on the iPhones (below) — the QR codes scanned, the addresses opened.
- The app on the owner's and his wife's iPhones: `tailscale serve` set up on the server's machine,
  installed as a PWA, signing in on a phone (device token).
- Everything built so far checked on the iPhone: lessons, review, the Notebook, profiles, the AI;
  speech — the microphone and recording, recognition, reading aloud (the device's voices in Safari;
  Piper and Qwen3-TTS from the server) — in Safari and the PWA; layouts at phone width; what breaks is
  fixed here.
- **Accept**: a lesson with speaking and a review session done on each iPhone through Tailscale.

### 6. A week of real use
- The owner's demo of cards, review and the Notebook on the Mac (open since 2026-10-07).
- The owner and his wife study with it for at least a week — on the Mac, and on phones once item
  "Phones" is done; their findings decide the order of "After the week of use".

### 8. Speaking practice with the AI (owner, 2026-10-11; 2026-10-12: Speaking replaces the Dialogue)
Specs: 04 ("AI practice in courses"), 07, 08, 09.
- Built: the lesson's Speaking step — a monologue card or a role-play from the text generator, said
  aloud and checked once at the end (no wait for the model between lines). The Dialogue (a live
  conversation on a goal card) is out of the lesson; its runs read on.
- Remaining: tried on the owner's Mac and iPhone with Whisper and a real model (the e2e run uses the
  fake model and a fake microphone); Speaking's attempts in the Notebook's pass (as writing checks
  are); the live conversation moved to the Tutor section
  (`apps/web/src/llm/dialogue.tsx` and the `scene` tasks kept for it), the base of exams' speaking
  parts (Goethe Sprechen) held the same way.
- **Accept**: a Speaking task of each kind said by voice end to end in a lesson, its check shown and kept.

### 9. AI practice in courses: seven exercises (owner, 2026-10-11)
Specs: 04 ("AI practice in courses"), 07, 08, 09.
- The agreed list (04): inside a lesson "Why is this wrong?", "Check with AI" for spoken answers and
  the lesson tutor (questions and explanations only); at the lesson's end the AI practice step —
  Reading, Listening, Writing, Speaking —, each skippable; going over mistakes in the summary. Owner's rules: a text read
  aloud only in one language given explicitly; no dictation where the task is writing; tutor replies
  not read aloud; recognised speech taken as a person would understand it.
- Phase 1 (done): the knowledge snapshot ("what the learner knows by now", 07) under every lesson
  task — no task assumes A1 or a beginner — and the Dialogue (item 8).
- Phase 2 (done): **Understanding** — a text or dialogue from the words known, read again by the
  model to keep only the questions it settles, heard by reading aloud (two voices for a dialogue, the
  engine and voices named), answered by ear, then read with its reading question; reading-type texts
  shown to read; the questions closed items checked by the engine. Replaced by phase 4.
- Phase 3 (done, from the walkthrough of 2026-10-12): **Writing** on a task of three content points
  set by the model (length and criteria by level; each point rated, at most three corrections, a
  model text); **Going over mistakes** by type — the wrong parts only, an explanation and new items
  per type checked by the engine (`mistake_items`), the step only with mistakes; "Why is this
  wrong?" saying where the topic was taught; the tutor kept to explanations (practice presets out,
  its rules from the walkthrough). Remaining: tried on a real course with a real model (the e2e run
  uses the fake model).
- Phase 4 (owner, 2026-10-12: texts that did not hang together, two same voices, women read by men):
  **Reading** and **Listening** as two steps on one text generator — genres drawn by code, three
  drafts rated by a judge, 5–10 questions read again with and without the text, each person a voice
  of their gender, made ahead as the lesson starts (04). Built; tuned on `bun run practice:texts`.
  Writing answers a message from the generator; Speaking's role-play is one of its conversations.
  Remaining: Listening heard with Qwen3-TTS on a phone; Writing's and Speaking's tasks tuned on bulk
  runs as the texts were.
- Going over mistakes across lessons (owner, 2026-10-12: within one lesson it is out of the plan,
  in the summary): a Notebook section gathering the mistakes that come back — the exercises', and
  Writing's and Speaking's corrections — over several lessons, by type, with new items of them, offered
  when enough have gathered (a week's, say).
- **Accept**: each phase's exercises held end to end in a lesson on the fixture course (e2e) and on a
  real course with a real model.

### 10. Goethe mock exams on the AI practice's machinery (owner, 2026-10-12: planned, not begun)
Specs: 01, 04, 07, 08, 09. Proposal and options: `docs/research/goethe-exams-redesign.md`.
- Sprechen by voice per Teil as the real exam runs it: the examiner's fixed lines from a turn script,
  the partner played by the model with the Dialogue's information-gap rules, two voices, the part's
  clock; rated by the official criteria as a proposal the learner confirms, pronunciation rated by
  the learner from their recordings; a marked transcript and model phrases after each part.
- Generated extra Hören, Lesen and Schreiben in the real Teile's formats on Understanding's and
  Writing's machinery, counted apart from the Modellsatz; Prüfungstraining from the weakest Teile.
- The owner chooses the option (minimal, recommended, full) before it is begun; start with A2
  Sprechen by voice to try a live conversation with the model's pauses.
- **Accept**: the chosen option's parts held end to end on Goethe A1–B1 with a real model.

## Open items in built areas
Taken along when an item above touches the area, or on request.
- Library (02, 03): a key map for providers other than DW (keys stay when the source reorders),
  `normalise <series>` from `raw/` offline, `verify` checks for manifest hashes and
  rule ids; content updated while a run is active ends the run (05). A word the source leaves without
  a translation in one lesson takes the translation its lexeme has elsewhere in the same edition (DW:
  Persian A1 "alt", German A2 "der Spinat"; seen in the 2026-10-08 audit of all Nicos Weg editions).
  A course normalised by an older normaliser flagged for re-import: the provider's normaliser
  revision in the course data, read by `verify` and the course page (a library normalised before
  speaking items had `reference` still diffs a spoken answer against the question it answers).
- Server (05, 06): structured logs.
- Moving one's data (02 "Course bundle", 05 "Profile file"; research:
  `docs/research/bundles-and-backups.md`): tried on the owner's machines — a profile moved and studied
  on (`e2e/profile-transfer.e2e.ts` does it here), a course and an exam moved as bundles and verified
  (`e2e/course-transfer.e2e.ts`). A profile file's manifest names its courses by key and edition, not
  yet by content version (02, "Manifest"). An imported deck is named by its id, which another
  machine's import of the same `.apkg` does not share: its cards there keep their display but not
  their audio (with deck bundles). Open for the owner: pruning media no course uses (1.56 GB today,
  after checking what passes and cards name); the defaults taken for bundles (02, "Course bundle":
  `raw/` left out but an exam's source copies, `.sprachanker-course`, a course that differs replaced
  rather than asked).
- Tutor section (07): no tools yet — what it knows is the summary of the courses; the lesson tutor's
  tools across every course of the chat's language (where a word is taught, what a lesson covers,
  the mistakes of one lesson) when a summary proves too little.
- Lesson (09): the lesson's review back, together with going over mistakes — one analysis across the
  exercises (answers, speech verdicts, writing, scenes, mistakes) (owner, 2026-10-08). The microphone
  beside the Writing box, as in free answers, scenes and the tutor.
- Notebook (09): a lesson's page opened without passes (a link) has no title — the server names it by
  the edition of a pass. Time spent outside cards is read from the gaps between a run's events (04),
  a pass's "how long" is still from its start to its end (or last work); words known over time
  (when each word's last side came into review) when the owner asks for it.
- Review (09): the course map's can-do list; a word anywhere in a lesson opens its sheet (09, "word
  sheet": forms, translation, audio, examples from lessons met, answers, "add to cards").
- Reading aloud (08): Qwen3-TTS's voice cloning and voice design (the engine has both; a voice of the
  learner's choosing per language) — on request.

## After the week of use
Order decided by the week of use.
- **Enrichment and rules** (02, 04, 07): `enrich check`, the rules registry for A1, A1 enrichment chapter
  by chapter (rule tags, contrastive notes, speaking, scenes), mistakes by rule, rule mastery, weak spots,
  "Practise this", can-do list. Accept: A1 units 0–2 enriched and reviewed; a practice set from du/Sie
  mistakes runs end to end.
- **Anki decks and word images** (04): `.apkg` export (`packages/anki-export`), word images. Decks are
  got like courses (owner, 2026-10-08): Review → Decks also lists decks to download (a catalogue of
  shared decks; AnkiWeb asks for an account after a few searches, so its decks come by link). Accept:
  an exported A1 deck opens in Anki with audio.
- **Books** (owner, 2026-10-08): free books downloaded and read like courses — a library of books to
  download (public-domain sources such as Project Gutenberg; the sources and their terms decided
  when it is built), "My books" with the place read; a reader with the translation beside (by sentence or
  paragraph), a word tapped opens its sheet (dictionary: the course's words, else the model) and goes
  to cards, the AI to explain a sentence or the grammar, and read aloud (the reading-aloud engines:
  a word or sentence heard, for its pronunciation). Accept: a German book downloaded, read on Mac and
  iPhone with translation, words added to Review.
- **Exams beyond Leben in Deutschland** (owner, 2026-10-10: set aside; experimental until then —
  Settings → General → Experimental). Leben in Deutschland is the exam in use. Built for the rest (01–09): the
  exam layer for language exams (modules of Teile with their material, scaling and rounding), Goethe
  A1, A2, B1 — Hören, Lesen, Schreiben and Sprechen with their criteria — open answers rated by the
  learner or as the assistant proposes, speaking parts held as a conversation with the assistant, A2's
  real pass marks, each exam's sources and checks. Where it stopped and why: the owner has not taken
  these exams and cannot yet say how they should feel; what is unverified — the speaking conversation
  with a real model, A1 Sprechen's points per task (the regulations say only full, half or none),
  B1's levels undescribed (only its PDF's criteria table says what each band means), whether the mock
  exams match the real experience. Left as planned: independent checks (LiD against public answer
  lists — done once by hand, 460/460; Goethe A1 against telc's Start Deutsch 1 key) as a check in the
  sources; placement tests (German, English) and the German driving theory test (research first:
  which sources are open, their terms, how an importer reads them); telc, DTZ, ÖSD model tests (PDF +
  MP3, text answer keys); English exams with the English courses. Research: `docs/research/exams.md`.
- **More sources**: B1 glossary, Deutsch im Blick interviews, Starter English (03).
- **Desktop app** (06, 09): Tauri shell, first-run wizard (the data folder chosen there, LM Studio),
  network options with QR, the speech engines bundled (whisper-server, sherpa-onnx, tts-server),
  signed bundles for macOS then Windows and Linux, auto-update. Accept: fresh machine → lesson 1 in
  under 30 minutes (without the course download); headless `serve` works on a second machine.
- **Later**: missions, unit reviews, in-lesson adaptivity, LLM verdicts for `respond` (`check_answer`),
  per-task LLM routes, handoff to other assistants, LLM golden tests, FSRS for Leben in Deutschland,
  the FSRS optimizer in the Review settings (once there is history), badges, a local CA for LAN HTTPS,
  cloud speech, pronunciation by sounds
  (researched 2026-10-08 and set aside by the owner: a local phoneme recogniser against espeak-ng
  references is unreliable for German learners without annotated learner speech, and nothing ready
  names their wrong sounds; a prototype on the owner's phrases would decide), offline use and push
  notifications, `.apkg` with scheduling,
  Docker image, project website, native mobile via Tauri.
