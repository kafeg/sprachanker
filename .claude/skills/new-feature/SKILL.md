---
name: new-feature
description: "How to add or change a feature in SprachAnker end to end: where the code goes, the i18n catalogs, tests, e2e, review, docs, commit, deploy. Use when asked to build, add, implement or rework a feature, a screen, an AI task or a step. Not for releases (release) or course QA (course-check)."
---
# new-feature
The path from a request to a deployed change, with the checks that keep the repo consistent.

## Rules
- Ask the owner first when the request leaves a product choice open (what the learner sees, what counts as done). Code questions: decide yourself.
- Put each part in the module that owns it (root `CLAUDE.md`, "Repository map"); respect the dependency rules.
- Reuse before writing: search the repo for an existing type, service, component or helper first.
- ⚠️ Stored data: an event payload only grows; record every new shape in `packages/schema/test/stored-events/events.json`. A table change needs a migration and a migration test.
- ⚠️ UI text: every string goes into all catalogs (`apps/web/src/i18n/*.json`, one per language). `test/catalogs.test.ts` fails on a missing or an unused key.
- A new exercise type = schema + engine checker + web renderer + tests, never one of them alone.
- An AI task: a `StructuredTask` in `packages/llm/src/tasks`, listed in `registry.ts` when the learner may rewrite its prompt; the fake model in `e2e/fake-llm.ts` answers it.

## Procedure
1. Read the root `CLAUDE.md`, `docs/decisions.md` and the `CLAUDE.md` of each area you touch.
2. State the modules the change touches and what it replaces (one short paragraph to the owner when the change is large).
3. Write the code, then the tests next to it: engine and schema logic in `bun test`, a screen in `apps/web/test`, a flow across server and UI in `e2e/`.
4. Add the strings to every catalog. Write a small script for 19 files; do not edit them one by one.
5. Run:
   ```bash
   bun run format && bun run check
   ```
6. Update the area `CLAUDE.md` when its layout or rules changed. Add a line to `docs/decisions.md` for an owner decision the code does not show.
7. At the end of a phase: start an independent review (a subagent with the diff and the risks to check), fix its findings, then run the full e2e in the background:
   ```bash
   bun run e2e
   ```
8. Commit and push to `main` (small commits, a message that says what the learner gets).
9. Deploy to the owner's server: `deploy-local`.

## Gotchas
- `catalogs.test.ts` fails with "unused" keys → a string was removed from the code → delete the key from every catalog.
- e2e fails only on the phone project → an element is in the hidden plan sheet → filter with `{ visible: true }`.
- A server test hangs on a model call → the fake fetch has no reply for the task's schema name → add one.
- A CLAUDE.md check fails → a backticked path or a `## Layout` entry no longer exists → fix the file.

## Boundaries
- Restarting the owner's server only: `deploy-local`.
- AI practice checked with a real model: `ai-practice-check`.
- A whole course checked: `course-check`.

<!-- style: ste80 -->
