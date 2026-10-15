# apps/web

React UI for desktop and phone screens (an installable PWA).
May use `schema`, `engine`, and a type-only import of the server's `AppType` (Hono RPC).

## Layout

```
apps/web/src/
  main.tsx         # the entry: query client, i18n, the router
  fonts.css        # the faces bundled from @fontsource (Fira: Latin, Cyrillic, Greek; Arabic, Devanagari; Chinese: the system's)
  routes/          # router.tsx (code-based TanStack Router: the gate, then the pages, each but Courses and
                   # Exams loaded when first opened — page.tsx: lazy pages, a failed page's error): courses (/, /downloaded, /catalog), review (/review,
                   # /review/decks — decks.tsx: a row a deck, its menu's "Export to a file" (made ready, then downloaded) —, /review/words — words.tsx), exams (/exams, /exams/downloaded,
                   # /exams/catalog), course (its map; an optional feature's button among its actions and the panel it opens: its `extra` slot), settings, storage (Settings → General's storage),
                   # runs (the lesson and exam runs with the assistant's slots)
  courses/         # course cards (on library/card), the pair and course filters (filterCourses, pure), the course page's hero (progress, source, stats, integrity, sync)
  lesson/          # lesson player: player (loads the lesson and its run, shows the step), use-flow (the flow over the plan: steps, moving,
                   # starting, resuming, completing), frame (plan, header, reference), use-run (the run in the query cache + its events, sent through
                   # api/run-events), plan, overview, words-step, steps (reading pages, the step bar), exercise-step (its rules in use-exercise,
                   # Enter in enter-key), practice-step, summary (the steps marked, going over mistakes: a slot), reference; slots.ts: what optional features add
  study/           # Anki's reviewer, shared by Review and the lesson's "Words" step: card (the card widget,
                   # its recording and autoplay, "Example"), session (counts, Show answer, ratings, undo; one action
                   # at a time; a rating with the time its card was shown), reviewer-keys (Anki's keys: a
                   # pure mapping, tested), more-menu; decks (deck names), deck-import (a deck file previewed — an .apkg named, its languages; one exported here, .sprachanker-deck — the server tells which —, what it holds and where it goes —, imported), deck-audio (a deck's words
                   # read aloud by the server: who reads them, generate, remove, regenerate, progress, stop; a deck taken: its line), examples (a word's own and the AI's: one line each, played; the card shows one at a time), deck-link (a card's way to its deck: audio, examples to make; an icon in its corner on a phone), word-sheet (a word with cards in full: forms, faces, answers), guide (how review
                   # works: the method, buttons, card types, actions, keys), review-settings (Settings →
                   # Review: daily limits, retention, card types, how it works); slots (what optional features add: a deck's AI examples on cards and under decks)
  exercises/       # one renderer per exercise type (index.tsx; speech: the speaking ones); dnd (chips
                   # placed by drag or tap); item-card (an item with its prompt, media and renderer:
                   # answered in the player, read-only in the Notebook); no API calls
  exams/           # exams: card (the list's), page (an exam's: modes, the latest mock exam, sources),
                   # player (a run a question at a time: mock exam timed, nothing checked before hand-in; practice as a lesson — Check in the step bar, then Next, Skip;
                   # run-state: the questions' states and tally, the place kept, the time left),
                   # navigator (the run's plan by Teil), result, catalog (a compact list, a question
                   # opened with its answer), state-select, questions (a question as an exercise, the
                   # latest answers, questions by Teil), teil (a Teil's header and material; a question's
                   # card), recording (a mock exam's: plays limited), rating (an open answer by its
                   # criteria, a proposal shown chosen), slots (the AI's proposal, the conversation), use-exam
  notebook/        # the Notebook: page (progress, the study days' calendar with totals, every module's
                   # standing — standing.tsx shows them alike, a module adding only titles, links and
                   # pictures: pictures.tsx, bars over the span), lesson (passes), pass (in full), compare,
                   # exam (an exam's runs and questions as they stand), review-day (a deck's day: its answers), mark
  library/         # what feature folders share: card (a course's or an exam's, an offer, the publisher),
                   # hero (their page's head), tab-page (Courses' and Exams' tabs), download, upkeep, bundle (a course to a file and back),
                   # course-gone (a course or exam not on this computer: its offer to download again),
                   # reset-progress, exam-address, item-history (an item across passes), spoken-check,
                   # understanding-text (a text, its glossed words — glossed.ts —, its questions answered), mistakes-review (mistakes gone over by type), practice-item (an item the assistant set)
  api/             # client (Hono RPC, hono/client; no codegen) + TanStack Query hooks by area: settings
                   # (the app and its addresses, the profile's settings), courses, downloads, cards, decks (imported; deck files
                   # exported and imported; a deck's words read aloud, polled while read), notebook,
                   # recordings, speech, exams, session (profiles, signing in and out, devices, a profile's file), files (sent with progress, downloaded); outbox (events in
                   # order, retried, a refused batch dropped; tested), run-events (a lesson's or exam's
                   # run's events over it: per profile, the server's outcomes, on page close); edition:
                   # the edition a course is shown in; cache: pure cache updates
  app/             # the app around the screens, with data: shell (navigation — an optional feature's section
                   # after the modules —, cards due, downloads, the profile chip — profile-chip), language-switch (who-is-studying's, kept on the device;
                   # Settings → General's, kept in the profile), who-is-studying (five tiles to a page; "New
                   # profile" starts the onboarding; profile-import: a profile file sent, the new one), onboarding (name and colour — the profile made at its
                   # Next —, the AI step a slot from the router, speech, tour — app/tour.tsx: the sections,
                   # an icon and a line each), name-colour (the onboarding's and Settings → Profile's),
                   # profile-settings (profile-export: its file), device-name, about, other-devices (Settings → General's addresses to copy or scan; the sidebar's "On a phone"), preferences (language, theme, playback speed),
                   # experimental (courses ready for learning always, experimental ones turned on), experimental-settings
  llm/             # AI assistant: settings (AssistantSetup: provider-cards, key-state, model-list over the
                   # pure model-filter; LM Studio), "Why is this wrong?", tutor (the chat view; the lesson's
                   # header panel — History: tutor-history), going-over (the run's mistakes, in the summary), tutor-section (the Tutor
                   # section: its chats, a chat and its language — a new one's chosen in a SelectField), understanding (Reading and Listening, done as an exercise: what it is, the text or its recording in the course's player, Check in the step bar, then what it was about), writing (a message answered, Check in the step bar), talk (Speaking: a monologue card or a role-play said line by line, Check in the step bar), dialogue (the Dialogue: goal card, lines read aloud, summary — no step since Speaking, kept for the Tutor section, plan); practice-next (a step's "Another version": the course's next variant, none left: no button), course-practice (the course page's: a button among its actions opening what its lessons have, made for every lesson — a job's progress, Stop); dialogue-line: a line said and heard, or typed, spoken-check (the AI's check under an answer said aloud), word-examples (a deck's: on a card, under a deck — the slots); selection-translate (the selection bar's "Translate": the words learnt shown with their translation at once, kept in Finds, their audio made after — a spinner —, then played); exam-assistant (an exam run's slots): exam-rating ("Propose a
                   # rating"), exam-part (a speaking part said from its script: the examiner and the partner read aloud, the learner's places said in turn, hints in practice only);
                   # settings-section (Settings → AI assistant), lmstudio-section, prompts-info (where it
                   # works; the prompts under Advanced), prompt-view (a request as sent), context-meter
                   # (the tutor's context gauge), assistant-label (which AI answers); parts.tsx: chat
                   # bubbles, header, pending exchange ("Thinking…" with the seconds taken), composer, start
                   # prompt, the answer box, errors (with Retry and the wait a provider asked for; errors.ts: an LLM error in words, a provider's own where it has them, and what
                   # a provider's setup lacks); api.ts (the tasks), setup-api.ts (route, providers, models)
  i18n/            # catalogs <code>.json (ICU; en bundled, the others by catalogs.ts, loaded when chosen; one not loading: no change, a reload)
  ui/              # presentational only (no API, no features): design tokens in styles.css, line-breaks (where course text may break), shadcn/ui
                   # components (ui/components), rich-text (model Markdown), page (pages, empty states, back
                   # links), media, format (dates, numbers, durations), panel, history
                   # (rows that open, lists of earlier items), side-layout (a page with a side column: the
                   # lesson player's, an exam run's; the column's head), plan-list (a plan's headings and rows), progress-ring, side-sheet, qr-code (uqr's modules as SVG), chip, section-tabs (a section's tabs as links, and a page's own — Settings' — in their look), video (the episode: HD by
                   # default, SD switch, speed, subtitles toggle, its text; exercises showing it too),
                   # playback (one medium at a time, the speed button, useClip for short clips), sections (a course page's sections; CourseSections in course-html shows them as cards), activity-calendar (a
                   # year of days as squares), bar-chart (bars over time, each a button showing its value; a bar across), stat-tile, search-field (a page's search), checked-text (a model's check: verdict, the text
                   # corrected, corrections), step-dot (an exercise's mark), step-buttons (a step bar's Back and Next: the lesson's and an exam
                   # run's), avatar, choice (segmented), select-field (a labelled select), check-row (a setting on or off), option-card (one
                   # of a few options as a card), disclosure (folded: "Advanced"), confirm (an action that
                   # cannot be undone; ConfirmButton: a button asked first), flags, error-text (an API error in words), target-lang (`lang` of
                   # the course's language), window-title, pointer (a finger or a mouse: the system's
                   # picker on touch), job-row (a server's job: progress, Stop, why it failed), direction, utils (cn)
  audio/           # recording oneself: recorder (MediaRecorder — what plays stopped as a take starts —, the microphone of this device, its
                   # loudness), wav (a take as 16 kHz WAV; a course's recording as 24 kHz, its silence cut, for the voice for words),
                   # mic-button (disabled with the reason), dictate (a microphone beside a text box: what was heard goes into it), take-button,
                   # context (the speech host the router provides: save, src, recognition — renderers call no API; use-speech-host makes it),
                   # speech-settings (Settings → Speech; SpeechSetup is also the onboarding's step); reading aloud: speak.ts (what is said, by
                   # which voice; pure), speaker.ts (a part's recording as it is, else each part by the server's engine — Piper or Qwen3-TTS —
                   # or the device's voices, one text at a time; a dialogue's second speaker by another voice; a part marked `words` by the voice
                   # for words), listening (a text line by line: pause, on, again), speak-button, selection-menu (words selected anywhere: a bar by them that reads them aloud; an optional feature's actions beside, what they show in a line under them), read-by (who reads a language, named),
                   # read-aloud-settings (Qwen3-TTS alone: its state) with qwen-voices (models, each language's speaker; voice-pick: a language's voice and "Listen";
                   # voice-names: a server voice's name, pure; a voice's gender: the engine's speech/voices) and word-voice (the voice for words: its
                   # Base model, each language's recording taken — the first proposed by itself —, "Listen", "Another recording"); download-row (a model
                   # or voice the server downloads), read-languages (the languages read aloud), samples ("Listen"'s sentences and words; pure), in-use (the in-use mark)
  word/            # a word as shown: gender colouring; tones (ratings and counts in our hues), time
                   # (intervals, next due)
apps/web/public/   # favicon.svg (the icon master: speech bubble with an anchor), PNG icons, manifest
apps/web/scripts/  # icons.ts: renders the PNG icons from favicon.svg (needs rsvg-convert)
```

