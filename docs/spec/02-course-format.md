# 02 — Course format and library

This file defines the **stored content formats**: library layout, manifest, keys, canonical and locale
files, rules registry, enrichment, and the normalisation contract every provider follows. zod schemas in
`packages/schema` implement it; JSON Schemas are generated from them (10).

## Conventions

| Topic | Rule |
|---|---|
| Encoding | UTF-8, Unicode NFC; JSON pretty-printed with sorted keys (deterministic output) |
| Hashes | sha256, lowercase hex; canonical JSON for hashing = RFC 8785 (JCS) |
| Generated ids (learner data) | ULID |
| Edition id | `<source>-<target>` (`ru-de`, `en-de`, `de-de`) |
| Time | durations in seconds; timestamps in DB Unix ms, in files ISO 8601 UTC |
| Blob references | `blob:sha256:<hash>`; MIME and size live in the manifest |
| Text language | target-language strings live in **canonical** files; learner-language strings only in **locale** files, at the same key path |
| HTML | only in fields named `*Html`, sanitised to an allow-list (provisional until stage 1: p, br, b, strong, i, em, ul, ol, li, table, thead, tbody, tr, th, td) |
| Format versions | integer `format` in every file type; bumped on breaking change; additive optional fields do not bump it |

## Library layout

The library is a folder in the data root (05). It contains **only** downloaded content and data derived
from it — no learner data, no enrichment. Each series folder is self-contained and can be archived,
moved, or restored by copying.

```
<data-root>/library/
└── dw.nicos-weg/                               # series id
    ├── course.json                             # manifest
    ├── blobs/sha256/ab/cd/abcd…                # binaries, content-addressed
    ├── raw/<edition>/<course>/…                # extracted source data as fetched (provider-specific)
    ├── canonical/<course>/course.json          # course index
    ├── canonical/<course>/lessons/<NN>-<NN>.json
    ├── canonical/<course>/exams/<slug>.json
    └── locale/<edition>/<course>/{course.json, lessons/<NN>-<NN>.json, exams/<slug>.json}
```

## Keys and identity

| Key | Pattern | Example |
|---|---|---|
| Series | `<publisher>.<series>` | `dw.nicos-weg` |
| Course | `<series>/<course>` | `dw.nicos-weg/a1` |
| Unit | `<course>/u<NN>` | `dw.nicos-weg/a1/u00` |
| Lesson | `<course>/<NN>-<NN>` (unit-lesson) | `dw.nicos-weg/a1/00-01` |
| Exercise | `<lesson>/ex-<NN>` (source order); ours: `<lesson>/x-<NN>` | `dw.nicos-weg/a1/00-01/ex-03` |
| Item | `<exercise>#<n>` (1-based) | `dw.nicos-weg/a1/00-01/ex-03#2` |
| Option | id inside an item: `a`, `b`, `c`… in canonical order | option `b` |
| Exam | `<course>/exam-<slug>` | `bamf.lid/lid/exam-test` |
| Exam item | `<exam>/q-<id>`, id unique within the exam | `bamf.lid/lid/exam-test/q-001`, `…/q-be-01` |
| Goal | `<lesson>/goal-<n>` or `<course>/goal-<slug>` (ours) | `dw.nicos-weg/a1/00-01/goal-1` |
| Vocab occurrence | `<lesson>/v-<lemma-slug>` | `dw.nicos-weg/a1/00-01/v-frau` |
| Lexeme | `lex:<lang>:<lemma-slug>:<pos>[:<gender>]` | `lex:de:frau:noun:f` |
| Rule | `<lang>.<area>.<slug>` | `de.greeting.du-sie` |
| Scene | `<series>/scene-<slug>` | `dw.nicos-weg/scene-neighbour-morning` |

- `lemma-slug`: NFC, lowercase, spaces → `-`, punctuation removed, umlauts and ß kept. `pos` and
  `gender` values and how they are derived from sources are fixed in stage 1.
- Keys are built and parsed only by `packages/schema/src/keys.ts`; fingerprints and `contentVersion`
  are computed by `packages/course-kit`.
- **Keys must not shift when the source changes order.** Providers keep a **key map** in the repository
  (`courses/<provider>/provider/keymap.json`: our keys ↔ source ids per edition — ids only). Known ids
  keep their keys; new source items get new keys; removed keys are never re-used. Source ids are
  stored in locale files (`sourceId`), so adding an edition never changes canonical files.
- **Fingerprint** of an exercise = sha256(JCS of its canonical object without `fingerprint`); identical
  across editions of the same content.
