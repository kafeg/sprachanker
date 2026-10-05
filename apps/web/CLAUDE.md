# apps/web

React UI for the desktop window and phone PWA. Spec: `docs/spec/09-ui.md`.
May use `schema`, `engine`, and a type-only import of the server's `AppType` (Hono RPC).

## Layout

```
apps/web/src/
  routes/          # router.tsx (code-based TanStack Router), courses, course map, settings
  lesson/          # lesson player: use-run (run + events), exercise step, reference, video
  exercises/       # one renderer per exercise type; no API calls, render and emit answers
  api/             # Hono RPC client (hono/client) + TanStack Query hooks; no codegen
  app/             # preferences applied in the UI: language, theme, course edition
  i18n/            # message catalogs en.json, ru.json, de.json (ICU)
  ui/              # design tokens in styles.css, shadcn/ui components (ui/components), app shell, media
  word/            # gender colouring
```

Later (target): `audio/` (recorder, PTT), `pwa/` (manifest, IndexedDB outbox), more routes (today, review,
notebook, words, chat). shadcn components are added with `bunx --bun shadcn@<version> add <name>`
(components.json points to `@/ui`).

## Rules

- No user-facing string outside i18n catalogs (`src/i18n/*.json`, nested keys, ICU messages);
  `test/catalogs.test.ts` fails on differing keys or invalid ICU. Language names come from
  `Intl.DisplayNames`, not catalogs.
- The API client imports only `import type { AppType } from "@sprachanker/server/app"`.
- der/die/das colours (`text-der`, `text-die`, `text-das`) are used only for grammatical gender;
  correct/incorrect use `correct`/`wrong` tokens plus an icon.
- Business logic stays in engine/server; components render and emit events. Answers are checked with
  `@sprachanker/engine` for instant feedback; the server re-checks and stores its own outcome.
- Every screen works on phone width (375 px) and desktop; test both in Playwright.
- Respect `prefers-reduced-motion`; touch targets ≥ 44 px.