shadcn components are added with `bunx --bun shadcn@<version> add <name>` (components.json: `@/ui`).

## Rules

- No user-facing string outside i18n catalogs (`src/i18n/<code>.json`, ICU; a file is a language, each checked
  by `test/catalogs.test.ts`, read from the folder in tests); language names from `Intl.DisplayNames`.
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
  `Panel` (its look alone, for lists and folded sections: `panelClass`), side panels `SideSheet`, empty pages `EmptyState`; a waiting button is `<Button loading>`, a link that looks as a button `<Button asChild>`;
  a setting on or off is `CheckRow` (a lone checkbox `Checkbox`, ui/components), one value of a list `SelectField`, one of a few
  options shown as cards `OptionCard`, a model or voice the server downloads `DownloadRow` (audio/); a behaviour with a good
  default is not a setting (say it in a line instead), tabs look as `SectionTabs`; text fields are the ui
  `Input` and `Textarea` (a gap inside a sentence aside);
  cached lists take a new item through the pure updaters in `api/cache.ts` (tested).
- Right to left: logical utilities and styles only (`ms`, `pe`, `start`, `text-end`; `test/ui/logical.test.ts`), icons
  along the reading direction `rtl:-scale-x-100`, `arrowStep`, a course's language `{...inLang(lang)}`.
