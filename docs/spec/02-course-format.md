# 02 — Course format and library

This file defines every **stored content format**: library layout, manifest, keys, canonical files,
locale files, exercise items, exams, rules, enrichment, and the normalisation contract all providers
must follow. zod schemas in `packages/schema` implement it 1:1; JSON Schemas are generated from them (10).

## Conventions (all formats)

| Topic | Rule |
|---|---|
| Encoding | UTF-8, Unicode **NFC**; JSON files pretty-printed with sorted keys (deterministic output) |
| Hashes | sha256, lowercase hex |
| Canonical JSON for hashing | RFC 8785 (JCS) serialisation, then sha256 |
| Generated ids (learner data) | ULID |
| Language tags | BCP-47 primary tags (`de`, `en`, `ru`) |
| Edition id | `<source>-<target>` (`ru-de`, `en-de`, `de-de`) |
| Durations | seconds (number); timestamps in DB: Unix ms; in files: ISO 8601 UTC |
| Blob references | `blob:sha256:<hash>`; MIME and size live in the manifest |
| Text language | strings in **canonical** files are target language; strings in the **learner's language** live only in **locale** files, at the same path (see "Text placement") |
| HTML | only in fields named `*Html`; sanitised to: p, br, b, strong, i, em, ul, ol, li, table, thead, tbody, tr, th, td |
| Format versions | integer `format` field in every file type; bumped on breaking change |

## Library layout

The library is a folder in the data root (05). It contains **only** downloaded content and data derived
from it — no progress, no settings, none of our enrichment. Each series is self-contained and can be
archived, moved, or restored by copying.

```
<data-root>/library/
└── dw.nicos-weg/                               # series id (see Keys)
    ├── course.json                             # manifest
    ├── blobs/sha256/ab/cd/abcd…                # binaries, content-addressed, stored once
    ├── raw/<edition>/<course>/…                # source snapshots as fetched (provider-specific)
    ├── canonical/<course>/course.json          # course index (units, lessons, exams, goals)
    ├── canonical/<course>/lessons/<unit>-<lesson>.json
    ├── canonical/<course>/exams/<exam>.json
    └── locale/<edition>/<course>/
        ├── course.json                         # localised course index texts
        ├── lessons/<unit>-<lesson>.json
        └── exams/<exam>.json
```

## Keys and identity

| Key | Pattern | Example |
|---|---|---|
| Series | `<provider>.<series>` | `dw.nicos-weg` |
| Course | `<series>/<course>` | `dw.nicos-weg/a1` |
| Unit | `<course>/u<NN>` | `dw.nicos-weg/a1/u00` |
| Lesson | `<course>/<NN>-<NN>` (unit-lesson) | `dw.nicos-weg/a1/00-01` |
| Exercise | `<lesson>/ex-<NN>` (1-based page order) | `dw.nicos-weg/a1/00-01/ex-03` |
| Our exercise (enrichment) | `<lesson>/x-<NN>` | `dw.nicos-weg/a1/00-01/x-01` |
| Item | `<exercise>#<n>` (1-based) | `dw.nicos-weg/a1/00-01/ex-03#2` |
| Option | id inside an item: `a`, `b`, `c`… in canonical order | `…/ex-03#2` option `b` |
| Exam | `<course>/exam-<slug>` | `dw.nicos-weg/a1/exam-final` |
| Exam item | `<exam>/q-<NNN>` (single-item exercise) | `bamf.lid/lid/exam-test/q-001` |
| Goal (can-do) | `<lesson>/goal-<n>` (order in the source list) or `<course>/goal-<slug>` (ours) | `dw.nicos-weg/a1/00-01/goal-1` |
| Vocab occurrence | `<lesson>/v-<lemma-slug>` | `dw.nicos-weg/a1/00-01/v-frau` |
| Lexeme | `lex:<lang>:<lemma-slug>:<pos>[:<gender>]` | `lex:de:frau:noun:f`, `lex:de:wie-geht-es-ihnen:phrase` |
| Rule | `<lang>.<area>.<slug>` | `de.greeting.du-sie` |
| Scene / mission | `<series>/scene-<slug>` / `<series>/mission-<slug>` | `dw.nicos-weg/scene-neighbour-morning` |

