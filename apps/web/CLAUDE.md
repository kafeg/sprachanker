# apps/web

React UI for desktop and phone screens (an installable PWA). Spec: `docs/spec/09-ui.md`.
May use `schema`, `engine`, and a type-only import of the server's `AppType` (Hono RPC).

## Layout

```
apps/web/src/
  main.tsx         # the entry: query client, i18n, the router
  routes/          # router.tsx (code-based TanStack Router: the gate, then the pages): courses (tabs My,
                   # Downloaded, Available — /, /downloaded, /catalog), review (tabs Study, Decks with
                   # the decks to take, My words — /review, /review/decks, /review/words; words.tsx is
                   # My words), exams (tabs My, Downloaded, Available — /exams, /exams/downloaded,
                   # /exams/catalog), course (its map), settings, storage (Settings → General's storage)
  courses/         # course cards (on library/card), the pair and course filters (filterCourses, pure), the
                   # course page's hero (progress, source, stats, integrity, sync)
  lesson/          # lesson player: player (loads the lesson and its run, shows the step), use-flow (the
                   # flow over the plan: steps, moving, starting, resuming, completing), frame (plan,
                   # header, reference), use-run (the run in the query cache + its events, sent through
                   # api/run-events), plan, overview, words-step, steps
                   # (reading pages, the step bar), exercise step (its rules in use-exercise, Enter in
                   # enter-key), practice-step, mistakes-status,
                   # summary, reference; slots.ts: what optional features add
  study/           # Anki's reviewer, shared by Review and the lesson's "Words" step: card (the card widget,
                   # its recording and autoplay), session (counts, Show answer, ratings, undo; one action
                   # at a time), reviewer-keys (Anki's keys: a pure mapping, tested), more-menu;
                   # tones (ratings and counts in our hues), time (intervals, next due), decks (deck names),
                   # word-sheet (a word with cards in full: forms, faces, answers), guide (how review
                   # works: the method, buttons, card types, actions, keys), review-settings (Settings →
                   # Review: Anki's deck options); slots (what optional features add: AI examples)
  exercises/       # one renderer per exercise type (index.tsx: the renderer of each type); dnd (placing
                   # chips by drag or tap); item-card (an item with its prompt, media and
                   # renderer: answered in the player, read-only in the Notebook); no API calls
  exams/           # exams: card (the list's), page (an exam's: modes, the latest mock exam, sources),
                   # player (a run a question at a time: mock exam timed, practice checked at once),
                   # navigator (the run's plan: its questions by Teil), result, catalog (a compact list,
                   # a question opened with its answer), state-select (the federal state), questions (a question as an
                   # exercise, the latest answers, questions by Teil), teil (a Teil's header and
                   # material; a question's card), recording (a mock exam's recording: plays limited),
                   # rating (an open answer rated by its criteria, a proposal shown chosen), slots
                   # (what optional features add: the AI's proposal, the conversation), use-exam
  notebook/        # the Notebook: page (progress, the study days' calendar with totals, every module's
                   # standing — standing.tsx shows them alike, a module adding only titles and links),
                   # lesson (passes), pass (in full), compare, exam (an exam's runs and questions as they
                   # stand), mark
  library/         # what feature folders share: card (a course's or an exam's, an offer, the publisher),
                   # tab-page (Courses' and Exams' tabs), download, upkeep (check and sync), reset-progress,
                   # exam-address, item-history (an item across passes), spoken-check (under its item)
  api/             # Hono RPC client (hono/client) + TanStack Query hooks; exams.ts; outbox (events in
                   # order, retried, a refused batch dropped; tested), run-events (a lesson's or exam's
                   # run's events over it: per profile, the server's outcomes, on page close); session.ts: profiles, signing
                   # in and out, devices; edition.ts: the edition a course is shown in; cache.ts: pure
                   # cache updates; no codegen
  app/             # the app around the screens, with data: shell (navigation, cards due, downloads, the
                   # profile chip — profile-chip), language-switch (the interface language: who-is-studying's,
                   # kept on the device; Settings → General's, kept in the profile), who-is-studying (tiles five to a page; "New profile" starts
                   # the onboarding), onboarding (the profile's name and colour — made at its Next —, the AI
                   # step a slot from the router, speech, tour; the router opens it again for the new
                   # profile at the AI step), name-colour (a profile's name and colour: the onboarding's
                   # and Settings → Profile's), profile-settings, device-name, about,
                   # preferences (language, theme, playback speed), experimental (what is shown: stable sources
                   # always, experimental ones turned on), experimental-settings (Settings → General → Experimental)
  llm/             # AI assistant: settings (AssistantSetup: provider-cards, key-state, model-list over the
                   # pure model-filter; LM Studio), "Why is this wrong?", tutor (header
                   # panel with Conversation and History — tutor-history —, inline on the mistakes step),
                   # writing, scenes, spoken-check (the AI's check under an answer said aloud), word-example
                   # (the reviewer's slot); exam-assistant (an exam run's slots): exam-rating ("Propose a
                   # rating"), exam-conversation (a speaking part held as a conversation);
                   # settings-section (Settings → AI assistant), lmstudio-section,
                   # prompts-info (Settings → AI assistant: where it works; the prompts under Advanced), prompt-view (a request as sent), context-meter
                   # (the tutor's context gauge), assistant-label (which AI answers); parts.tsx: chat
                   # bubbles, header, pending exchange, composer, start prompt, errors
  i18n/            # message catalogs en.json, ru.json, de.json (ICU)
  ui/              # presentational only (no API, no features): design tokens in styles.css, shadcn/ui
                   # components (ui/components), rich-text (model Markdown), page (pages,
                   # empty states, back links), media, format (dates, percent, bytes), panel, history
                   # (rows that open, lists of earlier items), side-layout (a page with a side column: the
                   # lesson player's, an exam run's; the column's head), plan-list (a plan's headings and rows), progress-ring, side-sheet, chip, section-tabs (a section's tabs as links, and a page's own — Settings' — in their look), video (the episode: HD by
                   # default, SD switch, speed, subtitles toggle, its text; exercises showing it too),
                   # playback (one medium at a time, the speed button, useClip for short clips), sections (a course page's
                   # sections; CourseSections in course-html shows them as cards), activity-calendar (a
                   # year of days as squares), stat-tile, checked-text (a model's check: verdict, the text
                   # corrected, corrections), step-dot (an exercise's mark), avatar, choice (segmented), check-row (a setting on or off), disclosure (folded: "Advanced"),
                   # confirm (an action that cannot be undone), flags (a language's flag), error-text (an
                   # API error in words), target-lang (`lang` of the course's language), window-title,
                   # utils (cn)
  audio/           # recording oneself (08): recorder (MediaRecorder, the microphone of this device, its
                   # loudness), wav (a take as 16 kHz WAV), mic-button (disabled with the reason),
                   # dictate (a microphone beside a text box: what was heard goes into it),
                   # take-button, context (the speech
                   # host the router provides: keep recordings, show the phrase, save, src, recognition —
                   # renderers
                   # call no API; use-speech-host makes it), speech-settings (Settings → Speech;
                   # SpeechSetup — microphone, recognition, reading aloud — is also the onboarding's step),
                   # reading aloud: speak.ts (what is said, by which voice; pure), speaker.ts (each part by
                   # the server's engine — Piper or Qwen3-TTS — or the device's voices, one text at a time,
                   # read at once), speak-button, read-aloud-settings (engines, voices, downloads),
                   # read-languages (the languages read aloud: the courses' here, else the catalogue's,
                   # and the interface's),
                   # samples (what "Listen" reads: everyday sentences per language; pure); in-use (the mark of
                   # the model in use: Whisper's, Qwen3-TTS's)
  word/            # gender colouring
apps/web/public/   # favicon.svg (the icon master: speech bubble with an anchor), PNG icons, manifest
apps/web/scripts/  # icons.ts: renders the PNG icons from favicon.svg (needs rsvg-convert)
```

