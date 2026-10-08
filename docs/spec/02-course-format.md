# 02 — Course format and library

This file defines the **stored content formats**: library layout, media index, keys, canonical and
locale files, rules registry, enrichment, and the normalisation contract every provider follows. zod schemas in
`packages/schema` implement it; JSON Schemas are generated from them (10).

## Conventions

| Topic | Rule |
|---|---|
| Encoding | UTF-8, Unicode NFC; JSON pretty-printed with sorted keys (deterministic output) |
| Hashes | sha256, lowercase hex; canonical JSON for hashing = RFC 8785 (JCS) |
| Generated ids (learner data) | ULID |
| Edition id | `<source>-<target>` (`ru-de`, `en-de`, `de-de`) |
| Time | durations in seconds; timestamps in DB Unix ms, in files ISO 8601 UTC |
| Media references | path inside the series folder, `media/<kind>/<name>` (readable source names; `-2`, `-3` on clashes); sha256, size and MIME are recorded in `<series>/media.json`, keyed by source URL |
| Text language | target-language strings live in **canonical** files; learner-language strings only in **locale** files, at the same key path |
| HTML | only in fields named `*Html`, sanitised to an allow-list: h3 (a section title), p, br, b, strong, i, em, small, ul, ol, li, table, thead, tbody, tr, th, td, figure, figcaption, img (`src` rewritten to a media path, `alt` kept); no attributes otherwise; unknown elements are unwrapped to their text |
| Format versions | integer `format` in every file type; bumped on breaking change; additive optional fields do not bump it |

## Library layout

The library is a folder in the data root (05). It contains **only** downloaded content and data derived
from it — no learner data, no enrichment. Each series folder is self-contained and can be archived,
moved, or restored by copying.

```
<data-root>/library/
└── dw.nicos-weg/                               # series id
    ├── media.json                              # media index: source URL → path, sha256, size, MIME (or last error)
    ├── media/<kind>/<name>                     # video, audio, image, subtitles, pdf under source names
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
| Item | `<exercise>#<n>` (1-based; the schema checks that an item's key is its position) | `dw.nicos-weg/a1/00-01/ex-03#2` |
| Option | id inside an item: `a`, `b`, `c`… in canonical order | option `b` |
| Exam | `<course>/exam-<slug>` | `bamf.lid/lid/exam-test` |
| Exam section | `<exam>/s-<slug>` | `bamf.lid/lid/exam-test/s-state` |
| Exam item | `<exam>/q-<id>`, id unique within the exam | `bamf.lid/lid/exam-test/q-001`, `…/q-be-01` |
| Goal | `<lesson>/goal-<n>` or `<course>/goal-<slug>` (ours) | `dw.nicos-weg/a1/00-01/goal-1` |
| Vocab occurrence | `<lesson>/v-<lemma-slug>[.<n>]` | `dw.nicos-weg/a1/00-01/v-frau`, `…/v-frau.2` |
| Lexeme | `lex:<lang>:<lemma-slug>:<pos>[:<gender>]` | `lex:de:frau:noun:f` |
| Rule | `<lang>.<area>.<slug>` | `de.greeting.du-sie` |
| Scene | `<series>/scene-<slug>` | `dw.nicos-weg/scene-neighbour-morning` |

- `lemma-slug`: NFC, lowercase, spaces → `-`, punctuation removed, letters of any script kept
  (umlauts, ß, Cyrillic). A lesson can list the same lemma twice (DW: "Frau" as a title and "die Frau");
  the second and later get `.2`, `.3` in source order.
- `pos` ∈ `noun`, `verb`, `adj`, `phrase`, `word`; `gender` ∈ `m`, `f`, `n`, `pl` (plural-only noun),
  nouns only. Providers derive them from what the source states, never by guessing: an article makes a
  noun, verb forms a verb, comparison forms an adjective, a sentence or 3+ words a phrase, English
  "to X" a verb with lemma X; anything else is `word`. Where the source states nothing, every provider
  uses one function (`shapeHeadword`, course-kit `vocab.ts`), so the same entry is the same lexeme in
  every course. Different values give different lexemes ("Frau" as a title ≠ "die Frau"). A card
  follows its word (the vocab key): when a rule gives the word another lexeme, the card takes it.
