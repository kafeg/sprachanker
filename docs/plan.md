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
  and to `serve --allow-host`; HTTPS through `tailscale serve`; the addresses as data
  (`GET /api/addresses`; `useAddresses` in apps/web, not shown yet).
- The addresses shown in the app (owner, 2026-10-09): this machine, the local network (when the
  server listens beyond 127.0.0.1, `--host`), Tailscale — where to show them (Settings, or the foot
  of the side panel beside the profile) by mockup options, the owner's choice; an address without a
  secure context says that the microphone needs HTTPS there; a tailnet not served says how to serve it.
- The app on the owner's and his wife's iPhones: `tailscale serve` set up on the server's machine,
  installed as a PWA, signing in on a phone (device token).
- Everything built so far checked on the iPhone: lessons, review, the Notebook, profiles, the AI;
  speech — the microphone and recording, recognition, reading aloud (the device's voices in Safari;
  Piper and Qwen3-TTS from the server) — in Safari and the PWA; layouts at phone width; what breaks is
  fixed here.
- **Accept**: a lesson with speaking and a review session done on each iPhone through Tailscale.

### 5. Moving and keeping one's data (owner, 2026-10-10)
Specs: 02, 05, 06, 09. Research: `docs/research/bundles-and-backups.md`.
- **Profile export/import** (first: the only data that cannot be fetched again): a file with the
  profile's database (made with `VACUUM INTO`, without secrets), its recordings and a manifest
  (format, app version, migration, the courses and content versions used, a hash per file).
- **Course and exam bundles**: a downloaded course or exam as one file to move to another machine —
  its library files, only the media it uses (stored as they are), a manifest with hashes (the series
  manifest of 02); importing checks every hash and skips media already there. The library stays
  unpacked on disk (served, normalised and backed up per file).
- **Backups**: what to keep and where — profiles, `server.sqlite` and `secret.key` (outside the data
  root: without it stored API keys cannot be read); the library can be fetched again, models and
  cache are disposable.
- Open questions for the owner: sharing bundles with other people or only one's own machines (the
  sources' terms); `raw/` in a bundle by default; pruning media no course uses (1.56 GB today, after
  checking what passes and cards name); file extensions; a profile import replacing a profile or
  always a new one; a `backup` command or a documented list; free space checked first (the disk was
  98 % full).
- **Accept**: a profile moved to a second data root and studied on; a course and an exam moved as
  bundles and verified.

### 6. A week of real use
- The owner's demo of cards, review and the Notebook on the Mac (open since 2026-10-07).
- The owner and his wife study with it for at least a week — on the Mac, and on phones once item
  "Phones" is done; their findings decide the order of "After the week of use".

### 8. Speaking practice with the AI (owner, 2026-10-11)
Specs: 04, 07, 08, 09.
- A section of AI practice for speaking, as scenes are held: the AI's lines read aloud (in the
  language learnt only, its voice), the learner answers by voice; the answer heard by the recogniser
  and judged by the model — was the line understood, does the answer fit it, is it said right (words,
  grammar), with what to say better; kept as runs, read back in the Notebook. Later the base of exams'
  speaking parts (Goethe Sprechen) held the same way.
- Texts read aloud only in one language, given explicitly: no reading of texts mixing languages (the
  tutor's replies are not read); no dictation where the task is writing (owner, 2026-10-11).
- **Accept**: a speaking practice held by voice end to end in a lesson, its verdicts shown and kept.

### 9. AI practice by the four skills (owner, 2026-10-11)
Specs: 04, 07, 08, 09.
- Every AI practice step reviewed together with the owner and brought to one standard by the skill it
  trains — reading, listening, writing, speaking — what each is today (explanations, the tutor,
  "Write it yourself", scenes, going over mistakes, word examples, exam conversations) and what it
  should become; voice only where the skill is listening or speaking, typing only where it is writing.
- **Accept**: the agreed list of practices per skill written into spec 04/07, then built step by step.

## Open items in built areas
Taken along when an item above touches the area, or on request.
- Library (02, 03): a key map for providers other than DW (keys stay when the source reorders), a
  series manifest with `contentVersion`, `normalise <series>` from `raw/` offline, `verify` checks for manifest hashes and
  rule ids; content updated while a run is active ends the run (05). A word the source leaves without
  a translation in one lesson takes the translation its lexeme has elsewhere in the same edition (DW:
  Persian A1 "alt", German A2 "der Spinat"; seen in the 2026-10-08 audit of all Nicos Weg editions).
  A course normalised by an older normaliser flagged for re-import: the provider's normaliser
  revision in the course data, read by `verify` and the course page (a library normalised before
  speaking items had `reference` still diffs a spoken answer against the question it answers).
- Server (05, 06): structured logs.
- Tutor section (07): no tools yet — what it knows is the summary of the courses; the lesson tutor's
  tools across every course of the chat's language (where a word is taught, what a lesson covers,
  the mistakes of one lesson) when a summary proves too little.
- Lesson (09): the lesson's review back, together with going over mistakes — one analysis across the
  exercises (answers, speech verdicts, writing, scenes, mistakes) (owner, 2026-10-08). The microphone
  beside the "Write it yourself" box, as in free answers, scenes and the tutor.
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
