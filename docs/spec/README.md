# SprachAnker specification

| File | Content |
|---|---|
| [00-vision.md](00-vision.md) | Goals, users, scenarios, non-goals, constraints, legal position |
| [01-domain.md](01-domain.md) | Domain model: catalog, course, lesson, exercise, card, profile, run, event |
| [02-course-format.md](02-course-format.md) | Library layout, manifest, blobs, canonical/locale/enrichment formats, keys |
| [03-providers.md](03-providers.md) | Importers: DW Nicos Weg, Deutsch im Blick, Starter English, exams |
| [04-engine.md](04-engine.md) | Lesson composition, exercise types and checking, learner model, SRS, decks, images |
| [05-data-model.md](05-data-model.md) | Data root, SQLite schemas, event log, migrations, backups, export |
| [06-server.md](06-server.md) | Server API, profiles, network and HTTPS, process supervision, desktop shell, CLI |
| [07-llm.md](07-llm.md) | LLM providers, task routing, prompts, conversations, built-in runtime, evaluation |
| [08-speech.md](08-speech.md) | Speech recognition and synthesis |
| [09-ui.md](09-ui.md) | Screens, layouts, design system, i18n, onboarding, progress |
| [10-quality.md](10-quality.md) | Architecture enforcement, testing, CI, documentation rules |
| [11-roadmap.md](11-roadmap.md) | Stages with deliverables and acceptance criteria; how to run a stage |

Supporting research: [../research/dw-nicos-weg.md](../research/dw-nicos-weg.md).

Conventions: "MUST/SHOULD/MAY" as in RFC 2119. "Later" marks deliberately postponed scope.
Examples use German as target language and Russian as the learner's language, but nothing in the
design may assume this pair.