- `lemma-slug`: NFC, lowercase, spaces → `-`, punctuation removed, umlauts and ß kept (`straße`).
- `pos` ∈ `noun verb adj adv pron prep conj det num intj phrase other`; `gender` ∈ `m f n pl` (nouns only).
- Keys are built and parsed only by `packages/schema/src/keys.ts`.
- **Keys must not shift when the source changes order.** Providers whose sources have stable ids keep a
  **key map** in the repository (`courses/<provider>/provider/keymap.json`: our unit/lesson/exercise keys ↔
  source ids per edition — ids only, no content). Known ids keep their keys; new source items get new keys
  and are reported (the key map update is a reviewed PR); removed items are reported, never re-used.
  Exercise keys inside a lesson additionally rely on fingerprints to detect reordering.
- Source ids (e.g. DW ids) differ per edition and are stored in locale files (`sourceId`), so adding an
  edition never changes canonical files or another edition's `contentVersion`.
- **Fingerprint** of an exercise = sha256(JCS of its canonical object with `fingerprint` removed). It
  covers target-language text, answers and media hashes, and is identical across editions of the same
  content.
- **contentVersion** of an edition = sha256 over the sorted list of `path:sha256` of all canonical files
  of the course and all locale files of that edition.

## Manifest `course.json`

```jsonc
{
  "format": 1,
  "series": "dw.nicos-weg", "provider": "dw-nicos-weg", "providerVersion": "0.3.0",
  "title": "Nicos Weg",                                  // brand/series name, not localised
  "licence": { "id": "proprietary-personal-use", "attribution": "Deutsche Welle", "url": "https://…" },
  "courses": [
    { "id": "a1", "kind": "course", "level": "A1", "target": "de",
      "editions": [ { "id": "ru-de", "source": "ru", "fetchedAt": "2026-10-05T10:00:00Z", "contentVersion": "c1f0…" } ] }
  ],
  "files": {
    "canonical/a1/lessons/00-01.json": { "sha256": "…", "size": 12345 },
    "blobs/sha256/ab/cd/abcd…": { "sha256": "abcd…", "size": 7340032, "mime": "video/mp4",
                                  "sourceUrl": "https://…", "durationSec": 81 }
  }
}
```

`kind` ∈ `course exam reader deck`. Exams belonging to a course are listed in its course index; a
stand-alone exam (e.g. `bamf.lid`) is a course of kind `exam`.

## Canonical files (language-independent)

**Course index** `canonical/<course>/course.json`

```jsonc
{ "format": 1, "key": "dw.nicos-weg/a1", "level": "A1", "target": "de",
  "units":   [ { "key": "dw.nicos-weg/a1/u00", "order": 0, "lessons": ["dw.nicos-weg/a1/00-01", "…"] } ],
  "exams":   [ "dw.nicos-weg/a1/exam-final" ],
  "goals":   [ { "key": "dw.nicos-weg/a1/00-01/goal-1", "lessons": ["dw.nicos-weg/a1/00-01"] } ] }
```

**Lesson** `canonical/<course>/lessons/<NN>-<NN>.json`

```jsonc
{ "format": 1, "key": "dw.nicos-weg/a1/00-01", "unit": "dw.nicos-weg/a1/u00", "order": 1,
  "media": { "video": { "sd": "blob:sha256:…", "subtitled": "blob:sha256:…" } },
  "goals": ["dw.nicos-weg/a1/00-01/goal-1"],
  "pages": [
    { "exercise": { "key": "dw.nicos-weg/a1/00-01/ex-03", "type": "single_choice", "fingerprint": "…",
        "media": {}, "newWords": ["dw.nicos-weg/a1/00-01/v-guten-tag"], "ruleIds": [],
        "items": [ { "key": "…/ex-03#1", "media": { "image": "blob:sha256:…" },
                     "options": [ { "id": "a", "text": "Hi!" }, { "id": "b", "text": "Guten Tag." } ],
                     "answer": { "optionIds": ["b"] } } ] } }
  ],
  "vocab": [ { "key": "…/00-01/v-frau", "lexeme": "lex:de:frau:noun:f", "target": "Frau", "pos": "noun",
               "gender": "f", "plural": "Frauen", "forms": null, "noteTarget": null, "audio": "blob:sha256:…" } ],
  "tabs": { "grammar": true, "culture": true, "script": true },     // which locale tabs exist
  "unmapped": [ { "path": "raw/ru-de/a1/00-01/ex-07.json", "reason": "unknown inputType X" } ] }
```

**Exam** `canonical/<course>/exams/<slug>.json`

