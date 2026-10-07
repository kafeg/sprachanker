# apps/web

React UI for the desktop window and phone PWA. Spec: `docs/spec/09-ui.md`.
May use `schema`, `engine`, and a type-only import of the server's `AppType` (Hono RPC).

## Layout

```
apps/web/src/
  routes/          # router.tsx (code-based TanStack Router) and the pages: courses (my courses, all
                   # courses), course (its map), review (decks, a deck's overview, the session), words
                   # (My words, under Decks), settings
  courses/         # course cards and offers, the pair and course filters (filterCourses, pure), downloads,
                   # the course page's hero (progress, source, stats, integrity, sync)
  lesson/          # lesson player: player (loads the lesson and its run, shows the step), use-flow (the
                   # flow over the plan: steps, moving, starting, resuming, completing), frame (plan,
                   # header, reference), use-run (run + events), plan, overview, words-step, steps
                   # (reading pages, the step bar), exercise step (its rules in use-exercise, Enter in
                   # enter-key), practice-step, mistakes-status,
                   # summary, reference; slots.ts: what optional features add
  study/           # Anki's reviewer, shared by Review and the lesson's "Words" step: card (the card widget,
                   # its recording and autoplay), session (counts, Show answer, ratings, keys, undo, More);
                   # tones (ratings and counts in our hues), time (intervals, next due), decks (deck names),
                   # word-sheet (a word with cards in full: forms, faces, answers)
  exercises/       # one renderer per exercise type; item-card (an item with its prompt, media and
                   # renderer: answered in the player, read-only in the Notebook); no API calls
  notebook/        # the Notebook: page (study days, lessons), lesson (passes), pass (in full), compare,
                   # item-history, mark
  api/             # Hono RPC client (hono/client) + TanStack Query hooks; no codegen
  app/             # the app around the screens, with data: shell (navigation, cards due, downloads),
                   # about, reset-progress, preferences (language, theme, course edition)
  llm/             # AI assistant: settings (providers, LM Studio), "Why is this wrong?", tutor (header
                   # panel with Conversation and History — tutor-history —, inline on the mistakes step),
                   # writing, scenes; parts.tsx: chat bubbles, header,
                   # pending exchange, composer, start prompt, errors; cache.ts: pure cache updates
  i18n/            # message catalogs en.json, ru.json, de.json (ICU)
  ui/              # presentational only (no API, no features): design tokens in styles.css, shadcn/ui
                   # components (ui/components), rich-text (model Markdown), page (pages,
                   # empty states, back links), media, format (dates, percent, bytes), panel, history
                   # (rows that open, lists of earlier items), side-sheet, chip, video (the episode: HD by
                   # default, SD switch, speed, subtitles toggle, its text; exercises showing it too),
                   # playback (one medium at a time, the speed button), sections (a course page's
                   # sections; CourseSections in course-html shows them as cards)
  word/            # gender colouring
apps/web/public/   # favicon.svg (the icon master: speech bubble with an anchor), PNG icons, manifest
apps/web/scripts/  # icons.ts: renders the PNG icons from favicon.svg (needs rsvg-convert)
```

Later (target): `audio/` (recorder, PTT), `pwa/` (service worker, IndexedDB outbox), more routes (today,
chat). shadcn components are added with `bunx --bun shadcn@<version> add <name>`
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
- Tests live in `test/` and run in a browser (happy-dom, preloaded by `bunfig.toml`; `bun run test`
  here, also from the root): render with `test/render.tsx` — the query cache filled, no requests, a
  memory router when there are links. Logic goes to the engine or to pure modules and is tested there;
  a screen's test checks what it shows and what it asks for.
- Shared pieces, not copies: dates and numbers through `ui/format.ts`; a row that opens something is
  `ListRow`, a list of earlier items `HistoryList` (newest first, one open at a time); panels are
  `Panel`, side panels `SideSheet`, empty pages `EmptyState`; a waiting button is `<Button loading>`;
  cached lists take a new item through the pure updaters in `llm/cache.ts` (tested).
- Respect `prefers-reduced-motion`; touch targets ≥ 44 px on touch screens: the Button component
  does it (`pointer-coarse:min-h-11`), other tappable elements add `pointer-coarse:min-h-11`.
- Screen key handlers leave Space and Enter to a focused button, link or slider.
- Model output is Markdown rendered with markdown-it (`html: false`), never raw HTML.
- Optional features (today: `llm/`) live in their own folder; screens receive them as props/slots, so the
  folder can be removed with its mount points: the settings page and the router, which passes
  `lessonAssistant` (llm/lesson-assistant.tsx) as the player's slots. Nothing in `lesson/` imports `llm/`.
