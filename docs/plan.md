# Plan

What is left to build, in order. What is built is described by the spec (`docs/spec/`) and the code;
how it fits together, by `docs/architecture.md`. Each item names the spec files it touches.

## How we work

1. **Plan** (before code): goals, modules touched, files, what is reused, risks, how acceptance is
   checked, the details the spec leaves open. Larger than about three sessions → split it. The owner
   approves. New screens or redesigns: rendered mockup options first, the owner picks.
2. **Implement** in small commits to `main`, each with tests; `bun run check` and `bun run e2e` green
   (check their exit codes, not a piped tail).
3. **Demo**: commands to run, what to look at, on the Mac (phones: item "Phones").
4. **Review checklist**: engineering principles (root CLAUDE.md) · boundaries · tests · spec, this plan
   and CLAUDE.md current · no third-party content · i18n keys complete.
5. **Stop and report after every item**: what was built, what was learned, open problems, an honest
   view of direction and remaining scope, proposed spec/plan edits, the next item's plan.

## MVP boundary

**MVP = what two people need for a week of real study**: courses installed from the interface, the
lesson player, cards and review, two profiles on Mac and phones, speech checks, Leben in Deutschland,
LLM via external providers — `sprachanker serve` with browser/PWA access. Do not build post-MVP features
early. Built early at the owner's request: courses beyond Nicos Weg A1 (DW in Russian, English and
German; Deutsch im Blick and four English courses importable with the CLI) and the LLM features.

Past the MVP's scope (owner, 2026-10-08): what is built goes beyond it; before more features, the
architecture is made coherent and its debt paid (item 1). Phones come when convenient: Tailscale is
known to work; the desktop browser is enough meanwhile.

Focus (owner, 2026-10-07): German — the onboarding's language pair filters Courses; every provider is
offered (03, "Offered in the app").

## Next, in order

### 1. Architecture and debt (owner, 2026-10-08)
From the architectural review of 2026-10-08 (five areas: data and engine, server, web, AI and speech,
the system). Goal: a coherent architecture — bugs fixed, duplicated and dead code gone, shared
contracts in their owning module, the risky logic tested, the docs describing what is. Each step its
own commits with tests; behaviour stays unless a step says so. Done: the bugs (PINs removed, one
supervisor for local engines, web tests sealed from the network, prompt templates, daily database
copies, one connection per profile migrated at start, error codes, audio body limits); history
that survives content changes (DW keys kept by source id, resume and snapshots by exercise key,
every stored event shape on record); `llm_verdict` a union by task with typed results, the AI's
stored answers in `schema` (Notebook no longer imports `llm`); events typed by their type
(`TypedEvent`, no casts in the engine, one undo rule); step ids and practice kinds from one list; error codes one list shared by server and web, each
with its words (a spoken check stays matched to its answer by what was heard: it is asked before the
answer is recorded, on Check).
1. **Server AI services.** One path for a structured task kept as a verdict (model, stopwatch, run,
   clean, append) used by writing, speaking, examples, scenes; one corrections cleaner; explain on
   the lesson contexts; the prompt preview built by the client that sends (CLI providers show what
   they get); tool instructions added only when tools go; `scene_setup` in Settings → Prompts; Codex
   run without its shell where possible, otherwise the risk written in 07.
2. **Web.** The lesson run's outbox a module with tests and the run read through the query cache;
   rules out of components into the engine (scored, answer complete, right at attempt n, a spoken
   answer's transcript); typed settings with their defaults in one place; query keys from one
   factory and cache helpers outside `llm/`; duplicates merged (audio clip playback, stat tiles,
   error bodies, `Intl` formatters, the course edition lookup); the reviewer's keys and More menu out
   of `session.tsx` with tests, actions blocked while one is pending; feature folders without
   two-way imports; AI practice steps known before the flow resumes; `speech_repeat` rendered.
3. **Course providers.** A `CourseProvider` contract in course-kit (id, series, offers, import) with
   one contract test over every provider; exercises drafted typed (no `as never`); `Unmapped`,
   unknown exercises and the Cyrillic/Latin split shared in course-kit.
4. **Docs.** `architecture.md` and `README.md` as the system is; CLAUDE.md layouts exact and checked
   (a separate short "Planned" list), stale lines gone; spec drift fixed (04, 05, 06, 08, 09, 10's
   fixed choices only for what is used).
- **Accept**: every step's tests; `bun run check` and `bun run e2e` green; a sweep finds no
  duplicated helper or dead export the review named; the owner's lessons and cards unchanged after
  the migrations.

### 2. Speech: synthesis (owner's decisions, 2026-10-08)
Specs: 08, 06, 09. Recording, recognition and the AI's check of answers said aloud are built (08).
- **Synthesis**: the device's voices by default (Web Speech API; Apple's enhanced voices); in the
  settings Piper or Qwen3-TTS on the server instead. Used for words without a recording, AI examples
  (a play button), tutor and scene replies (read aloud on request or automatically).
- Settings → Speech gains: synthesis engine and a voice per language with "Listen", speed, reading AI
  replies aloud.
- **Accept**: on the Mac; the iPhone in item "Phones".

### 3. Exams (owner, 2026-10-08)
Specs: 02, 03, 06, 09.
- **An "Exams" section of its own** beside Courses, built like it (tabs: mine, downloaded,
  available; the pair filter): an exam is got and installed from the interface like a course, from
  its provider, and practised in an exam player — pools, a timer, the test as the real one runs it,
  practice of wrong answers, results in the Notebook.