shadcn components are added with `bunx --bun shadcn@<version> add <name>` (components.json points
to `@/ui`).

## Rules

- No user-facing string outside i18n catalogs (`src/i18n/*.json`, nested keys, ICU messages);
  `test/catalogs.test.ts` fails on differing keys, invalid ICU, a key the code asks for that no
  catalog has, a key no code uses, a ru/de message left as the English text, or one taking other
  arguments than the English one. Language names come from
  `Intl.DisplayNames`, not catalogs.
- Catalog style: ru addresses the learner as «вы», de as "du"; counts use ICU `plural` with `#`, other
  numbers `{x, number}` or `Intl.NumberFormat` (never `toFixed` or `${n}%`).
- The API client imports only `import type { AppType } from "@sprachanker/server/app"`.
- der/die/das colours (`text-der`, `text-die`, `text-das`) are used only for grammatical gender;
  correct/incorrect use `correct`/`wrong` tokens plus an icon.
- Business logic stays in engine/server; components render and emit events. Answers are checked with
  `@sprachanker/engine` for instant feedback; the server re-checks and stores its own outcome.
- Every screen works on phone width (375 px) and desktop; test both in Playwright.
- Tests live in `test/` and run in a browser (happy-dom on an origin no server listens on, preloaded
  by `bunfig.toml`; `bun run test` here, also from the root): render with `test/render.tsx` — the
  query cache filled (settings empty unless given), a memory router when there are links; a test
  that makes a request fails (`test/dom.ts`). Logic goes to the engine or to pure modules and is tested there;
  a screen's test checks what it shows and what it asks for.
