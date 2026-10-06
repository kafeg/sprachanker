# 11 — Roadmap

Principle: a thin end-to-end skeleton first, then grow it. Every stage ends with something the owner can
run, a demo, and a review. The next stage starts only after acceptance.

## How to run a stage

1. **Plan** (before code): goals, modules touched, files, what is reused, risks, how acceptance is
   checked, and the details this spec leaves open for the stage (README "Level of detail"). If the stage
   looks larger than about three sessions, split it in the plan. The owner approves.
2. **Implement** in small commits to `main`, each with tests and `bun run check` green.
3. **Demo**: commands to run, what to look at, on Mac and (from stage 5) iPhone.
4. **Review checklist**: engineering principles (root CLAUDE.md) · boundaries · tests · spec and
   CLAUDE.md current · no third-party content · i18n keys complete.
5. **Stop and report — mandatory after every stage.** What was built, what was learned (facts that
   contradict or refine the spec), open problems, an honest assessment of direction and remaining scope,
   proposed spec/roadmap edits, the next-stage plan. Spec edits are applied after the owner agrees; then
   the next stage may start.

## MVP boundary

**MVP = what two people need for a week of real study**: courses installed from the interface, the
lesson player, cards and review, two profiles on Mac and phones, speech checks, Leben in Deutschland,
LLM via external providers — running as `sprachanker serve` with browser/PWA access. Our enrichment
(9a) moved after the MVP (2026-10-06): what to enrich is decided by that week of use. The desktop shell
and decks stay after the MVP (10, 12). Do not build post-MVP features early.

Built early at the owner's request: courses beyond Nicos Weg A1 `ru-de` (stage 11: eleven courses in
three language pairs) and the LLM features (stage 8).

**Order of the remaining MVP work** (agreed 2026-10-06): 5c courses from the interface → 6 cards,
review, Notebook → profiles (rest of 4) → 7 speech → 9b exams → MVP acceptance.

## Stages

Each stage carries a status: **built**, **partial** (with what is missing) or **not started**, as of the
current code.

### 0 — Skeleton
Specs: 10, root CLAUDE.md.
- Bun workspaces with the MVP modules (`schema`, `course-kit`, `engine`, `server`, `llm`, `apps/web`,
  `apps/cli`, `courses/_fixture`); strict TS; Biome; dependency-cruiser with the
  violation test; `bun test`; Playwright; GitHub Actions; CLAUDE.md path checker; i18n
  scaffold (en/ru/de).
- Spike: `bun build --compile` produces one `sprachanker` binary that serves the built web app and
  embedded assets (migrations, YAML) when run from another folder.
- **Accept**: CI green; the violation test proves the rules; `sprachanker serve` (compiled) and
  `bun run dev` serve a hello page in three languages.
- **Status: built.**

### 1 — Reconnaissance and schema
Specs: 01, 02, 03, research.
- DW reconnaissance as in 03; update `docs/research/`.
- `packages/schema` (catalog, manifest, course index, lesson, exam, locale, enrichment, rules registry,
  exercise types incl. `unknown`, keys), JSON Schema generation, fixture course `courses/_fixture`.
- **Accept**: the owner reviews research notes and schema; the provisional parts of 02/03 are confirmed
  or corrected.
- **Status: built.**

### 2 — Importer for Nicos Weg
Specs: 02, 03.
- `course-kit` + provider `courses/dw` (`dw-nicos-weg`) + key map + CLI `import`, `verify`, `normalise`.
- **Accept**: snapshot tests on synthetic fixtures; the owner imports A1 `ru-de` at home; key map
  created; a second run makes no requests; the report lists unknown types; archive → delete → restore →
  `verify` passes.
- **Status: partial.** Built: `course-kit`, `courses/dw`, CLI `import` (idempotent, reports unknown
  exercises and failed media). `verify` (schemas, references, locale coverage, media). Missing: key map, manifest, `normalise` command.

