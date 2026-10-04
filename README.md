# SprachAnker

**Self-hosted AI language tutor.** Install real courses into a local library, study them in one clean
interface on your computer and phone, and practise with spaced repetition, speech checks and any LLM you
choose — local (LM Studio, Ollama, built-in llama.cpp) or cloud.

> Status: specification phase. See [`docs/spec/`](docs/spec/README.md).

## Idea

- **Real courses, not generated ones.** Importers download courses for your personal use (e.g. Deutsche
  Welle "Nicos Weg", Deutsch im Blick) and present them in a single consistent player.
- **What courses lack:** checked speaking instead of self-rating, flashcards (FSRS) for every word you meet,
  an error log by grammar rule, explanations in your own language, LLM scenes within what you already know.
- **Everything is recorded.** Every answer, recording and conversation — compare attempts, see progress
  and regressions, practise weak spots.
- **Private by design.** A desktop app that is also your server. Phones use it as a web app over your
  network or Tailscale. No accounts, no telemetry.

First language pair: Russian → German. The design is language-agnostic; UI in English, Russian, German.

## Content and licences

The repository contains code, importers (lists of public URLs) and our own learning content. It never
contains third-party course material. Closed-licence courses are downloaded by each user for personal
use; open-licence courses are shown with attribution.

## Licence

MIT — see [LICENSE](LICENSE).
