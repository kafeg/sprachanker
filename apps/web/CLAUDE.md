# apps/web

React UI for the desktop window and phone PWA. Spec: `docs/spec/09-ui.md`.
May use `schema`, `engine`, and a type-only import of the server's `AppType` (Hono RPC).

## Layout

```
apps/web/src/
  routes/          # router.tsx (code-based TanStack Router), courses (my courses, all courses), course map
                   # with its head in course-info (progress, source, stats, integrity, sync), review
                   # (decks, a deck's overview, the session), settings
  lesson/          # lesson player: player (run flow over the plan's steps), use-run (run + events), plan,
                   # overview, words-step, steps (reading pages, the step bar), exercise step, summary,
                   # reference, video; slots.ts: what optional features add (header, explain, practice)
  study/           # Anki's reviewer, shared by Review and the lesson's "Words" step: card (the card widget,
                   # its recording and autoplay), session (counts, Show answer, ratings, keys, undo, More)
  exercises/       # one renderer per exercise type; no API calls, render and emit answers
  api/             # Hono RPC client (hono/client) + TanStack Query hooks; no codegen
  app/             # preferences applied in the UI: language, theme, course edition
  llm/             # AI assistant: settings (providers, LM Studio), "Why is this wrong?", tutor, writing,
                   # session review, scenes; parts.tsx: their shared cards, chat panel, composer, errors
  i18n/            # message catalogs en.json, ru.json, de.json (ICU)
  ui/              # design tokens in styles.css, shadcn/ui components (ui/components), app shell, media
  word/            # gender colouring
apps/web/public/   # favicon.svg (the icon master: speech bubble with an anchor), PNG icons, manifest
apps/web/scripts/  # icons.ts: renders the PNG icons from favicon.svg (needs rsvg-convert)
```

Later (target): `audio/` (recorder, PTT), `pwa/` (service worker, IndexedDB outbox), more routes (today,
notebook, words, chat). shadcn components are added with `bunx --bun shadcn@<version> add <name>`
(components.json points to `@/ui`).

## Rules

- No user-facing string outside i18n catalogs (`src/i18n/*.json`, nested keys, ICU messages);
  `test/catalogs.test.ts` fails on differing keys or invalid ICU. Language names come from
  `Intl.DisplayNames`, not catalogs.
- Catalog style: ru addresses the learner as «вы», de as "du"; counts use ICU `plural` with `#`, other
  numbers `{x, number}` or `Intl.NumberFormat` (never `toFixed` or `${n}%`).
- The API client imports only `import type { AppType } from "@sprachanker/server/app"`.
- der/die/das colours (`text-der`, `text-die`, `text-das`) are used only for grammatical gender;
  correct/incorrect use `correct`/`wrong` tokens plus an icon.
- Business logic stays in engine/server; components render and emit events. Answers are checked with
  `@sprachanker/engine` for instant feedback; the server re-checks and stores its own outcome.
- Every screen works on phone width (375 px) and desktop; test both in Playwright.
- Respect `prefers-reduced-motion`; touch targets ≥ 44 px on touch screens: the Button component
  does it (`pointer-coarse:min-h-11`), other tappable elements add `pointer-coarse:min-h-11`.
- Screen key handlers leave Space and Enter to a focused button, link or slider.
- Model output is Markdown rendered with markdown-it (`html: false`), never raw HTML.
- Optional features (today: `llm/`) live in their own folder; screens receive them as props/slots, so the
  folder can be removed with its mount points: the settings page and the router, which passes
  `lessonAssistant` (llm/lesson-assistant.tsx) as the player's slots. Nothing in `lesson/` imports `llm/`.