- Respect `prefers-reduced-motion`; touch targets ≥ 44 px on touch screens: the Button component
  does it (`pointer-coarse:min-h-11`), other tappable elements add `pointer-coarse:min-h-11`.
- Screen key handlers leave Space and Enter to a focused button, link or slider.
- Model output is Markdown rendered with markdown-it (`html: false`), never raw HTML.
- Optional features (today: `llm/`) live in their own folder; screens receive them as props/slots, so the
  folder can be removed with its mount points: the settings page, the router (`examplesAssistant`, the course page's `extra`, the selection bar's `extra`, the
  reviewer's and Decks': study/slots.ts; the Tutor section's pages and the shell's `extra` entry) and routes/runs.tsx (`lessonAssistant` as the player's slots, `examAssistant`
  as an exam run's: exams/slots.ts). Nothing in `lesson/`, `study/` or `exams/` imports `llm/`.
- Feature folders (`lesson/`, `exams/`, `study/`, `courses/`, `notebook/`) never import each other:
  what they share is in `ui/`, `api/`, `library/`, `exercises/`, `audio/` or `word/` (Anki's reviewer,
  `study/session.tsx`, is shared on purpose with the lesson's Words step); `api/` and `library/` import
  none of them (`web-features-apart`, `web-api-below-features`, `web-library-below-features`).