```jsonc
{ "format": 1, "key": "bamf.lid/lid/exam-test", "timeLimitSec": 3600,
  "sections": [
    { "key": "…/exam-test/s-general", "pool": ["…/q-001", "…"], "draw": 30, "filter": null, "pointsPerItem": 1 },
    { "key": "…/exam-test/s-state", "pool": ["…"], "draw": 3, "filter": { "setting": "federalState" }, "pointsPerItem": 1 } ],
  "items": [ { "key": "…/q-001", "type": "single_choice", "tags": { "federalState": null }, "…": "item fields as below" } ],
  "pass": { "minPoints": 17 }, "rubrics": [] }
```

Fixed-order exams (Nicos Weg final test) use `draw` = pool size. `rubrics` reference LLM-scored criteria
(Goethe writing/speaking, 07).

## Exercise item shapes and matching

> **Provisional until stage 1.** Derived from one DW lesson. Stage 1 reconnaissance confirms or revises
> this table (types, fields, answer shapes) before any checker or renderer is written.

All types share: `key`, `type`, `fingerprint`, `items[]`, optional `media`, `newWords`, `ruleIds`.
Items share: `key`, optional `media`, optional `prompt` (target-language text). Answers are compared by
**ids**, never by display position; display order may be shuffled, and the event stores both (05).

| Type | Item fields (canonical) | Stored answer | Correct when |
|---|---|---|---|
| `single_choice` | `options[{id,text,media?}]`, `answer.optionIds[1]` | `{optionId}` | id equal |
| `multi_choice` | same, `answer.optionIds[n]` | `{optionIds[]}` | sets equal |
| `match` | `left[{id,text?,media?}]`, `right[{id,text?,media?}]`, `answer.pairs[[l,r]]` | `{pairs[[l,r]]}` | pair sets equal |
| `order` | `parts[{id,text,media?}]`, `answer.sequence[id]` | `{sequence[id]}` | sequences equal |
| `classify` | `categories[{id}]`, `entries[{id,text,media?}]`, `answer.map{entryId:categoryId}` | `{map}` | maps equal |
| `gap_choice` | `segments[text \| {gapId}]`, `gaps{gapId:{options[{id,text}]}}`, `answer{gapId:optionId}` | `{gapId:optionId}` | all gaps equal |
| `gap_text` | `segments`, `answer{gapId:{accepted[text]}}` | `{gapId:text}` | normalised text ∈ accepted |
| `dictation` | `audio`, `answer.accepted[text]` | `{text}` | word diff vs best accepted = 0 |
| `speech_repeat` | `text`, `audio?` | `{asrText, recording}` | word diff = 0 (partial if ≥ 80% words) |
| `speech_selfrate` | `text?`, `audio?` (source form; upgraded, 04) | `{rating}` | not scored |
| `respond` | `prompt`/`audio`, `rubric{required[{id,anyOf[text]}]}`, `reference[text]` | `{text, asrText?, recording?}` | rubric + LLM verdict |
| `translate` | `reference[text]` (target), source text in locale | `{text}` | LLM verdict |
| `write` | `rubric{criteria[{id}]}`, `reference?` | `{text}` | LLM rubric scores |
| `scene` | `scene` key (enrichment) | — (conversation run) | goals met |
| `unknown` | `raw` path | — | not rendered |

Text normalisation for comparisons is defined in 04 and parameterised per target language.

## Text placement (canonical vs locale)