- Keys are built and parsed only by `packages/schema/src/keys.ts`; fingerprints are computed by
  `packages/course-kit/src/fingerprint.ts`.
- Keys follow the source order (units and lessons in course order, exercises in lesson order) — the
  source's, never what the mapping made of it: where the source numbers its tasks, the key is that
  number (Lingust: "Упражнение N" is `ex-N`, a section's examples `ex-1<section>`, the closing lines
  `ex-300`), so a normaliser fix that maps one more task never moves the others. Source
  ids are stored in locale files (`sourceId`), so adding an edition never changes canonical files.
  Unit and lesson order is the order of the course index's arrays.
  The first normalisation numbers by place; after that a key stays with its source id through the
  series' key map (`keys.json`, `course-kit/key-map.ts`): one the source inserts, moves or drops
  shifts no other, a new one takes its place's number when free, else the next free one, and a
  removed one's number is never re-used; an exercise missing at the source still takes its number
  the first time it is listed, and one listed twice is numbered per occurrence. Built for DW (lessons
  in their unit, exercises in their lesson); units stay positional (DW's levels have fixed units).
  The other providers key by the source's own numbering. A key map that does not read stops the
  normaliser: numbering afresh would hand kept keys to other content.
- **Fingerprint** of an exercise = sha256(JCS of its canonical object without `fingerprint`); identical
  across editions of the same content.
- Planned: **contentVersion** of an edition = sha256 over the sorted `path:sha256` list of the course's
  canonical files and that edition's locale files.

## Manifest (planned)

A series manifest `course.json` (schema: `packages/schema/src/manifest.ts`): provider and version,
licence, courses (`kind` ∈ `course exam`, level, target) with editions (`fetchedAt`, `contentVersion`)
and every file with sha256 and size, written last after normalise and verify. Not written yet: today
`media.json` records the media and the library is read from the canonical and locale folders.

Exams of a course are listed in its course index; a stand-alone exam (`bamf.lid`) is a course of kind
`exam`.

## Canonical files (language-independent)

```jsonc
// canonical/<course>/course.json
{ "format": 1, "key": "dw.nicos-weg/a1-ru",
  // Where the course comes from: shown with it (licence: cc-by-4.0 | public-domain | free-access).
  "source": { "publisher": "Deutsche Welle", "url": "https://learngerman.dw.com/de", "licence": "free-access" },
  "units": [ { "key": "dw.nicos-weg/a1-ru/u00", "lessons": ["dw.nicos-weg/a1-ru/00-01"] } ],
  "exams": [],
  "goals": [ { "key": "dw.nicos-weg/a1-ru/00-01/goal-1", "lessons": ["dw.nicos-weg/a1-ru/00-01"] } ] }

// canonical/<course>/lessons/00-01.json
{ "format": 1, "key": "dw.nicos-weg/a1/00-01", "unit": "dw.nicos-weg/a1/u00",
  "media": { "video": { "sd": "media/video/…_sd.mp4", "subtitles": "media/subtitles/….vtt" } }, "goals": ["dw.nicos-weg/a1/00-01/goal-1"],
  "pages": [ { "exercise": { "key": "…/00-01/ex-03", "type": "single_choice", "fingerprint": "…",
      "newWords": ["…/00-01/v-guten-tag"], "ruleIds": [],
      "items": [ { "key": "…/ex-03#1", "media": { "image": "media/image/….jpg" },
                   "options": [ { "id": "a", "text": "Hi!" }, { "id": "b", "text": "Guten Tag." } ],
                   "answer": { "optionIds": ["b"] } } ] } } ],
  "vocab": [ { "key": "…/00-01/v-frau", "lexeme": "lex:de:frau:noun:f", "target": "die Frau, die Frauen",
               "gender": "f", "plural": "die Frauen", "audio": "media/audio/….mp3" } ],
  // What the provider could not map, and words it left out (no usable headword, no translation).
  "unmapped": [ { "path": "raw/ru-de/a1/00-01/ex-07.json", "reason": "unknown inputType X" } ] }

// canonical/<course>/exams/<slug>.json
{ "format": 1, "key": "bamf.lid/lid/exam-test", "timeLimitSec": 3600,
  "sections": [ { "key": "…/s-general", "pool": ["…/q-001"], "draw": 30, "filter": null },
                { "key": "…/s-state", "pool": ["…/q-be-01"], "draw": 3, "filter": { "setting": "federalState" } } ],
  "items": [ { "key": "…/q-001", "type": "single_choice", "tags": { "federalState": null },
               "prompt": "…", "options": [ … ], "answer": { "optionIds": ["c"] } } ],
  "thresholds": [ { "id": "course-test", "minPoints": 15 }, { "id": "naturalisation", "minPoints": 17 } ] }
```

Lesson `media`: `video` (`sd`, `hd`, `subtitled`, `subtitles`), `image`, and `audio` — a lesson-level
recording (Deutschtrainer reads the lesson's words and phrases aloud); all optional.

## Exercise types

`docs/research/dw-nicos-weg.md` maps every DW mechanic to a type. All types share `key`, `type`, `fingerprint`, `items[]`, optional `media` (stimulus) and `text`
(target-language stimulus), `newWords`, `ruleIds`. Items have `key`, optional `media` and `prompt`
(target language; a learner-language prompt lives in the locale file). Answers are compared by
**ids**, never by display position; display order may be shuffled. Options with identical content
are interchangeable (repeated letters in a word, the same form twice in a match). Open answers
(translation, short writing, answering a prompt, spoken or written) are all `respond`.

| Type | Item fields (canonical) | Stored answer | Correct when |
|---|---|---|---|
| `single_choice` | `options[{id,text?,media?}]`, `answer.optionIds[1]` | `{optionId}` | id equal |
| `multi_choice` | same, `answer.optionIds[n]` | `{optionIds[]}` | sets equal |
| `match` | `left[]`, `right[]` (options), `answer.pairs[[l,r]]` | `{pairs}` | pair sets equal |
| `order` | `parts[]` (options: words, letters or pictures), `join` (`space`\|`none`), `answer.sequence[id]` | `{sequence}` | sequences equal |
| `gap_choice` | `segments[text \| {gap}]`, `gaps{gapId:{options}}`, `display` (`dropdown`\|`bank`), `answer{gapId:optionId \| optionId[]}` (several when any is right) | `{gapId:optionId}` | every gap one of its right options |
| `gap_text` | `segments`, `answer{gapId:{accepted[text]}}`; `""` = nothing belongs there (no article) | `{gapId:text}` | normalised text ∈ accepted; an empty or dash answer matches `""` |
| `dictation` | `media.audio`, `answer.accepted[text]` | `{text}` | word diff = 0 |
| `speech_repeat` | `text`, `media.audio?` | `{speech}` | word diff = 0 |
| `speech_selfrate` | `text?`, `media.audio?`, `answerAudio?` (the source's answer, spoken; source form; upgraded, 04) | `{recording?}` (08; `rating` in answers before 2026-10-08) | not scored |
| `respond` | `input` (`text`\|`speech`), `rubric?{required[{id,anyOf[text]}], criteria[{id}]}`, `reference[text]` (target), `answerIn?` (`target`\|`learner`: a translation into the learner's language keeps its model answers in the locale item's `reference`) | `{text, speech?}` | rubric (LLM verdict: Later, 07); without a rubric unscored, the model answers shown |
| `scene` | `scene` key (enrichment) | — (conversation run) | scene goals met |
| `unknown` | `raw` path, `reason` | — | not rendered |

Option ids are `a`, `b`, … and gap ids `g1`, `g2`, … in canonical order. No source has a categorisation
mechanic; a `classify` type is added with the first source that needs it.

## Locale files

Learner-language strings (titles, instructions, info boxes, translations, category labels, prompts in
the learner's language) live at the same key path as in canonical files. Tab bodies (grammar, culture,
script, homework — tasks of the source without answers to check) are locale HTML and may mix languages.
A grammar or culture page is one topic of the lesson (each becomes a step of its plan, 04): a provider
joins the parts of a topic within a lesson and marks one continued from an earlier lesson with `part`
(2, 3, …) instead of a number in the title. A page's sections are titled with `<h3>` where the source
titles them (DW: a paragraph of bold text only; course-kit `boldLinesAsHeadings`); the app shows each
section as a card. An exercise's title is absent when the source has none,
never empty.

```jsonc
// locale/<edition>/<course>/lessons/00-01.json
{ "format": 1, "edition": "ru-de", "lesson": "dw.nicos-weg/a1/00-01", "sourceId": "46381195",
  "title": "Hallo!", "synopsis": "…",
  "exercises": { "dw.nicos-weg/a1/00-01/ex-03": { "sourceId": "46381693", "title": "…", "instructionHtml": "…",
                  "items": { "#1": { "hintHtml": "<p>Справка: …</p>" } } } },
  "vocab": { "dw.nicos-weg/a1/00-01/v-frau": { "translation": "женщина", "examples": ["…"] } },
  "tabs": { "grammar": [ { "title": "…", "bodyHtml": "…" } ], "culture": [ … ], "script": { … } } }
```

Items are referenced as `#<n>` within their exercise; an item may carry `prompt`, `hintHtml`, option
texts (`options{id:text}`), image descriptions (`alt`), gap labels and learner-language model answers
(`reference`). A vocab entry's `examples` (canonical, target language) have their translations in the
locale entry's `examples`, in the same order. Which source fields are learner
language is decided by the provider per mechanic and field (DW: by comparing editions), not by
language detection. UI labels of the source ("Play audio") are not content and are dropped.

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

## Enrichment (ours, in the repository; planned after the MVP)

Not built yet; the format is fixed by `packages/schema/src/enrichment.ts`. Enrichment is written by hand and reviewed; it is never generated by an LLM (00).
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
    accepted: { "#2": ["Guten Tag!"], "#3": { g1: ["Tee"] } }   # optional extra accepted answers
                                                 # (per gap for a gap_text item)
extra:
  - after: dw.nicos-weg/a1/00-01/ex-12           # existing exercise key, or "end"
    exercise: { key: dw.nicos-weg/a1/00-01/x-01, type: respond, items: [ … ] }
scenes: [dw.nicos-weg/scene-neighbour-morning]
cards: { phrases: ["lex:de:wie-geht-es-ihnen:phrase"] }
```

Stale entries are skipped at compose time and listed by `enrich check`.

## Normalisation contract (all providers)

Every provider MUST produce, per course and edition: a course index, lessons/exams with keys (above),
exercises with a type from the registry (or `unknown`) and a fingerprint, vocab entries with lexeme
keys, locale files with every learner-language string the types require (and a translation per vocab
entry when source ≠ target), and media files recorded in `media.json`. Files are validated against
their schemas as they are written (`writeLibraryFiles`); failures are reported.

- Never drop source content silently: unmappable parts go to `unmapped` with a raw path and reason.
- Deterministic: same raw + same provider version → byte-identical output.
- Our own courses follow the same contract.

## Validation and versions

- The library validates canonical and locale files when they are read (`packages/course-kit/src/library.ts`);
  an invalid file is an error, never partially used. A file with an unknown `format` fails validation.
- Restore = copy the series folder.
- **verify** (`packages/course-kit/src/verify.ts`, CLI `sprachanker verify`) reads every installed course
  the way the app does and checks what the schemas cannot: lessons listed once and in their unit, no
  unlisted lesson files, answers naming existing options/parts/gaps, fingerprints, locale texts per
  edition matching the canonical exercises and words (missing ones are notes), unit titles, and every
  referenced media file on disk. Planned: manifest sha256/size checks, rule ids, re-normalising older
  formats from `raw/` offline.
