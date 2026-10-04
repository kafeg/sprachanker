# 11 — Roadmap

Principle: a thin end-to-end skeleton first, then grow it. Every stage ends with something the owner can
run, a demo, and a review. The next stage starts only after acceptance.

## How to run a stage (process)

1. **Plan** (in the session, before code): goals, modules touched, files to create, what existing code is
   reused, risks, how acceptance will be checked. Owner approves.
2. **Implement** in small PRs, each with tests and `bun run check` green.
3. **Demo**: commands to run, what to look at, on Mac and (from stage 5) iPhone.
4. **Review checklist**: engineering principles (root CLAUDE.md: KISS, no extra entities, reuse, right
   place) · boundaries respected · tests present · spec and CLAUDE.md files current · no third-party
   content committed · i18n keys complete.
5. **Sweep** CLAUDE.md files.
6. **Stop and consult — mandatory after every stage.** Do not start the next stage on your own. Report to
   the owner: what was built, what was learned (facts that contradict or refine the spec), open problems,
   and an honest assessment: are we going the right way, is the remaining plan still right-sized, should
   anything be cut, moved, or redesigned? Propose concrete edits to `docs/spec/*` (including this roadmap)
   and the plan for the next stage. Apply spec edits only after the owner agrees; then the next stage may
   start.

Stage prompt template for Claude Code:

```
Read CLAUDE.md and docs/spec/README.md, then the spec files listed for stage <N> in docs/spec/11-roadmap.md.
Propose a plan for stage <N> (goals, modules, files, reuse, tests, acceptance checks) and wait for my approval.
After approval implement it in small steps, keep `bun run check` green, update spec/CLAUDE.md where
structure changes. At the acceptance criteria stop: give the demo script, the review checklist, and the
stage report (what we learned, are we on the right track, proposed spec/roadmap changes, next-stage plan).
Do not start the next stage until I confirm.
```

## Kickoff — independent spec review (before stage 0)

Before any code, a fresh session reviews the whole specification and fixes it. Prompt:

```
You are starting the SprachAnker project. Do not write code yet.

1. Read CLAUDE.md, every file in docs/spec/ and docs/research/, and every module CLAUDE.md. Build your own
   understanding from scratch; do not assume the spec is correct.
2. Review it from these angles and report findings:
   a. Consistency: terms, keys, formats, module boundaries, API vs data model vs UI; contradictions between files.
   b. End-to-end scenarios (00): trace each through UI → API → engine → storage → library; list missing
      endpoints, fields, states, or undefined behaviour.
   c. Failure modes and edge cases not covered by 05/06.
   d. Security and privacy gaps against the threat model in 06.
   e. Ambiguity for implementers: places where two reasonable implementations would differ; unmeasurable
      acceptance criteria; stages too large for 1–3 sessions.
   f. Over-engineering (judge against the engineering principles in the root CLAUDE.md): anything that could move to "later" without hurting the two primary users. Be
      aggressive: propose cuts to MVP scope, fields, states and rules that the MVP does not need, and
      flag places where the spec decides details that should wait for stage 1 reconnaissance.
   g. Distribution: macOS code signing and notarization (Developer ID) vs ad-hoc signing for personal use,
      Windows SmartScreen, auto-update, backup of the data root.
   h. Pedagogy: does lesson flow + speaking + SRS cover what a learner needs for CEFR A1 (incl. Goethe A1
      writing and speaking tasks)? Are FSRS defaults and daily limits sensible for a beginner?
   i. Licences: attribution UI per licence; CC BY-SA (Wiktionary) and CC BY-NC-SA (ARASAAC) implications for
      an MIT app that fetches at runtime; DW robots.txt and terms as actually published; BAMF catalogue use.
   j. Phone UX: one-handed push-to-talk, empty/error states, a second user onboarding from her phone alone.
   k. Performance and resources: event/recording growth, video over Tailscale, memory with whisper + LLM +
      app on a 32 GB Mac, cold starts.
3. Output a findings list grouped by severity (blocker / important / minor), each with the file, the problem,
   and a concrete proposed edit. Wait for my decisions.
4. After approval apply the edits to docs/spec and CLAUDE.md files in one PR, re-check consistency, then
   propose the plan for stage 0 and wait for my approval.
```