- **contentVersion** of an edition = sha256 over the sorted `path:sha256` list of the course's canonical
  files and that edition's locale files.

## Manifest `course.json`

```jsonc
{ "format": 1, "series": "dw.nicos-weg", "provider": "dw-nicos-weg", "providerVersion": "0.3.0",
  "title": "Nicos Weg",
  "licence": { "id": "proprietary-personal-use", "attribution": "Deutsche Welle", "url": "https://…" },
  "courses": [ { "id": "a1", "kind": "course", "level": "A1", "target": "de",
                 "editions": [ { "id": "ru-de", "source": "ru", "fetchedAt": "…", "contentVersion": "c1f0…" } ] } ],
  "files": { "canonical/a1/lessons/00-01.json": { "sha256": "…", "size": 12345 },
             "blobs/sha256/ab/cd/abcd…": { "sha256": "abcd…", "size": 7340032, "mime": "video/mp4",
                                           "sourceUrl": "https://…", "durationSec": 81 } } }
```

`kind` ∈ `course exam`. Exams of a course are listed in its course index; a stand-alone exam
(`bamf.lid`) is a course of kind `exam`. The manifest is written last, after normalise and verify.

## Canonical files (language-independent)

```jsonc
// canonical/<course>/course.json
{ "format": 1, "key": "dw.nicos-weg/a1",
  "units": [ { "key": "dw.nicos-weg/a1/u00", "order": 0, "lessons": ["dw.nicos-weg/a1/00-01"] } ],
  "exams": [],
  "goals": [ { "key": "dw.nicos-weg/a1/00-01/goal-1", "lessons": ["dw.nicos-weg/a1/00-01"] } ] }

// canonical/<course>/lessons/00-01.json
{ "format": 1, "key": "dw.nicos-weg/a1/00-01", "unit": "dw.nicos-weg/a1/u00", "order": 1,
  "media": { "video": { "sd": "blob:sha256:…", "subtitled": "blob:sha256:…" } }, "goals": ["dw.nicos-weg/a1/00-01/goal-1"],
  "pages": [ { "exercise": { "key": "…/00-01/ex-03", "type": "single_choice", "fingerprint": "…",
      "newWords": ["…/00-01/v-guten-tag"], "ruleIds": [],
      "items": [ { "key": "…/ex-03#1", "media": { "image": "blob:sha256:…" },
                   "options": [ { "id": "a", "text": "Hi!" }, { "id": "b", "text": "Guten Tag." } ],
                   "answer": { "optionIds": ["b"] } } ] } } ],
  "vocab": [ { "key": "…/00-01/v-frau", "lexeme": "lex:de:frau:noun:f", "target": "Frau",
               "gender": "f", "plural": "Frauen", "audio": "blob:sha256:…" } ],
  "unmapped": [ { "path": "raw/ru-de/a1/00-01/ex-07.json", "reason": "unknown inputType X" } ] }

// canonical/<course>/exams/<slug>.json
{ "format": 1, "key": "bamf.lid/lid/exam-test", "timeLimitSec": 3600,
  "sections": [ { "key": "…/s-general", "pool": ["…/q-001"], "draw": 30, "filter": null },
                { "key": "…/s-state", "pool": ["…/q-be-01"], "draw": 3, "filter": { "setting": "federalState" } } ],
  "items": [ { "key": "…/q-001", "type": "single_choice", "tags": { "federalState": null } } ],
  "pass": { "minPoints": 17 } }
```

## Exercise types

> **Provisional until stage 1.** Stage 1 reconnaissance confirms or revises this table before any
> checker or renderer is written.

All types share `key`, `type`, `fingerprint`, `items[]`, optional `media`, `newWords`, `ruleIds`.
Answers are compared by **ids**, never by display position; display order may be shuffled. Open
answers (translation, short writing, answering a prompt, spoken or written) are all `respond`.

