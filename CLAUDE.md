# SprachAnker — working guide for agents

SprachAnker is a self-hosted, local-first language-learning app. `sprachanker serve` runs a local
server with the web UI, used in the browser (a desktop window and phones are planned). Real courses are
installed by importers into a local library and practised with spaced repetition, speech checks and
any LLM the user connects.

Read before working: `docs/architecture.md` (how the parts fit), `docs/spec/README.md` (index), then
the spec file for the area you touch. `docs/plan.md` lists work not yet built.
The spec is the source of truth for *what* and *why*. CLAUDE.md files only say *how to work here*.

## Repository map

| Path | Responsibility | Spec | Local guide |
|---|---|---|---|
| `packages/schema` | Domain types and file formats (zod → JSON Schema). Depends on nothing. | 01, 02 | `packages/schema/CLAUDE.md` |
| `packages/course-kit` | Library format (read/write), fetcher, raw pages, media store, fingerprints, verify. | 02, 03 | `courses/CLAUDE.md` |
| `courses/<provider>` | One folder per content source: provider (importer + normaliser), tests; enrichment planned. `courses/_shared/rules` — grammar rules registry (read by the app: planned). | 02, 03 | `courses/CLAUDE.md` |
| `packages/engine` | Pure logic: lesson composition, exercise checking, learner model, FSRS. No I/O. | 04 | `packages/engine/CLAUDE.md` |
| `packages/server` | HTTP API, SQLite, media, profiles, course downloads, sidecar supervision, speech recognition and reading aloud. | 05, 06, 08 | `packages/server/CLAUDE.md` |
| `packages/llm` | LLM gateway, providers, tasks, prompts, structured outputs. | 07 | `packages/llm/CLAUDE.md` |
| `packages/anki-export` | `.apkg` packages: reading one (notes, fields, media) and its notes as a deck's words; export planned. | 04 | `packages/anki-export/CLAUDE.md` |
| `apps/web` | React UI for desktop and phone screens (installable PWA), components and exercise renderers. i18n: a catalog per language (`src/i18n/<code>.json`), right to left for Arabic and Persian. | 09 | `apps/web/CLAUDE.md` |
| `apps/desktop` | Tauri 2 shell (planned): window, tray, starts the server binary, updates. | 06 | `apps/desktop/CLAUDE.md` |
| `apps/cli` | The `sprachanker` binary: `serve` (starts the server), `import`, `verify`, `profiles`. Compiled with the web build embedded. | 03, 06 | `apps/cli/CLAUDE.md` |
| `native` | Builds of whisper.cpp (`whisper-server`), sherpa-onnx (`sherpa-onnx-offline-tts`, Piper voices) and qwentts.cpp (`tts-server`, Qwen3-TTS). | 08 | `native/CLAUDE.md` |
| `e2e` | Playwright end-to-end tests against the compiled binary. | 10 | — |
| `scripts` | Repository checks run by `bun test`: boundary rules test, CLAUDE.md paths. | 10 | — |
| `docs` | `spec/` — specification; `plan.md` — remaining work; `architecture.md` — overview; `research/` — facts gathered about sources. | — | — |

## Dependency rules (enforced by dependency-cruiser in CI)

Encoded in `.dependency-cruiser.cjs`; `scripts/boundaries.test.ts` proves them on deliberate violations.

- `schema` → nothing. `engine` → `schema` only. `course-kit` → `schema` (its tests too: never a course).
- `courses/*` → `schema`, `course-kit` only. Never `server`, `engine`.
- `llm` → `schema`. It never imports `server`.
- `anki-export` → `schema`, runtime-free (no Node/Bun built-ins: SQLite and zstd are passed in).
- `server` → `schema`, `engine`, `course-kit`, `courses/*`, `llm`, `anki-export`.
- `apps/web` → `schema`, `engine` (client-side checking), and a **type-only** import of the server's
  `AppType` for the Hono RPC client.
- `apps/desktop` knows only the `sprachanker` binary and its CLI flags. `apps/cli` → `server` (and through it everything else).
- Nothing imports from `apps/*`. No cycles.

## Stack

TypeScript (strict) everywhere · Bun (runtime, workspaces, `bun test`) · Hono · Drizzle + `bun:sqlite` ·
zod · React + Vite + Tailwind + shadcn/ui (Radix) + TanStack Router/Query · Tauri 2 · Biome · Playwright ·
dependency-cruiser. Native: whisper.cpp, Piper (sherpa-onnx), Qwen3-TTS (qwentts.cpp); local LLMs via LM Studio. Keep server code runtime-agnostic (Node fallback).
All library choices are fixed in `docs/spec/10-quality.md` ("Fixed technical choices"); do not add
alternatives without updating that table.