## Stages

## MVP boundary

**MVP = stages 0–9b** (0–8 platform, 9a enrichment, 9b exams): Nicos Weg **A1, edition `ru-de` only**, Leben in Deutschland, lesson player, Notebook,
cards, speech checks, LLM via external providers (LM Studio, Ollama, cloud), our enrichment for A1 —
running as `sprachanker serve` with browser/PWA access. The design keeps multiple editions, other sources
and the desktop shell possible (keys, key map, editions in formats), but they are implemented after the
MVP (stages 10–12). Do not build post-MVP features early.


### 0 — Skeleton
Specs: 10, root CLAUDE.md.
- Bun workspaces with the MVP modules only (`schema`, `course-kit`, `engine`, `server`, `llm`, `speech`,
  `ui-kit`, `apps/web`, `apps/cli`, `courses/_fixture`); `anki-export`, `apps/desktop`, `native/` are
  created in their stages. Strict TS; Biome; dependency-cruiser rules; `bun test`; Playwright; GitHub
  Actions CI; PR template; CLAUDE.md path checker; i18n scaffold (en/ru/de).
- **Accept**: CI green; a deliberate boundary violation fails CI; `bun run dev` serves a hello page in
  three languages.

### 1 — Reconnaissance and schema
Specs: 01, 02, 03, research.
- DW: A1 `ru-de` thoroughly (≥ 6 lessons across the level + final test); one lesson each of A1 `en-de`,
  A2 and B1 and one Deutsch im Blick chapter — only to check the schema is not too narrow. Catalogue
  exercise and page kinds; update `docs/research/`.
- `packages/schema` (catalog, manifest, course index, lesson, exam, locale, enrichment, rules registry,
  exercise types incl. `unknown`), JSON Schema generation, fixture course `courses/_fixture`.
- **Accept**: owner reviews research notes and schema; the provisional tables in 02/03 are confirmed or
  corrected.

### 2 — Importer for Nicos Weg
Specs: 02, 03.
- `course-kit` (polite fetcher, blob store, manifest, verify, sanitiser) + `dw-nicos-weg` provider + key map
  + CLI `import`, `verify`, `normalise`.
- **Accept**: snapshot tests on synthetic fixtures; owner imports A1 `ru-de` at home; key map created;
  second run downloads nothing; report lists unknown types; archive → delete → restore → `verify` passes.

### 3 — Engine core
Specs: 04.
- Compose (canonical + locale, selfrate upgrade), text normalisation for German, checkers for all closed
  types, FSRS wrapper and card-creation rules. (Rule-based adaptivity and mastery come in 9a, when rule
  tags exist.)
- **Accept**: table-driven tests per type; composing every imported A1 lesson succeeds or reports
  `unknown` types.

### 4 — Server and storage
Specs: 05, 06.
- Data root, `server.sqlite`, `profile.sqlite`, migrations with backups, runs/events with lifecycle and
  concurrency rules (05), profiles/PIN/devices, API for lessons and runs, media with Range, jobs with SSE,
  security and failure handling (06), owner setup link.
- **Accept**: integration and migration tests; a run with events survives restart; rebuild reproduces
  derived tables; second-device take-over returns 409 to the old device; CSRF header and PIN rate limit
  covered by tests.

### 5 — Lesson UI
Specs: 09, 06.
- 5a: clickable prototype of Today, Lesson player, Review, Notebook (light/dark, desktop/phone) and design
  tokens → owner approves.
- 5b: minimal first run in the web app via the owner setup link (06): owner profile, course install with
  progress; profiles in the
  PWA, course map, lesson player with all closed renderers and video, word sheet, summary, resume, i18n
  (English source strings; Russian and German drafted with an LLM and reviewed — Russian by the owner),
  light/dark.
- Speech and LLM exercise types render in a basic mode until stages 7–8 (listen, then reveal the
  reference; no checking).
- Phone access: server `--listen` on LAN/tailnet + manual `tailscale serve` for HTTPS (integrated HTTPS
  options and QR pairing come with the desktop app, stage 12).
- **Accept**: Playwright "complete lesson 1" (desktop and phone viewport); owner completes three lessons
  on Mac and iPhone, including a resume on the other device.

