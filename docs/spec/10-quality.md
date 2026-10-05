# 10 — Quality, architecture enforcement, documentation

## Architecture enforcement

- Module boundaries from the root `CLAUDE.md` are encoded in `.dependency-cruiser.cjs`; violations fail
  CI. A test runs the rules against a fixture file with a deliberate violation to prove they work.
- TypeScript `strict` + `noUncheckedIndexedAccess`; no `any` without a comment explaining why.
- Biome for formatting and linting; one config at the root.
- `packages/schema` is the single source of types for data crossing module boundaries. JSON Schemas
  are generated from it for library files, enrichment YAML, the rules registry and event payloads.

## CI checks on data

| Check | What fails CI |
|---|---|
| Schema drift | generated JSON Schemas differ from the committed ones in `packages/schema/json-schema/` |
| Enrichment and rules | invalid files, malformed keys, duplicate rule ids, a `ruleIds` value not in the registry |
| Fixture library | `courses/_fixture` (invented course, every exercise type) normalises, validates and passes `verify` |
| Provider contracts | synthetic fixtures normalise into valid, deterministic output |
| Exercise registry | a type without checker, renderer and fixture item |
| i18n | en/ru/de catalogs have different keys or a message is not valid ICU |
| CLAUDE.md paths | a backticked repository path in a CLAUDE.md does not exist (see Documentation) |

## Fixed technical choices

Decided up front so implementations do not vary between sessions. Changing one requires updating this
table in the same commit with the reason.

| Concern | Choice |
|---|---|
| Runtime, package manager, tests | Bun (workspaces, `bun test`); Node compatibility kept for the server |
| HTTP server | Hono; typed web client via Hono RPC (`hono/client`, type-only import of the server's `AppType`) — no code generation |
| Validation / types | zod 4; JSON Schema via its built-in `z.toJSONSchema` (`zod-to-json-schema` is deprecated) |
| Database | SQLite via `bun:sqlite`, Drizzle ORM + drizzle-kit migrations, WAL |
| IDs | ULID (`ulid`) |
| SRS | `ts-fsrs` |
| YAML | `yaml` |
| HTML sanitising (importers) | `sanitize-html` with the allow-list from 02 |
| Markdown rendering | `markdown-it` with `html: false` |
| Zip | `fflate` |
| Logging | `pino` |
| Crypto | WebCrypto AES-256-GCM; argon2id via `Bun.password` behind a runtime adapter |
| Web UI | React, Vite, Tailwind, shadcn/ui (Radix), Lucide, Motion; fonts bundled from `@fontsource` (no CDN) |
| Routing / server state / UI state | TanStack Router / TanStack Query / Zustand |
| i18n | i18next + react-i18next + i18next-icu |
| Charts | Recharts |
| Media | native `<video>`/`<audio>`; MediaRecorder + WebAudio resampling to 16 kHz |
| Desktop | Tauri 2 |
| Native engines | whisper.cpp (`whisper-server`), Piper — pinned versions; LLMs run in LM Studio (07) |
| Type checking | TypeScript, current major (`tsc --noEmit` per workspace); tooling must not pin it to an older one |
| Lint / boundaries / e2e | Biome / dependency-cruiser with the swc parser (no dependency on the TypeScript compiler API) / Playwright |

## Tests

| Level | What |
|---|---|
| Unit (`bun test`) | checkers per type (table-driven), normalisation, FSRS wrapper, replay, normalisers, LLM output parsing |
| Contract / snapshot | providers on **synthetic** fixtures; enrichment validates and resolves keys |
| Integration | server API against a temp data root; jobs; media Range |
| Migration | upgrade fixture DBs from every released schema version |
| E2E (Playwright) | "first run → install fixture course → complete lesson 1 → review cards", desktop and phone viewport |
| LLM golden | `prompts test` per route, run manually before changing defaults or prompts |
| Manual | owner demo at the end of each stage on Mac and iPhone |

Third-party content never appears in fixtures.

## CI

GitHub Actions on every push to `main` and every PR: install → typecheck → Biome →
dependency-cruiser → tests → web build → binary build → e2e against the binary (Chromium + WebKit,
desktop + phone). `bun run check` runs the same locally except the builds and e2e (`bun run e2e`).
Repository-level checks (boundary rules test, CLAUDE.md paths) live in `scripts/` and run in `bun test`.

## Documentation rules

- `docs/spec/*` — what and why, at the level of detail described in `docs/spec/README.md`. Updated in
  the same commit as behaviour changes.
- `CLAUDE.md` files — how to work in an area. Root file holds the module map and dependency rules;
  module files link to their spec and never repeat it. Max ≈150 lines each. No changelogs or progress
  logs; git history is the history.
- A CI script checks that backticked paths starting with `packages/`, `apps/`, `courses/`, `native/`,
  `docs/`, `e2e/` in CLAUDE.md files exist. Exempt: code blocks under a heading containing "(target)",
  paths marked "created in stage N", and paths containing `<placeholders>`.
- End of each stage: sweep all CLAUDE.md and spec files; remove stale statements.
- `docs/research/*` — facts about external sources; re-verified when importers change.

## Commits

Work goes straight to `main` in small commits; CI runs on every push.

- Small and focused; the subject names the module(s).
- Body: what problem, which modules, why this place, what was reused, what was deliberately not built.
- Checklist: tests · `bun run check` green · spec/CLAUDE.md updated if structure or contracts changed ·
  no third-party content · strings in i18n catalogs · migration + test if stored data changed.
- Review questions: Is anything built that the stage does not need? Could an existing entity cover a
  new one? Is logic duplicated? Is every change in the module that owns it?