## Engineering principles

- **KISS as a default, not a dogma.** Build what the current item needs; no abstraction, option, layer,
  table or entity "for later" unless the spec requires it. But when a slightly bigger design now clearly
  avoids rework (stable keys, event log, module boundaries, data formats), choose it and say why —
  the goal is a coherent, maintainable system, not the smallest diff.
- **No new entities beyond necessity.** Before adding a type, table, module, service or config key, check
  whether an existing one already covers it; extend it instead of adding a parallel one.
- **Reuse before writing.** Use existing code in the repo and the fixed libraries (10) before writing your
  own; no duplicated logic — extract a shared function when the second copy would appear.
- **Right place, not nearest place.** Every change goes into the module that owns that responsibility
  (repository map above), respecting dependency rules — even when a shortcut elsewhere would be faster.
- **Think before changing.** For any non-trivial change: state which modules it touches, how it fits the
  existing design, and what it replaces; prefer the change that keeps the architecture coherent over the
  one that is quickest to type. Simple ≠ hacky.
- **Small, cohesive units.** Clear interfaces between modules and components; one responsibility per
  module, file and component; no god objects.

## Rules

1. Spec first. If the code needs to diverge from the spec, update the spec in the same commit and say why.
   The spec fixes only decisions that are expensive to change (`docs/spec/README.md`).
2. A new exercise type = schema + checker (engine) + renderer (`apps/web`) + tests. Never only one of them.
3. Schema changes that touch stored data require a migration (05) and a migration test.
4. Never commit third-party course content (texts, media, raw snapshots), not even in fixtures.
   Test fixtures are synthetic. Repo contains importers, manifests of URLs, and our own enrichment only.
5. User data never leaves the machine except calls to providers the user configured.
6. UI strings go through i18n (a catalog per language, English the fallback). No hard-coded user-facing text.
7. Small commits straight to `main`. Each: tests, `bun run check` green, docs updated if structure changed.

## CLAUDE.md hygiene

- Describe the current state only. No logs, no history, no "we did X".
- Keep each file ≤ 150 lines. Link to the spec instead of repeating it.
- When you change structure or contracts of an area, update its CLAUDE.md in the same commit.
- CI checks that what CLAUDE.md files name exists — backticked repository paths and every entry of a
  `## Layout` tree; what is not built yet goes in a `## Planned` list (10).

## Commands

- `bun install` · `bun run check` (typecheck + lint + boundaries + tests) · `bun run format`
- `bun run dev` — server on 127.0.0.1:4580 + Vite (proxies `/api`); open the URL Vite prints
- `bun run build:cli` — the app: the speech engines (`build:speech`), the web build and the binary
  (`dist/sprachanker` in `apps/cli`, the engines beside it) · `bun run build:bin` — web build + binary only
  (the engines already built copied beside it) · `bun run e2e` (`build:bin` first; Chromium desktop +
  WebKit phone, ≈1.5 min) · `bun run e2e:all` (all four, as CI)
- `bun run e2e:real` — run-throughs on real courses at phone width (a clone of `~/SprachAnker/library`;
  `REAL=<key prefix>`, `REAL_PER_COURSE=<n|all>`, `REAL_DESKTOP=1`, `REAL_UI=ru`, `REAL_SHOTS=<dir>`); the Mac only, not in CI
- A whole course checked end to end: the course-check skill (`.claude/skills/course-check/SKILL.md`)
- `bun run practice:texts` — the text generator's work made in bulk by a real model, to read
  (`TEXTS_STEPS`: reading, listening, writing, speaking; `TEXTS_LESSONS`, `TEXTS_EACH`, `TEXTS_MODEL`;
  report.md in `TEXTS_OUT`); the Mac only, not in CI
- `bun run speech:check` — speech round-trip: the corpus read by Qwen3-TTS, heard by Whisper (the Mac,
  models in `~/SprachAnker/models`) · `bun run speech:levels` — short answers at four levels and noise
  through the app: the table the silence thresholds are set by (again on a whisper.cpp update)
- `bun run build:speech` — builds whisper-server, sherpa-onnx-offline-tts (Piper) and tts-server (Qwen3-TTS)
  for this machine (native/, needs cmake; seconds once built); part of build:cli
- `bun run cli -- <command>` — the CLI from sources (`serve` uses the last `bun run build:web` output)
- `bun run cli -- import dw-nicos-weg --data ~/SprachAnker` · `bun run cli -- serve --data ~/SprachAnker`
- `bun run cli -- verify --data ~/SprachAnker` — checks every installed course (run after an import)
- `bun run build:desktop` (planned)