### 6 — Cards, review, Notebook
Specs: 04, 05, 09.
- Cards from new words, Review screen with FSRS (session limits), Notebook (runs per lesson, run detail
  with answers and snapshots, item history), lesson redo with comparison, study days.
- **Accept**: after lesson 1, its words are due in Review; reviews update due dates per face; the
  Notebook shows two runs of lesson 1 with differing answers side by side.

### 7 — Speech
Specs: 08, 06.
- `native/whisper`, `native/piper`, sidecar supervision, client capture → WAV, `speech_repeat`, PTT
  buttons, TTS (used by stage 8 and our content).
- **Accept**: latency target met on the owner's Mac with his own phrases; recordings replayable in the
  Notebook; speech disabled with a clear message on plain HTTP.

### 8 — LLM
Specs: 07.
- Gateway, external providers (LM Studio, Ollama, OpenRouter, OpenAI, Anthropic, remote URL), task routes
  and fallbacks, tasks `check_answer`, `write_check`, `scene_turn`, `explain`, `chat_turn` with tools,
  `session_review`; exercise types `respond`, `translate`, `write`, `scene`; handoff; golden tests.
- **Accept**: golden results recorded for at least one local and one cloud model; defaults chosen from
  them; a scene runs end-to-end with corrections in the error log.

### 9a — Enrichment tooling and Nicos Weg A1 enrichment
Specs: 02, 04, 07.
- `enrich draft/check`, rules registry content for A1, enrichment of A1 chapter by chapter (contrastive
  notes, rule tags, speaking, scenes, missions, unit reviews).
- Rule-based learner features that need rule tags: mistakes by rule, rule mastery charts, adaptivity,
  "Practise this", can-do list.
- **Accept**: A1 units 0–2 fully enriched and reviewed by the owner; `enrich check` clean; a practice set
  built from one week's du/Sie mistakes runs end to end.

### 9b — Exams
Specs: 02, 03, 06, 09.
- Exam player and Exams screen; Nicos Weg final tests; `bamf-lid` (pools, state filter, timer,
  practice of wrongly answered questions as practice runs, machine-translated questions).
- **Accept**: LiD timed exam with Berlin questions works end to end; results in the Notebook.
- **MVP acceptance**: the owner and his wife use the MVP for at least one week of real study on phones and
  Mac; their findings go into the stage report and decide the order of post-MVP work.


---

**After MVP**

### 10 — Decks and word images
Specs: 04, 05, 09.
- `packages/anki-export`: `.apkg` export (lesson, course, mine) and import (field mapping, lexeme linking);
  word images (ARASAAC, OpenMoji, course images; pick + batch suggestion).
- **Accept**: an exported A1 deck opens in Anki with audio; an imported AnkiWeb deck links matching words.

### 11 — Second sources and editions
Specs: 02, 03.
- English edition of Nicos Weg (`en-de`) with edition alignment (keys via key map, fingerprints), `coerll-dib`
  provider (Deutsch im Blick), `sa-starter-en` course (ru → en).
- **Accept**: adding `en-de` to an installed A1 downloads only texts and keeps progress; one Deutsch im Blick chapter playable in an English profile; Starter English lesson 1
  playable in a Russian profile.

### 12 — Desktop app and built-in LLM runtime
Specs: 06, 08, 07.
- For public releases; the owner uses `sprachanker serve` + browser + `tailscale serve` until then.
- Tauri shell, server sidecar, tray, first-run, onboarding wizard, Models screen with built-in
  `llama-server`, network & HTTPS options with QR, bundles for macOS (arm64) then Windows and Linux,
  auto-update.
- **Accept**: fresh machine → install → onboarding → lesson 1 in < 30 minutes; headless `serve` works on
  a second machine.

### 13 — Later
Goethe A1 practice sets with LLM-scored writing/speaking, spaced repetition (FSRS) for Leben in
Deutschland questions, badges and a switch to hide motivation features, built-in local CA for LAN HTTPS,
Qwen3-TTS and cloud speech, more image sources, offline downloads for phones, push notifications,
reader (books/texts), more DW courses, `.apkg` with
scheduling, FSRS parameter optimisation, built-in MLX runtime, Docker image, GitHub Pages website and
release pages, native mobile via Tauri.
