# SprachAnker — working guide for agents

SprachAnker is a self-hosted, local-first language-learning app. A desktop app (Tauri 2) runs a local
server; the same web UI is used in the desktop window and as a PWA on phones. Real courses are installed
by importers into a local library, enriched with our own layer, and practised with spaced repetition,
speech checks and any LLM the user connects.

Read before working: `docs/spec/README.md` (index), then the spec file for the area you touch.
The spec is the source of truth for *what* and *why*. CLAUDE.md files only say *how to work here*.

## Repository map

| Path | Responsibility | Spec | Local guide |
|---|---|---|---|
| `packages/schema` | Domain types and file formats (zod → JSON Schema). Depends on nothing. | 01, 02 | `packages/schema/CLAUDE.md` |
| `packages/course-kit` | Library format (read/write), polite fetcher, blob store, manifest, fingerprints, verify. | 02, 03 | `courses/CLAUDE.md` |
| `courses/<provider>` | One folder per content source: provider (importer + normaliser), enrichment, tests. `courses/_shared/rules` — grammar rules registry (created in stage 1). | 02, 03 | `courses/CLAUDE.md` |
| `packages/engine` | Pure logic: lesson composition, exercise checking, learner model, FSRS. No I/O. | 04 | `packages/engine/CLAUDE.md` |
| `packages/server` | HTTP API, SQLite, media, profiles, jobs, sidecar supervision, speech (STT/TTS clients). | 05, 06, 08 | `packages/server/CLAUDE.md` |
| `packages/llm` | LLM gateway, providers, task routing, prompts, golden tests. | 07 | `packages/llm/CLAUDE.md` |
| `packages/anki-export` | `.apkg` import/export (created in stage 10). | 04 | `packages/engine/CLAUDE.md` |
| `apps/web` | React UI: desktop window and phone PWA, components and exercise renderers. i18n en/ru/de. | 09 | `apps/web/CLAUDE.md` |
| `apps/desktop` | Tauri 2 shell: window, tray, starts the server sidecar, updates. | 06 | `apps/desktop/CLAUDE.md` |
| `apps/cli` | The `sprachanker` binary: `serve` (starts the server) + import, verify, export, enrichment check. Compiled with `bun build --compile`; the desktop app bundles it. | 03, 06 | `courses/CLAUDE.md` |
| `native` | Builds of whisper.cpp, llama.cpp, Piper for each platform. | 08, 07 | `native/CLAUDE.md` |
| `e2e` | Playwright end-to-end tests. | 10 | — |
| `docs/spec` | Specification. `docs/research` — facts gathered about sources. | — | — |

## Dependency rules (enforced by dependency-cruiser in CI)

- `schema` → nothing. `engine` → `schema` only. `course-kit` → `schema`.
- `courses/*` → `schema`, `course-kit` only. Never `server`, `engine`.
- `llm` → `schema`. It never imports `server`.
- `server` → `schema`, `engine`, `course-kit`, `courses/*`, `llm`, `anki-export`.
- `apps/web` → `schema`, `engine` (client-side checking), and a **type-only** import of the server's
  `AppType` for the Hono RPC client.
- `apps/desktop` knows only the `sprachanker` binary and its CLI flags. `apps/cli` → `server` (and through it everything else).
- Nothing imports from `apps/*`. No cycles.

## Stack

TypeScript (strict) everywhere · Bun (runtime, workspaces, `bun test`) · Hono · Drizzle + `bun:sqlite` ·
zod · React + Vite + Tailwind + shadcn/ui (Radix) + TanStack Router/Query · Tauri 2 · Biome · Playwright ·
dependency-cruiser. Native: whisper.cpp, llama.cpp, Piper. Keep server code runtime-agnostic (Node fallback).
All library choices are fixed in `docs/spec/10-quality.md` ("Fixed technical choices"); do not add
alternatives without updating that table.

## Engineering principles

- **KISS as a default, not a dogma.** Build what the current stage needs; no abstraction, option, layer,
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

1. Spec first. If the code needs to diverge from the spec, update the spec in the same PR and say why.
   The spec fixes only decisions that are expensive to change; the rest is decided in the stage plan
   and written into the spec when built (`docs/spec/README.md`).
2. A new exercise type = schema + checker (engine) + renderer (`apps/web`) + tests. Never only one of them.
3. Schema changes that touch stored data require a migration (05) and a migration test.
4. Never commit third-party course content (texts, media, raw snapshots), not even in fixtures.
   Test fixtures are synthetic. Repo contains importers, manifests of URLs, and our own enrichment only.
5. User data never leaves the machine except calls to providers the user configured.
6. UI strings go through i18n (en, ru, de). No hard-coded user-facing text.
7. Small PRs. Each PR: tests, `bun run check` green, docs updated if structure changed.

## CLAUDE.md hygiene

- Describe the current state only. No logs, no history, no "we did X".
- Keep each file ≤ 150 lines. Link to the spec instead of repeating it.
- When you change structure or contracts of an area, update its CLAUDE.md in the same PR.
- At the end of every roadmap stage: sweep all CLAUDE.md files, delete stale lines.
- CI checks that repository paths mentioned in CLAUDE.md files exist; "Layout (target)" blocks and paths
  marked "created in stage N" are exempt until then (10).

## Commands (target state after stage 0)

- `bun install` · `bun run check` (typecheck + lint + boundaries + tests) · `bun run dev` (server + web)
- `bun run e2e` · `bun run cli -- <command>` · `bun run build:desktop`

## Current stage

See `docs/spec/11-roadmap.md`. Respect the **MVP boundary** defined there — do not build post-MVP features
early. Work on one stage at a time; stop at its acceptance criteria and report.