### 3 — Engine core
Specs: 04.
- Compose (canonical + locale, selfrate upgrade), German text normalisation, checkers for all closed
  types, FSRS wrapper and card creation rules.
- **Accept**: table-driven tests per type; every imported A1 lesson composes or reports `unknown` types.
- **Status: partial.** Built: checkers for all closed types plus `dictation`, `speech_repeat` and the
  rubric part of `respond`; German text normalisation and word diff; lesson progress. Missing:
  compose (selfrate upgrade), FSRS wrapper, card creation rules.

### 4 — Server and storage
Specs: 05, 06.
- Data root, both databases, migrations with backups, runs/events with the lifecycle rules,
  profiles/PIN/devices, owner setup link, lesson and run API, media with Range, jobs with SSE, security
  basics.
- **Accept**: integration and migration tests; a run survives restart and continues on a second device
  with events from both stored; statistics recomputed from events match after restart; Host check,
  CSRF header and PIN rate limit covered by tests.
- **Status: partial.** Built: data root, `profile.sqlite` with migrations, backups and downgrade
  protection, runs/events with server-side outcomes, lesson and run API, media with Range, CSRF
  header, sealed API keys, course sync as a background job (polled), resetting the progress of a course
  or lesson. Missing: `server.sqlite`, profiles/PIN/devices, owner setup link, Host check.

### 5 — Lesson UI
Specs: 09, 06.
- 5a: clickable prototype and design tokens → owner approves.
- 5b: first run via the owner setup link, course install with progress, profiles in the PWA, course
  map, lesson player with all closed renderers and video, word sheet, summary, resume, i18n (Russian
  and German drafted with an LLM and reviewed), light/dark. Speech and LLM types render in a basic mode
  (listen, reveal the reference) until stages 7–8.
- Phone access via `tailscale serve`.
- **Accept**: Playwright "complete lesson 1" (desktop and phone viewport); the owner completes three
  lessons on Mac and iPhone, including a resume on the other device.
- **Status: partial.** Built: course list, course map, lesson player with the closed renderers, video
  and audio player, reference tabs, summary, resume, i18n en/ru/de, light/dark, PWA manifest and icons;
  My courses / All courses with language flags, course page (stats, integrity, sync, reset), exercise
  marks and lesson completion rules; Playwright tests on desktop and phone. Missing: first run via the
  owner setup link, profiles in the PWA, word sheet; installing courses moved to 5c.

### 5c — Courses from the interface
Specs: 03, 06, 09.
Scenario: someone installs the app, starts it, opens "All courses", presses "Download" and studies
the first lessons a few minutes later while the media keep coming.
- Every course a provider offers is listed — installed or not — from the providers' own catalogs
  (built into the app; nothing is hosted by us: content comes from the source sites to the learner's
  machine, politely, as in 03), with its language pair, source, licence and approximate size.
- Course states on cards and the course page: not downloaded (size) · downloading (pages, files,
  bytes, %) · incomplete (files missing) · ready. "Download" / "Continue downloading" / "Sync".
- Download as a background job: one at a time in a queue, progress reported by the importers,
  resumed after a restart (imports are idempotent). The course becomes playable once its pages are
  normalised (a first normalise without media), then normalised again when the media are in.
- Settings → Storage: the data folder (chosen at start: `--data`, `SPRACHANKER_DATA`, default
  app-data) and the space each course takes. Changing the folder is the desktop app's job (12).
- **Accept**: from an empty data root, Deutsch im Blick is downloaded from the UI, its first lesson
  opens before the media finish, a server restart mid-download resumes it; e2e against a fake
  provider; progress and states visible on desktop and phone.
- **Status: not started.**

### 6 — Cards, review, Notebook
Specs: 04, 05, 09.
- Cards from new words, Review with FSRS and beginner-friendly limits, Notebook (runs, run detail with
  snapshots, item history), lesson redo with comparison, study days.
- **Accept**: after lesson 1 its words are due in Review; reviews update due dates per face; the
  Notebook shows two runs of lesson 1 side by side.
