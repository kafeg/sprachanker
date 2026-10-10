# 10 — Quality, architecture enforcement, documentation

## Architecture enforcement

- Module boundaries from the root `CLAUDE.md` are encoded in `.dependency-cruiser.cjs`; violations fail
  CI. A test runs the rules against a fixture file with a deliberate violation to prove they work.
- TypeScript `strict` + `noUncheckedIndexedAccess`; no `any` without a comment explaining why.
- Biome for formatting and linting; one config at the root.
- `packages/schema` is the single source of types for data crossing module boundaries. JSON Schemas
  are generated from it for library files, enrichment YAML and the rules registry; event payloads
  and run columns have their stored shapes on record instead (05).

## CI checks on data

| Check | What fails CI |
|---|---|
| Schema drift | generated JSON Schemas differ from the committed ones in `packages/schema/json-schema/` |
| Rules registry | an invalid registry file, duplicate rule ids, a fixture `ruleIds` value not in the registry (enrichment checks come with enrichment, 02) |
| Fixture library | `courses/_fixture` (invented course, two editions) has an exercise of every type, validates against the schemas, and its fingerprints match the content |
| Provider contracts | synthetic fixtures normalise into valid, deterministic output |
| Exercise registry | a type missing from the fixture course |
| i18n | en/ru/de catalogs have different keys, a message is not valid ICU or takes other arguments than the English one, a key the code asks for is in no catalog, a key no code uses, a ru/de message left as the English text |
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
| PDF reading (importers) | `pdfjs-dist` (pdf.js, legacy build, its parser in the importer's thread): text with its place, pictures decoded; PNG written with `node:zlib` |
| Markdown rendering | `markdown-it` with `html: false` |
| Zip | `fflate` (when first needed: profile export, `.apkg`) |
| Logging | `pino` (when first needed: structured logs; today `console.error` for what is left out or fails) |
| Crypto | WebCrypto: AES-256-GCM (API keys), SHA-256 (device tokens) — runtime-agnostic, no adapter |
| Web UI | React, Vite, Tailwind, shadcn/ui (Radix), Lucide; fonts bundled from `@fontsource` (no CDN); Motion when an animation needs more than CSS |
| Drag and drop | `@dnd-kit/core` (mouse, touch and keyboard) with `@dnd-kit/utilities`; every drag also works by tap (pick, then place) |
| Language flags | `country-flag-icons` (SVG React components, one module per flag; our language → flag table in `apps/web/src/ui/flags.tsx`) |
| Routing / server state / UI state | TanStack Router / TanStack Query / React state and context (Zustand when shared client state outgrows them) |
| i18n | i18next + react-i18next + i18next-icu (intl-messageformat checks the catalogs in tests) |
| Charts | our own SVG (the activity calendar); Recharts when charts with axes come (plan, Notebook) |
| Media | native `<video>`/`<audio>`; MediaRecorder + WebAudio resampling to 16 kHz |
| Desktop | Tauri 2 (planned) |
| Native engines | whisper.cpp (`whisper-server`), pinned (`native/whisper/VERSION`); Piper voices through sherpa-onnx (`sherpa-onnx-offline-tts`), pinned (`native/piper/VERSION`); Qwen3-TTS through qwentts.cpp (`tts-server`), pinned by commit (`native/qwen/VERSION`) (08); LLMs run in LM Studio (07) |
| Type checking | TypeScript, current major (`tsc --noEmit` per workspace); tooling must not pin it to an older one |
| Lint / boundaries / e2e | Biome / dependency-cruiser with the swc parser (no dependency on the TypeScript compiler API) / Playwright |
| Web component tests | `@testing-library/react` on `happy-dom` (`@happy-dom/global-registrator`, preloaded in `apps/web/bunfig.toml`), `bun test --isolate`; the web's tests run apart from the server's so the browser globals never reach them (2026-10-07: 10 000 lines of UI were covered by e2e only) |

## Tests

| Level | What |
|---|---|
| Unit (`bun test`) | checkers per type (table-driven), text normalisation, progress functions, normalisers, LLM tasks with fake endpoints (prompts, output parsing, repair) |
| Component (web) | screens and hooks with the query cache filled (no requests) and a router in memory: the lesson flow, item cards, histories, My words, the Notebook, the summary; pure UI logic in its own modules (filters, cache updates) |
| Contract / snapshot | providers on **synthetic** fixtures |
| Integration | server API against a temp data root (`createApp().request()`); media Range |
| Migration | migrations with backup, downgrade refusal and rollback; each schema change upgrades a database built by the earlier migrations, with rows in it |
| E2E (Playwright) | the fixture course: open the course, do exercises, resume, finish with a summary; AI screens against a fake OpenAI-compatible server (`e2e/fake-llm.ts`), never a real model; desktop and phone viewport |
| Run-throughs (Playwright, the Mac only) | real courses: lessons walked through by their screens at phone width (`e2e/real`) — the words rated, the reading pages read, every exercise answered and checked, speaking items recorded with the browser's fake microphone, the summary reached; after each step, and after each exercise's check, nothing wider than the screen and no error page (labels cut short listed at the end, to look at; `REAL_SHOTS=<dir>` keeps every checked exercise as a screenshot; `REAL_DESKTOP=1` adds a desktop run); then the profile's database read: one run finished and completed, each exercise page shown, every item answered or skipped with the engine's own outcome stored, the reading steps recorded, the words' cards made (by all three faces) and their ratings stored. Each installed exam too
(`exam.real.ts`): the federal state chosen on its page, a mock exam drawn and every question answered
by its card (two of three right), handed in, its result; practice of the mistakes checked at once, the
catalogue narrowed to the wrong ones, the Notebook; then the store — each plan drawn as the real test
draws (each section's number, the state's questions only), kept as shown with its sections, answers
only to the run's questions with the engine's outcome, each result what its answers give, one active
run per exam. Against an APFS clone of the real library in a throwaway data root (never the owner's profiles); chosen by key prefix (`REAL=dw.nicos-weg/a1-ru bun run e2e:real`; default: the first lesson of each series' first course; `REAL_PER_COURSE`; `REAL_UI` the interface language, English by default); asserts on structure, never on course text; not in CI. The checks are pure and caught on a store broken on purpose (`e2e/real/store.test.ts`) |
| Speech round-trip (the Mac only) | `bun run speech:check`: the texts of `e2e/speech/corpus.json` — sentences in the language learnt and explanations quoting it, written once by the app's tutor in real lessons of three pairs (`e2e/speech/corpus.ts`), not taken from the courses — read by Qwen3-TTS and heard back by Whisper through the compiled binary (models an APFS clone of the real ones); each text's words scored by language (quoted words the language learnt) as the share heard; seeded, so it repeats. The bar: a median of 85% for what is in its own language, 60% for a quote. `SPEECH_KIND`, `SPEECH_LIMIT`, `SPEECH_MIXED_AS` to compare how a mixed text is asked for |

Third-party content never appears in fixtures.

## CI

GitHub Actions on every push to `main` and every PR: install → typecheck → Biome →
dependency-cruiser → tests → web build → binary build → e2e against the binary (Chromium + WebKit,
desktop + phone). `bun run check` runs the same locally except the builds and e2e (`bun run e2e`: Chromium on
a desktop and WebKit on a phone; `bun run e2e:all` runs all four as CI does).
Repository-level checks (boundary rules test, CLAUDE.md paths) live in `scripts/` and run in `bun test`.

## Documentation rules

- `docs/spec/*` — what and why, at the level of detail described in `docs/spec/README.md`. Updated in
  the same commit as behaviour changes.
- `docs/plan.md` — work not yet built. `docs/architecture.md` — the parts and how they fit; updated when
  a module, a dependency or a cross-cutting mechanism changes.
- `CLAUDE.md` files — how to work in an area. Root file holds the module map and dependency rules;
  module files link to their spec and never repeat it. Max ≈150 lines each. No changelogs or progress
  logs; git history is the history.
- A CI script (`scripts/claude-paths.ts`) checks that what CLAUDE.md files name exists: backticked
  paths starting with `packages/`, `apps/`, `courses/`, `native/`, `docs/`, `e2e/`, and every entry of
  a `## Layout` tree (relative to the CLAUDE.md's folder). What is not built yet goes in a `## Planned`
  list (not checked); lines marked "(planned)" and paths with `<placeholders>` are not checked either.
- `docs/research/*` — facts about external sources; re-verified when importers change.

## Commits

Work goes straight to `main` in small commits; CI runs on every push.

- Small and focused; the subject names the module(s).
- Body: what problem, which modules, why this place, what was reused, what was deliberately not built.
- Checklist: tests · `bun run check` green · spec/CLAUDE.md updated if structure or contracts changed ·
  no third-party content · strings in i18n catalogs · migration + test if stored data changed.
- Review questions: Is anything built that the change does not need? Could an existing entity cover a
  new one? Is logic duplicated? Is every change in the module that owns it?
