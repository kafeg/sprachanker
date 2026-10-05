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

**MVP = stages 0–9b**: Nicos Weg **A1 `ru-de`**, Leben in Deutschland, lesson player, Notebook, cards,
speech checks, LLM via external providers, our A1 enrichment — running as `sprachanker serve` with
browser/PWA access. Formats keep multiple editions, other sources and the desktop shell possible, but
they are built after the MVP (stages 10–12). Do not build post-MVP features early.

## Stages

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

### 1 — Reconnaissance and schema
Specs: 01, 02, 03, research.
- DW reconnaissance as in 03; update `docs/research/`.
- `packages/schema` (catalog, manifest, course index, lesson, exam, locale, enrichment, rules registry,
  exercise types incl. `unknown`, keys), JSON Schema generation, fixture course `courses/_fixture`.
- **Accept**: the owner reviews research notes and schema; the provisional parts of 02/03 are confirmed
  or corrected.

### 2 — Importer for Nicos Weg
Specs: 02, 03.
- `course-kit` + `dw-nicos-weg` provider + key map + CLI `import`, `verify`, `normalise`.
- **Accept**: snapshot tests on synthetic fixtures; the owner imports A1 `ru-de` at home; key map
  created; a second run makes no requests; the report lists unknown types; archive → delete → restore →
  `verify` passes.

### 3 — Engine core
Specs: 04.
- Compose (canonical + locale, selfrate upgrade), German text normalisation, checkers for all closed
  types, FSRS wrapper and card creation rules.
- **Accept**: table-driven tests per type; every imported A1 lesson composes or reports `unknown` types.

### 4 — Server and storage
Specs: 05, 06.
- Data root, both databases, migrations with backups, runs/events with the lifecycle rules,
  profiles/PIN/devices, owner setup link, lesson and run API, media with Range, jobs with SSE, security
  basics.
- **Accept**: integration and migration tests; a run survives restart and continues on a second device
  with events from both stored; statistics recomputed from events match after restart; Host check,
  CSRF header and PIN rate limit covered by tests.

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

### 6 — Cards, review, Notebook
Specs: 04, 05, 09.
- Cards from new words, Review with FSRS and beginner-friendly limits, Notebook (runs, run detail with
  snapshots, item history), lesson redo with comparison, study days.
- **Accept**: after lesson 1 its words are due in Review; reviews update due dates per face; the
  Notebook shows two runs of lesson 1 side by side.

### 7 — Speech
Specs: 08, 06.
- whisper-server and TTS sidecars with supervision, client capture → WAV, `speech_repeat`,
  push-to-talk, TTS.
- **Accept**: latency target (08) met on the owner's Mac with his own phrases; recordings replayable in
  the Notebook; speech disabled with a clear message on plain HTTP.

### 8 — LLM
Specs: 07.
- Gateway, providers, per-profile routes, tasks (`check_answer`, `scene_turn`, `chat_turn`,
  `translate_mt`), types `respond` and `scene`, handoff, golden tests.
- **Accept**: golden results recorded for at least one local and one cloud model; defaults chosen from
  them; a fixture scene runs end to end with corrections in the error log.

### 9a — Enrichment and rule-based features
Specs: 02, 04, 07.
- `enrich check`, rules registry content for A1, A1 enrichment chapter by chapter (rule tags,
  contrastive notes, speaking, scenes) authored with Claude Code from the local library; A1 writing and
  speaking tasks of the Goethe A1 kind covered by `respond` and scenes.
- Mistakes by rule, rule mastery, weak spots on Today, "Practise this", can-do list.
- **Accept**: A1 units 0–2 enriched and reviewed by the owner; `enrich check` clean; a practice set from
  du/Sie mistakes (seeded or real) runs end to end.

### 9b — Exams
Specs: 02, 03, 06, 09.
- Exam player and Exams screen; `bamf-lid` (pools, state filter, timer, practice of wrong answers,
  machine-translated questions).
- **Accept**: a LiD timed exam with Berlin questions works end to end; results in the Notebook.
- **MVP acceptance**: the owner and his wife use the MVP for at least one week of real study on phones
  and Mac; their findings decide the order of post-MVP work.

---

**After MVP**

### 10 — Decks and word images
`packages/anki-export` (`.apkg` export and import, stored decks), word images (04).
**Accept**: an exported A1 deck opens in Anki with audio; an imported deck links matching words.

### 11 — Second sources and editions
Nicos Weg `en-de` with edition alignment, `coerll-dib`, `sa-starter-en`.
**Accept**: adding `en-de` to an installed A1 downloads only texts and keeps progress; one Deutsch im
Blick chapter playable in an English profile; Starter English lesson 1 playable in a Russian profile.

### 12 — Desktop app and built-in LLM runtime
Tauri shell, first-run wizard, Models screen with `llama-server`, network options with QR, signed
bundles for macOS then Windows and Linux, auto-update.
**Accept**: fresh machine → install → onboarding → lesson 1 in < 30 minutes (without course download);
headless `serve` works on a second machine.

### 13 — Later
Missions, unit reviews, in-lesson adaptivity, chat tools, session reviews, Goethe A1 practice sets with
LLM-scored writing/speaking, FSRS for Leben in Deutschland, badges, built-in local CA for LAN HTTPS,
Qwen3-TTS and cloud speech, offline downloads and push notifications, reader for books and texts, more
DW courses, `.apkg` with scheduling, FSRS parameter optimisation, built-in MLX runtime, Docker image,
project website (`kafeg.github.io/sprachanker`), native mobile via Tauri.