- **Status: not started.**

### 7 — Speech
Specs: 08, 06.
- whisper-server and TTS sidecars with supervision, client capture → WAV, `speech_repeat`,
  push-to-talk, TTS.
- **Accept**: latency target (08) met on the owner's Mac with his own phrases; recordings replayable in
  the Notebook; speech disabled with a clear message on plain HTTP.
- **Status: not started.**

### 8 — LLM
Specs: 07.
- Gateway, providers (LM Studio, OpenRouter, any OpenAI-compatible server) with one model per profile,
  structured outputs, prompt viewer; tasks `explain_mistake`, `chat_turn` (lesson tutor with tools),
  `check_writing`, `review_session`, `scene_setup` + `scene_turn` (07).
- **Accept**: the AI screens pass e2e against the fake OpenAI-compatible server; the owner uses them
  with a local (LM Studio) and a cloud model.
- **Status: built** (early, at the owner's request). `check_answer` for `respond`, `translate_mt`,
  per-task routes, handoff and golden tests moved to Later (13).

### 9a — Enrichment and rule-based features (after the MVP)
Specs: 02, 04, 07.
- `enrich check`, rules registry content for A1, A1 enrichment chapter by chapter (rule tags,
  contrastive notes, speaking, scenes) authored with Claude Code from the local library; A1 writing and
  speaking tasks of the Goethe A1 kind covered by `respond` and scenes.
- Mistakes by rule, rule mastery, weak spots on Today, "Practise this", can-do list.
- **Accept**: A1 units 0–2 enriched and reviewed by the owner; `enrich check` clean; a practice set from
  du/Sie mistakes (seeded or real) runs end to end.
- **Status: not started** (a starter rules registry exists; mistakes are listed per item, not yet by
  rule).

### 9b — Exams
Specs: 02, 03, 06, 09.
- Exam player and Exams screen; `bamf-lid` (pools, state filter, timer, practice of wrong answers).
- **Accept**: a LiD timed exam with Berlin questions works end to end; results in the Notebook.
- **Status: not started.**
- **MVP acceptance**: the owner and his wife use the MVP for at least one week of real study on phones
  and Mac; their findings decide the order of post-MVP work.

---

**After MVP**

### 10 — Decks and word images
`packages/anki-export` (`.apkg` export and import, stored decks), word images (04).
**Accept**: an exported A1 deck opens in Anki with audio; an imported deck links matching words.
**Status: not started.**

### 11 — Second sources and editions
More sources and language pairs, each pair a course of its own (01): Nicos Weg `en-de`,
`coerll-dib` interviews, English courses for Russian speakers, `sa-starter-en`.
**Accept**: one Deutsch im Blick chapter playable in an English profile; an English course lesson
playable in a Russian profile.
**Status: partial** (built early). Built: Nicos Weg A1/A2 for Russian and English speakers, B1,
Deutschtrainer, Deutsch im Blick vocabulary, Lingust, VOA «Так говорят в Америке», VOA Let's Learn
English. Missing: B1 glossary, Deutsch im Blick interviews, Starter English.

### 12 — Desktop app
Tauri shell, first-run wizard (incl. LM Studio setup), network options with QR, signed
bundles for macOS then Windows and Linux, auto-update.
**Accept**: fresh machine → install → onboarding → lesson 1 in < 30 minutes (without course download);
headless `serve` works on a second machine.
**Status: not started.**

### 13 — Later
Missions, unit reviews, in-lesson adaptivity, LLM verdicts for `respond` (`check_answer`), per-task LLM routes, handoff to other assistants, LLM golden tests,
Goethe A1 practice sets with LLM-scored writing/speaking, FSRS for Leben in Deutschland, badges,
built-in local CA for LAN HTTPS, Qwen3-TTS and cloud speech, offline downloads and push notifications, reader for books and texts, more
DW courses, `.apkg` with scheduling, FSRS parameter optimisation, Docker image,
project website (`kafeg.github.io/sprachanker`), native mobile via Tauri.