- Target-language strings (options, prompts, dialogue lines, vocab `target`) → canonical.
- Learner-language strings (titles, instructions, info boxes, translations, explanations, categories
  named in the learner's language, source text of `translate`) → locale, at the **same key path**:
  `exercises["…/ex-03"].items["…#2"].options.b`, `….categories.<id>`, `….prompt`.
- Compose merges locale onto canonical by these paths. `verify` fails if a path required by the
  exercise type is missing in an installed edition (e.g. category labels for `classify`).

## Locale files

```jsonc
// locale/<edition>/<course>/course.json
{ "format": 1, "edition": "ru-de", "course": "dw.nicos-weg/a1",
  "title": "Nicos Weg A1", "description": "…",
  "units": { "dw.nicos-weg/a1/u00": { "title": "Добро пожаловать!" } },
  "goals": { "dw.nicos-weg/a1/00-01/goal-1": { "text": "приветствовать других людей" } } }

// locale/<edition>/<course>/lessons/00-01.json
{ "format": 1, "edition": "ru-de", "lesson": "dw.nicos-weg/a1/00-01", "sourceId": "46381195",
  "title": "Hallo!", "subtitle": "Приветствия", "synopsis": "…",
  "exercises": { "dw.nicos-weg/a1/00-01/ex-03": { "sourceId": "46381693", "title": "…",
                  "instructionHtml": "…", "infoHtml": null, "items": {} } },
  "vocab": { "dw.nicos-weg/a1/00-01/v-frau": { "translation": "госпожа", "note": null } },
  "tabs": { "grammar": { "title": "…", "bodyHtml": "…" }, "culture": { "title": "…", "bodyHtml": "…" },
            "script": { "bodyHtml": "…" } } }
```

## Grammar rules registry (ours)

Rules span courses, so they live in one place in the repository: `courses/_shared/rules/<lang>.yaml`.

```yaml
- id: de.greeting.du-sie
  title: { en: "Informal and formal address", ru: "«Ты» и «Вы»", de: "Duzen und Siezen" }
  explanation: { ru: "…", en: "…" }        # contrastive, per learner language; markdown
  examples: ["Wie geht es dir?", "Wie geht es Ihnen?"]
  related: [de.pronoun.personal]
```

Every `ruleIds` value in canonical files, enrichment, events and statistics MUST exist in the registry
(CI check for enrichment; runtime warning for provider output).

## Enrichment (ours, in the repository)

`courses/<provider>/enrichment/<course>/<NN>-<NN>.yaml` (+ `scenes/`, `missions/`). Keys and
fingerprints only — never copies of third-party text.

```yaml
format: 1
lesson: dw.nicos-weg/a1/00-01
rules: [de.greeting.du-sie, de.greeting.time-of-day]
notes: { ru: "…", en: "…" }                      # contrastive notes per learner language (markdown)
exercises:
  dw.nicos-weg/a1/00-01/ex-05:
    fingerprint: "…"                             # required; entry is stale if it differs
    ruleIds: [de.greeting.du-sie]
    upgrade: respond                             # optional override of the default selfrate upgrade (04)
    accepted: { "#2": ["Guten Tag!"] }           # optional extra accepted answers per item
extra:
  - after: dw.nicos-weg/a1/00-01/ex-12           # full key of an existing exercise, or "end"
    exercise: { key: dw.nicos-weg/a1/00-01/x-01, type: respond, items: [ … ] }   # our keys use x-NN
scenes: [dw.nicos-weg/scene-neighbour-morning]
missions: []
cards: { phrases: ["lex:de:wie-geht-es-ihnen:phrase"] }
```

Stale entries are skipped at compose time and listed by `enrich check`.

## Normalisation contract (all providers)

Every provider MUST produce, for each course and edition:

| Element | Required | Optional |
|---|---|---|
| Manifest | `format`, `series`, `provider`, `providerVersion`, `title`, `licence`, `courses[]` with editions, `files` | — |
| Course index | `key`, `level` (or `null`), `target`, `units[]` with ordered lessons, `exams[]`, `goals[]` (may be empty) | — |
| Lesson | `key`, `unit`, `order`, `pages[]` (≥1), `vocab[]` (may be empty) | `media`, `goals`, `tabs`, `unmapped` |
| Exercise | `key`, `type` from the registry or `unknown`, `fingerprint`, `items[]` with all required fields of the type | `media`, `newWords`, `ruleIds` |
| Vocab entry | `key`, `lexeme`, `target`, `pos` | `gender` (required if noun and known), `plural`, `forms`, `noteTarget`, `audio`, `image` |
| Locale | `title`, all learner-language paths the types require, `translation` for every vocab entry of an edition whose source ≠ target | `synopsis`, `subtitle`, tabs, notes |
| Media | blob refs present in `files` with `mime`; videos and audio with `durationSec` | — |

Rules:
- Never drop source content silently: unmappable parts go to `unmapped` with a raw path and reason.
- Lexeme keys are derived with the shared helper; providers parse source notations (e.g. "die Frau, die
  Frauen") into `gender`/`plural`.
- Deterministic: same raw + same provider version → byte-identical output.
- Our own courses (e.g. Starter English) follow the same contract; their definitions live in the
  repository and their providers build library files like any other.

## Validation

- **Runtime**: the server validates every canonical/locale file against the schema when a course is
  loaded and on `verify`; invalid files mark the edition as broken with a report (no partial use).
- **verify** recomputes sha256 and size of every file listed in the manifest `files` and reports missing,
  corrupt and extra files. Restore = copy the series folder back + `verify`.
- **verify** also checks referential integrity: every key reference (`newWords`, `goals`, unit lessons,
  exam pools, `blob:` refs) resolves; every `ruleIds` value exists in the registry; locale coverage.
- **CI**: see 10 (schema drift, enrichment and registry validation, provider contract tests).

## Versions

- Each file type carries `format`; the server refuses newer formats and re-normalises older ones from
  `raw/` (offline). Library-level changes bump the manifest `format`.
