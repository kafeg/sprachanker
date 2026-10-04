# 10 — Quality, architecture enforcement, documentation

## Architecture enforcement

- Module boundaries from the root `CLAUDE.md` are encoded in `.dependency-cruiser.cjs`; violations fail CI.
  Stage 0 includes a deliberate violation test to prove the rule works.
- TypeScript `strict`, `noUncheckedIndexedAccess`, no `any` without a comment explaining why.
- Biome for formatting and linting; one config at the root.
- `packages/schema` is the single source of types for data that crosses module boundaries. JSON Schemas
  are generated from it for library files, enrichment YAML, the rules registry and event payloads.

## Schema and data checks in CI

| Check | What fails CI |
|---|---|
| Schema drift | generated JSON Schemas differ from the committed ones in `packages/schema/json-schema/` |
| Enrichment | any enrichment YAML or scene/mission file invalid; any key malformed (`keys.ts` parser) |
| Rules registry | invalid file; duplicate ids; a `ruleIds` value in enrichment not in the registry; missing `en` title |
| Fixture library | the fixture course (`courses/_fixture`) normalises, validates and passes `verify` (referential integrity, locale coverage) for two editions |
| Provider contracts | every provider's synthetic fixtures normalise into valid output; output is deterministic (normalised twice → identical bytes) |
| Exercise registry | every type in the schema registry has a checker, a renderer and a fixture item (no partial types) |
| Event payloads | every event type has a schema; round-trip tests (write → read → validate) |
| DB ↔ schema | Drizzle table types match zod row schemas for JSON columns (`*_json` validated on write) |
| i18n | en/ru/de catalogs have the same keys |

## Fixed technical choices

Decided up front so implementations do not vary between sessions. Changing one requires updating this
table in the same PR with the reason.

| Concern | Choice |
|---|---|
| Runtime, package manager, tests | Bun (workspaces, `bun test`); Node compatibility kept for the server |
| HTTP server | Hono; typed client for the web via Hono RPC (`hono/client`) — no code generation |
| Validation / types | zod (schemas in `packages/schema`); JSON Schema via `zod-to-json-schema` |
| Database | SQLite via `bun:sqlite`, Drizzle ORM + drizzle-kit migrations, WAL |
| IDs | ULID (`ulid`) |
| SRS | `ts-fsrs` |
| YAML | `yaml` |
| HTML sanitising (importers) | `sanitize-html` with the allow-list from 02 |
| Markdown rendering | `markdown-it` with `html: false` |
| Zip (`.apkg`, exports) | `fflate` |
| Logging | `pino` (JSON, rotated files) |
| Crypto | WebCrypto AES-256-GCM for secrets; argon2id for PINs (`Bun.password`, behind a runtime adapter) |
| Web UI | React, Vite, Tailwind, shadcn/ui (Radix), Lucide, Motion |
| Routing / server state / UI state | TanStack Router / TanStack Query / Zustand |
| i18n | i18next + react-i18next + i18next-icu (ICU MessageFormat) |
| Charts | Recharts |
| Video / audio | native `<video>`/`<audio>`; recording via MediaRecorder + WebAudio resampling to 16 kHz |
| Desktop | Tauri 2 (+ updater, tray), Rust kept minimal |
| Native engines | whisper.cpp (`whisper-server`), llama.cpp (`llama-server`), Piper — pinned versions |
| Lint/format | Biome; boundaries: dependency-cruiser; e2e: Playwright |

## Tests

| Level | Tool | What |
|---|---|---|
| Unit | `bun test` | engine checkers per exercise type, FSRS integration, normalisers, LLM output parsing |
| Contract | `bun test` | every provider's output validates against schema; enrichment validates and resolves keys |
| Snapshot | `bun test` | normalisers on **synthetic** fixtures (hand-written JSON shaped like the source) |
| Integration | `bun test` | server API against a temp data root; jobs; media Range |
| Migration | `bun test` | upgrade fixture DBs from every released schema version; rebuild derived tables |
| E2E | Playwright | "first run → install fixture course → complete lesson 1 → review cards", phone viewport |
| LLM golden | CLI | `prompts test` per route; run manually and before changing defaults or prompts |
| Manual | owner | demo at the end of each stage on Mac and iPhone |

- Third-party content never appears in fixtures. A fixture course (`courses/_fixture`) exercises every
  exercise type with invented content.
- Performance budgets checked in CI: server cold start < 1.5 s, initial PWA JS < 300 kB gzip, idle server
  RSS < 200 MB (without sidecars).

## CI

GitHub Actions on every PR: install → typecheck → Biome → dependency-cruiser → unit/contract/snapshot/
integration/migration tests → web build → e2e (Chromium + WebKit). Native builds and desktop bundles on
tags (macOS arm64 first; Windows/Linux added in stage 12). `bun run check` runs the same locally.

## Documentation rules

- `docs/spec/*` — what and why. Updated in the same PR as behaviour changes.
- `CLAUDE.md` files — how to work in an area. Root file holds the module map and dependency rules; module
  files exist only where the area has its own structure and rules. Each links to its spec section and
  never repeats it.
- No ADRs, no changelogs inside CLAUDE.md, no progress logs. Git history is the history.
- Max ≈150 lines per CLAUDE.md. A CI script checks that repository paths mentioned in CLAUDE.md files
  (backticked, starting with `packages/`, `apps/`, `courses/`, `native/`, `docs/`, `e2e/`) exist. Code
  blocks under a heading containing "(target)" and paths marked "created in stage N" are exempt: they
  describe planned structure. When a planned
  folder is created, its CLAUDE.md layout is updated and the "(target)" mark removed once all exist.
- End of each stage: sweep all CLAUDE.md and spec files; remove stale statements.
- `docs/research/*` — facts about external sources; re-verified when importers change.

## Pull requests

- Small, focused; title says the module(s) touched.
- Description answers: what problem, which modules, why this place, what existing code was reused or
  extended, what was deliberately *not* built.
- Checklist in the PR template: tests added/updated · `bun run check` green · spec/CLAUDE.md updated if
  structure or contracts changed · no third-party content · strings in i18n catalogs · migration + test if
  stored data changed.
- Review questions (every PR and at stage end), from the engineering principles in the root CLAUDE.md:
  Is anything built that the current stage does not need? Is there a new entity that an existing one
  could cover? Is any logic duplicated? Is every change in the module that owns the responsibility?
  Does every module still match its responsibility in the root map?

## Security basics

Server binds localhost by default; CORS limited to own origin; CSP on the web app; PIN attempts
rate-limited; secrets encrypted at rest and write-only via API; dependencies pinned with a lockfile;
`bun audit`/OSV check in CI.
