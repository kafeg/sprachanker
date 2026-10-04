# apps/web

React UI for the desktop window and phone PWA. Spec: `docs/spec/09-ui.md`.
May use `schema`, `engine`, and a type-only import of the server's `AppType` (Hono RPC).

## Layout (target)

```
apps/web/src/
  routes/          # TanStack Router: today, catalog, course, lesson, review, speak, chat, notebook, words, exams, settings, server, first-run
  api/             # Hono RPC client (hono/client) + TanStack Query hooks; no codegen
  audio/           # recorder → 16 kHz WAV, playback, PTT
  i18n/            # message catalogs en.json, ru.json, de.json (ICU)
  pwa/             # manifest, icons; IndexedDB outbox for unsent events
  ui/              # design tokens (gender hues reserved), shadcn/ui-based components
  exercises/       # one renderer per exercise type; no API calls, render and emit answers
  word/            # word sheet, gender colouring
```

Current state: one hello page (`src/App.tsx`) with i18n and the API client; no router, Tailwind or
shadcn/ui yet (stage 5).

## Rules

- No user-facing string outside i18n catalogs (`src/i18n/*.json`, nested keys, ICU messages);
  `test/catalogs.test.ts` fails on differing keys or invalid ICU. Language names come from
  `Intl.DisplayNames`, not catalogs.
- The API client imports only `import type { AppType } from "@sprachanker/server/app"`.
- der/die/das colours are used only for grammatical gender.
- Business logic stays in engine/server; components render and emit events.
- Every screen works on phone width (375 px) and desktop; test both in Playwright.
- Respect `prefers-reduced-motion`; touch targets ≥ 44 px.