- Shared pieces, not copies: dates and numbers through `ui/format.ts`; a row that opens something is
  `ListRow`, a list of earlier items `HistoryList` (newest first, one open at a time); panels are
  `Panel`, side panels `SideSheet`, empty pages `EmptyState`; a waiting button is `<Button loading>`;
  a setting on or off is `CheckRow` (a lone checkbox `Checkbox`, ui/components), what is rarely changed
  is under one `Disclosure` ("Advanced") per tab, tabs look as `SectionTabs`; text fields are the ui
  `Input` and `Textarea` (a gap inside a sentence aside);
  cached lists take a new item through the pure updaters in `api/cache.ts` (tested).
- Respect `prefers-reduced-motion`; touch targets ≥ 44 px on touch screens: the Button component
  does it (`pointer-coarse:min-h-11`), other tappable elements add `pointer-coarse:min-h-11`.
- Screen key handlers leave Space and Enter to a focused button, link or slider.
- Model output is Markdown rendered with markdown-it (`html: false`), never raw HTML.
- Optional features (today: `llm/`) live in their own folder; screens receive them as props/slots, so the
  folder can be removed with its mount points: the settings page and the router, which passes
  `lessonAssistant` (llm/lesson-assistant.tsx) as the player's slots (header, explain, spoken, practice) and `wordAssistant`
  (llm/word-example.tsx) as the reviewer's (study/slots.ts) and `examAssistant` (llm/exam-assistant.tsx)
  as an exam run's (exams/slots.ts). Nothing in `lesson/`, `study/` or `exams/` imports `llm/`.
- Feature folders (`lesson/`, `exams/`, `study/`, `courses/`, `notebook/`) never import each other:
  what they share is in `ui/`, `api/`, `library/`, `exercises/`, `audio/` or `word/` (Anki's reviewer,
  `study/session.tsx`, is shared on purpose with the lesson's Words step); `api/` imports none of them
  (dependency-cruiser `web-features-apart`, `web-api-below-features`).
