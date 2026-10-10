# SprachAnker specification

| File | Content |
|---|---|
| [00-vision.md](00-vision.md) | Goals, users, scenarios, scope, non-goals, legal position |
| [01-domain.md](01-domain.md) | Domain model: catalog, course, lesson, exercise, card, profile, run, event |
| [02-course-format.md](02-course-format.md) | Library layout, manifest, keys, canonical/locale/enrichment formats |
| [03-providers.md](03-providers.md) | Importers: DW (Nicos Weg in 19 languages, Deutschtrainer), COERLL Deutsch im Blick, Lingust, VOA (two courses); the provider contract; Leben in Deutschland planned |
| [04-engine.md](04-engine.md) | Lesson composition, exercise checking, learner model, SRS |
| [05-data-model.md](05-data-model.md) | Data root, SQLite schemas, event log, migrations, export |
| [06-server.md](06-server.md) | Server API, profiles, network and HTTPS, sidecars, CLI, security |
| [07-llm.md](07-llm.md) | LLM providers, tasks, conversations, tools |
| [08-speech.md](08-speech.md) | Speech recognition and synthesis |
| [09-ui.md](09-ui.md) | Screens, layouts, design system, i18n |
| [10-quality.md](10-quality.md) | Architecture enforcement, fixed technical choices, testing, CI, docs |

Work not yet built: [../plan.md](../plan.md). How the parts fit together:
[../architecture.md](../architecture.md).

Supporting research (facts about each source, used by its importer): [../research/](../research/).

**Level of detail.** The spec fixes decisions that are expensive to change later: keys, stored formats,
the event log, module boundaries, security basics. Everything else (exact endpoints, UI details, limits,
heuristics) is written here when it is built.

Conventions: "MUST/SHOULD/MAY" as in RFC 2119. "Later" marks deliberately postponed scope.
Examples use German as target language and Russian as the learner's language, but nothing in the
design may assume this pair.
