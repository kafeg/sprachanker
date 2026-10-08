# SprachAnker

**Self-hosted language tutor.** Install real courses into a local library, study them in one clean
interface on your computer and phone, and practise with spaced repetition, speech recognition and any
LLM you choose — local (LM Studio, or any OpenAI-compatible server on your network) or cloud
(OpenRouter, Gemini, Groq, Claude Code, Codex).

> Status: in use by its authors; the desktop app is planned. See [`docs/plan.md`](docs/plan.md) for
> what is next and [`docs/spec/`](docs/spec/README.md) for how it works.

## What it does

- **Real courses, not generated ones.** Importers download courses for your personal use — Deutsche
  Welle "Nicos Weg" (A1–B1, explained in 19 languages) and Deutschtrainer, Deutsch im Blick, and
  English courses from Lingust and VOA — and show them in one player.
- **Lessons** as steps: the episode, words, grammar and culture pages, exercises checked as you go,
  speaking with recognition (whisper.cpp on your machine), AI practice (writing, scenes, going over
  mistakes, a tutor that knows the lesson).
- **Cards** for every word you meet, studied as in Anki (FSRS).
- **A Notebook** of every pass: answers, recordings, explanations and checks, study days.
- **Private by design.** A local server, used in the browser on the same computer (phones over
  Tailscale are planned).
  Profiles keep people's learning apart. No accounts, no telemetry; your data stays on your machine
  except what you send to the AI provider you chose.

UI in English, Russian and German.

## Running it

```
bun install
bun run build:speech     # optional: whisper.cpp for speech recognition (needs cmake)
bun run build:cli        # the `sprachanker` binary with the web app inside
apps/cli/dist/sprachanker serve --data ~/SprachAnker
```

Open the address it prints, choose your language, make a profile, and download a course from
Courses → Available. Developers: `CLAUDE.md` and `docs/architecture.md`.

## Content and licences

The repository contains code, importers (lists of public URLs) and our own learning content. It never
contains third-party course material. Closed-licence courses are downloaded by each user for personal
use; open-licence courses are shown with attribution.

## Licence

MIT — see [LICENSE](LICENSE).