- **Leben in Deutschland** first: provider `bamf-lid` (BAMF's official question catalogue, PDF),
  the federal state's questions (the profile's state).
- **Find the other practice exams** for German at A1, A2, B1 (official free model tests — Goethe,
  telc, ÖSD and others; which ones, from where and under what terms is the item's research) and add
  those that can be imported; English exams later, with the English courses.
- **Accept**: a timed Leben in Deutschland exam with Berlin questions end to end, from the Exams
  section; at least one A1–B1 model test, if one is importable; results in the Notebook.

### 4. Notebook: more pictures (owner's request, 2026-10-07)
Specs: 04, 05, 09.
- Reviews and new cards per day, the share remembered over time, words by state (new, learning,
  known), lessons and courses done; a review day opens to its answers as a lesson pass does.
- Time spent: card answers carry no time yet (`CardReviewPayload`); measuring it is part of this item.
- **Accept**: engine tests of the derivations; e2e on desktop and phone.

### 5. Phones (owner, 2026-10-08: functionality first, phones after)
Specs: 06, 09.
- The app on the owner's and his wife's iPhones: HTTPS through Tailscale (`tailscale serve`, 06) set
  up and described, installed as a PWA, signing in on a phone (device token); the server accepts the
  tailnet's host name (today only localhost, `.local`, IPs and the machine's name: a `*.ts.net` Host
  is refused with 421).
- Everything built so far checked on the iPhone: lessons, review, the Notebook, profiles, the AI;
  speech — the microphone and recording (built), recognition and synthesis (item 1) — in Safari and
  the PWA; layouts at phone width; what breaks is fixed here.
- **Accept**: a lesson with speaking and a review session done on each iPhone through Tailscale.

### 6. MVP acceptance
- The owner's demo of cards, review and the Notebook on the Mac (open since 2026-10-07).
- The owner and his wife use the MVP for at least one week of real study on phones and Mac; their
  findings decide the order of the work after the MVP.

## Open items in built areas
Taken along when an item above touches the area, or on request.
- Library (02, 03): key map per provider (keys stay when the source reorders), series manifest with
  `contentVersion`, `normalise <series>` from `raw/` offline, `verify` checks for manifest hashes and
  rule ids; content updated while a run is active ends the run (05). A word the source leaves without
  a translation in one lesson takes the translation its lexeme has elsewhere in the same edition (DW:
  Persian A1 "alt", German A2 "der Spinat"; seen in the 2026-10-08 audit of all Nicos Weg editions).
- Engine (04): compose with the selfrate upgrade and enrichment.
- Server (05, 06): export/import of a profile, structured logs.
- Lesson (09): the lesson's review back, together with going over mistakes — one analysis across the
  exercises (answers, speech verdicts, writing, scenes, mistakes) (owner, 2026-10-08).
- Review (09): the course map's can-do list; a word anywhere in a lesson
  opens its sheet (09, "word sheet": forms, translation, audio, examples from lessons met, answers,
  "add to cards").

## After the MVP
Order decided by the week of use.
- **Enrichment and rules** (02, 04, 07): `enrich check`, the rules registry for A1, A1 enrichment chapter
  by chapter (rule tags, contrastive notes, speaking, scenes), mistakes by rule, rule mastery, weak spots,
  "Practise this", can-do list. Accept: A1 units 0–2 enriched and reviewed; a practice set from du/Sie
  mistakes runs end to end.
- **Anki decks and word images** (04): `packages/anki-export` (`.apkg` export and import, stored decks),
  word images. Decks are got like courses (owner, 2026-10-08): Review → Decks lists decks to download
  (a catalogue of shared decks; AnkiWeb asks for an account after a few searches, so its decks come
  by link or as an `.apkg` file) and the profile's own; a downloaded deck is taken and left like a
  course's. Accept: an exported A1 deck opens in Anki with audio; an imported deck links matching words.
- **Books** (owner, 2026-10-08): free books downloaded and read like courses — a library of books to
  download (public-domain sources such as Project Gutenberg; the sources and their terms decided in the
  item's plan), "My books" with the place read; a reader with the translation beside (by sentence or
  paragraph), a word tapped opens its sheet (dictionary: the course's words, else the model) and goes
  to cards, the AI to explain a sentence or the grammar, and read aloud (speech: a word or sentence
  heard, for its pronunciation). Accept: a German book
  downloaded, read on Mac and iPhone with translation, words added to Review.
- **More sources**: B1 glossary, Deutsch im Blick interviews, Starter English (03).
- **Desktop app** (06, 09): Tauri shell, first-run wizard (incl. LM Studio), network options with QR,
  signed bundles for macOS then Windows and Linux, auto-update. Accept: fresh machine → lesson 1 in
  under 30 minutes (without the course download); headless `serve` works on a second machine.
- **Later**: missions, unit reviews, in-lesson adaptivity, LLM verdicts for `respond` (`check_answer`),
  per-task LLM routes, handoff to other assistants, LLM golden tests, FSRS for Leben in Deutschland,
  the FSRS optimizer in the Review settings (once there is history), badges, a local CA for LAN HTTPS,
  cloud speech, pronunciation by sounds
  (researched 2026-10-08 and set aside by the owner: a local phoneme recogniser against espeak-ng
  references is unreliable for German learners without annotated learner speech, and nothing ready
  names their wrong sounds; a prototype on the owner's phrases would decide), offline use and push
  notifications, `.apkg` with scheduling,
  Docker image, project website, native mobile via Tauri.