| Type | Item fields (canonical) | Stored answer | Correct when |
|---|---|---|---|
| `single_choice` | `options[{id,text,media?}]`, `answer.optionIds[1]` | `{optionId}` | id equal |
| `multi_choice` | same, `answer.optionIds[n]` | `{optionIds[]}` | sets equal |
| `match` | `left[]`, `right[]`, `answer.pairs[[l,r]]` | `{pairs}` | pair sets equal |
| `order` | `parts[]`, `answer.sequence[id]` | `{sequence}` | sequences equal |
| `classify` | `categories[{id}]`, `entries[]`, `answer.map{entry:category}` | `{map}` | maps equal |
| `gap_choice` | `segments[text \| {gapId}]`, `gaps{gapId:{options}}`, `answer{gapId:optionId}` | `{gapId:optionId}` | all gaps equal |
| `gap_text` | `segments`, `answer{gapId:{accepted[text]}}` | `{gapId:text}` | normalised text ∈ accepted |
| `dictation` | `audio`, `answer.accepted[text]` | `{text}` | word diff = 0 |
| `speech_repeat` | `text`, `audio?` | `{speech}` | word diff = 0 |
| `speech_selfrate` | `text?`, `audio?` (source form; upgraded, 04) | `{rating}` | not scored |
| `respond` | `prompt?` (target language; or in locale), `audio?`, `input` (`text`\|`speech`), `rubric?{required[{id,anyOf[text]}], criteria[{id}]}`, `reference[text]` | `{text, speech?}` | rubric + LLM verdict |
| `scene` | `scene` key (enrichment) | — (conversation run) | scene goals met |
| `unknown` | `raw` path | — | not rendered |

## Locale files

Learner-language strings (titles, instructions, info boxes, translations, category labels, prompts in
the learner's language) live at the same key path as in canonical files. Tab bodies (grammar, culture,
script) are locale HTML and may mix languages.

```jsonc
// locale/<edition>/<course>/lessons/00-01.json
{ "format": 1, "edition": "ru-de", "lesson": "dw.nicos-weg/a1/00-01", "sourceId": "46381195",
  "title": "Hallo!", "synopsis": "…",
  "exercises": { "dw.nicos-weg/a1/00-01/ex-03": { "sourceId": "46381693", "instructionHtml": "…", "items": {} } },
  "vocab": { "dw.nicos-weg/a1/00-01/v-frau": { "translation": "госпожа" } },
  "tabs": { "grammar": { "title": "…", "bodyHtml": "…" } } }
```

The locale course file holds the course title, unit titles and goal texts in the same way.

## Grammar rules registry (ours)

`courses/_shared/rules/<lang>.yaml` — the only place rules are defined.

```yaml
- id: de.greeting.du-sie
  title: { en: "Informal and formal address", ru: "«Ты» и «Вы»", de: "Duzen und Siezen" }
  explanation: { ru: "…", en: "…" }        # contrastive, per learner language; markdown
  examples: ["Wie geht es dir?", "Wie geht es Ihnen?"]
```

Every `ruleIds` value anywhere MUST exist in the registry.

## Enrichment (ours, in the repository)

`courses/<provider>/enrichment/<course>/<NN>-<NN>.yaml` (+ `scenes/`). Keys and fingerprints only —
never copies of third-party text.

```yaml
format: 1
lesson: dw.nicos-weg/a1/00-01
rules: [de.greeting.du-sie]
notes: { ru: "…", en: "…" }                      # contrastive notes per learner language
exercises:
  dw.nicos-weg/a1/00-01/ex-05:
    fingerprint: "…"                             # entry is stale if it differs
    ruleIds: [de.greeting.du-sie]
    upgrade: respond                             # optional override of the selfrate upgrade (04)
    accepted: { "#2": ["Guten Tag!"] }           # optional extra accepted answers
extra:
  - after: dw.nicos-weg/a1/00-01/ex-12           # existing exercise key, or "end"
    exercise: { key: dw.nicos-weg/a1/00-01/x-01, type: respond, items: [ … ] }
scenes: [dw.nicos-weg/scene-neighbour-morning]
cards: { phrases: ["lex:de:wie-geht-es-ihnen:phrase"] }
```

Stale entries are skipped at compose time and listed by `enrich check`.

## Normalisation contract (all providers)

Every provider MUST produce, per course and edition: a manifest, a course index, lessons/exams with
keys from the key map, exercises with a type from the registry (or `unknown`) and a fingerprint, vocab
entries with lexeme keys, locale files with every learner-language string the types require (and a
translation per vocab entry when source ≠ target), and media as blobs listed in the manifest.

- Never drop source content silently: unmappable parts go to `unmapped` with a raw path and reason.
- Deterministic: same raw + same provider version → byte-identical output.
- Our own courses follow the same contract.

## Validation and versions

- The server validates canonical/locale files when a course is loaded; an invalid edition is marked
  broken with a report (no partial use).
- **verify** checks sha256 and size of every manifest file (missing, corrupt, extra) and referential
  integrity (keys, blob refs, rule ids, locale coverage). Restore = copy the series folder + `verify`.
- The server refuses newer formats and re-normalises older ones from `raw/` (offline).
