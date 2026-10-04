# apps/web (+ packages/ui-kit)

React UI for the desktop window and phone PWA. Spec: `docs/spec/09-ui.md`.
`apps/web` may use `ui-kit`, `schema`, `engine` and the API client; `ui-kit` may use `schema`, `engine`.

## Layout (target)

```
apps/web/src/
  routes/          # TanStack Router: today, catalog, course, lesson, review, speak, chat, notebook, words, exams, settings, models, server, onboarding
  api/             # Hono RPC client (hono/client) + TanStack Query hooks; no codegen
  audio/           # recorder → 16 kHz WAV, playback, PTT
  i18n/            # message catalogs en.json, ru.json, de.json (ICU)
  pwa/             # manifest, icons, minimal service worker (app shell only)
packages/ui-kit/src/
  tokens/          # colours (gender hues reserved), type, spacing, light/dark
  components/      # shadcn/ui-based components
  exercises/       # one renderer per exercise type
  word/            # word sheet, gender colouring
```

## Rules

- No user-facing string outside i18n catalogs; keep en/ru/de keys complete (CI checks).
- der/die/das colours are used only for grammatical gender.
- Business logic stays in engine/server; components render and emit events.
- Every screen works on phone width (375 px) and desktop; test both in Playwright.
- Respect `prefers-reduced-motion`; touch targets ≥ 44 px.
