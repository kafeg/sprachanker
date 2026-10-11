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
| Time | durations in seconds; timestamps Unix ms (in the databases and in files) |
| Media references | path inside the series folder, `media/<kind>/<name>` (readable source names; `-2`, `-3` on clashes); sha256, size and MIME are recorded in `<series>/media.json`, keyed by source URL; one file per content in a series — URLs whose files are the same (by sha256) point to one, the first path in order (each fetch makes it so, stored ones too; files no URL points to any more stay, as passes and cards may name them) |
| Text language | target-language strings live in **canonical** files; learner-language strings only in **locale** files, at the same key path. Every text is the source's: a provider makes up none (a page the source gives no title has none, and the app names it by its kind) |
| HTML | only in fields named `*Html`, sanitised to an allow-list: h3 (a section title — outside tables, lists and figures; one inside them is a bold paragraph), p, br, b, strong, i, em, small, mark (a word the source marks for itself: DW's new words, shown underlined), ul, ol, li, table, thead, tbody, tr, th, td, figure, figcaption, img (`src` rewritten to a media path, `alt` kept), a cell's `rowspan` and `colspan` (2–99); no attributes otherwise; a table of one cell holding a line of text (a label over the next table) is that text as a bold paragraph, one holding paragraphs (a framed note) stays; unknown elements are unwrapped to their text, comments dropped; emphasis around nothing but spaces, an empty paragraph, caption or title, and a no-break space between two letters (a plain space; one keeping a number with its unit stays) and characters of no width (a zero-width space, a byte-order mark), a line break at a block's start or end and a second one in a row are an editor's leftovers; a paragraph of plain lines, two or more of them "- item", is those lines as a list (the other lines paragraphs around it). Plain text from a source's HTML drops its comments (an editor's markup in them) and characters of no width |
| Format versions | integer `format` in every content file type (canonical, locale, exams, enrichment); bumped on breaking change; additive optional fields do not bump it. The importer's own state (`media.json`, `keys.json`) has none: it is checked when read, and one that does not read stops the import |

## Library layout

The library is a folder in the data root (05). It contains **only** downloaded content and data derived
from it — no learner data, no enrichment. Each series folder is self-contained and can be archived,
moved, or restored by copying. Decks imported from `.apkg` files live beside it, in
`<data-root>/decks/` (05): words of the learner's choosing, not a source's course.

```
<data-root>/library/
└── dw.nicos-weg/                               # series id
    ├── media.json                              # media index: source URL → path, sha256, size, MIME (or last error)
    ├── media/<kind>/<name>                     # video, audio, image, subtitles, pdf under source names
    ├── keys.json                               # key map: source ids → keys (below)
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
| Course | `<series>/<course>` | `dw.nicos-weg/a1-ru` |
| Unit | `<course>/u<NN>` | `dw.nicos-weg/a1-ru/u00` |
| Lesson | `<course>/<NN>-<NN>` (unit-lesson) | `dw.nicos-weg/a1-ru/00-01` |
| Exercise | `<lesson>/ex-<NN>` (source order); ours: `<lesson>/x-<NN>` | `dw.nicos-weg/a1-ru/00-01/ex-03` |
| Item | `<exercise>#<n>` (1-based; the schema checks that an item's key is its position) | `dw.nicos-weg/a1-ru/00-01/ex-03#2` |
| Option | id inside an item: `a`, `b`, `c`… in canonical order | option `b` |
| Exam | `<course>/exam-<slug>` | `bamf.lid/lid/exam-test` |
| Exam section | `<exam>/s-<slug>` | `bamf.lid/lid/exam-test/s-state` |
| Exam item | `<exam>/q-<id>`, id unique within the exam | `bamf.lid/lid/exam-test/q-001`, `…/q-be-01` |
| Goal | `<lesson>/goal-<n>` or `<course>/goal-<slug>` (ours) | `dw.nicos-weg/a1-ru/00-01/goal-1` |
| Vocab occurrence | `<lesson>/v-<lemma-slug>[.<n>]` | `dw.nicos-weg/a1-ru/00-01/v-frau`, `…/v-frau.2` |
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
  every course. Different values give different lexemes ("Frau" as a title ≠ "die Frau"). A word's
  fields mean one thing in every course: `target` is the headword as the source shows it, `forms` its
  other forms (never its lemma), `plural` its plural, `note` a usage note, `ipa` its pronunciation —
  each in the target language, only when the source gives it. A card
  follows its word (the vocab key: its lesson and lemma): when a rule gives the word another lexeme,
  the card takes it, and what it shows of the word (the word, gender, plural, example, recording) is
  the word's now. A lemma corrected at the source is another word: the old card keeps its progress.
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
  the first time it is listed, and one listed twice is numbered per occurrence (`occurrences`). Built
  for DW (lessons in their unit, exercises in their lesson), Lingust (lessons in their stage by page,
  example sections by their title, tasks without a number by their label; numbered tasks keep their
  number) and VOA Let's Learn English (lessons in their unit, exercises by their video or quiz); units
  stay positional (their sources' levels and stages are fixed). Deutsch im Blick keys by the source's
  chapter and section numbers, VOA «Так говорят в Америке» by its fixed catalogue. A lesson's
  exercises and words are each under their own key, once (the lesson's schema checks it, items by
  their exercise's). The app shows a lesson's number from its key ("3.7"): one the source inserts
  shows its key's number, not its place, on every screen alike. A key map that does not read stops the
  normaliser: numbering afresh would hand kept keys to other content.
- **Fingerprint** of an exercise = sha256(JCS of its canonical object without `fingerprint`); identical
  across editions of the same content.

## Manifest

None is written: `media.json` records the media and the library is read from the canonical and locale
folders. Planned: a series manifest — each edition's `contentVersion`, a hash per file — with course
bundles (plan, item 5, and "Open items in built areas", Library); its format is fixed when it is built.

Exams of a course are listed in its course index (`exams`); a stand-alone exam is a course with exams
only (no units), shown in the Exams section rather than among the courses. An exam is its questions
(items of the kinds an exam asks — `single_choice`, `gap_text`, `respond` — keyed in the exam, with
tags, optional `points` (1 when not given) and a `text` of their own; an open answer — writing,
speaking — with its `criteria`, each with the points of its levels best first and `voids` where a 0
makes the whole answer 0, their titles and what each level means in the locale item's `criteria`; a speaking task's `partner`: what the partner has — their card, calendar, slides — for the assistant playing them, never shown to the learner), sections drawing a number of
them from a pool — filtered by a tag that must have the value of a profile setting (`{ tag:
"federalState", setting: "exam.federalState" }`) — a time limit and pass marks. A language exam adds
`modules` (`hoeren`, `lesen`, …: each timed, its points scaled to `scaleTo`, rounded to whole points
where the exam's rules say (`round`); the exam's time is theirs together; `roundTotal`: the modules'
sum rounded before the pass marks); its sections are the modules' Teile, each asking all its pool, with its material: a
shared `text`, its `media` (recording or picture), the `letters` its questions are answered from (ads
or pictures, each once: `{ letter, text?, media? }`; the pictures' descriptions in the locale's
section `alt`), how often a recording `plays`, and its `examples`:
questions shown answered (in no pool, never scored). A pass mark may count only some modules'
scaled points (`modules`), and `passWhen` says whether any mark passes the exam (LiD: course test or
naturalisation) or all must be reached (Goethe A2: overall, written, spoken). The locale file titles
the exam, its modules, its sections (with their instructions) and its pass marks. Beside it,
`canonical/<course>/sources/<slug>.json` (`ExamSources`) says where the exam was read (owner,
2026-10-10: proof that the data is the source's): each document — its title, address and, for the
copy kept in `raw/`, the copy's path and sha256 —, when they were read, the checks the import ran
(`EXAM_CHECKS`: questions complete, options the same in two sources, answers marked twice, answers
matched, numbers, recordings placed, media kept; each with how many passed of how many) and each
question's places in the documents (its question, its answer). `verify` reports a question without a
place, a place in an unknown document, a copy missing or changed since it was read, a check not
passed. `verify` reads it as
the app does and checks that its questions are its own and listed once, their answers fit their kind
(options they have, gaps they have), each pool lists questions of the exam and holds at least what it
draws (for each value of a filtered section's tag), every section is in a module of the exam when it
has modules and their times add up, an example is a question of no pool, a pass mark names modules
the exam has, and none is above the points it can give.

## Canonical files (language-independent)

```jsonc
// canonical/<course>/course.json
{ "format": 1, "key": "dw.nicos-weg/a1-ru",
  // Where the course comes from: shown with it (licence: cc-by-4.0 | public-domain | free-access).
  "source": { "publisher": "Deutsche Welle", "url": "https://learngerman.dw.com/de", "licence": "free-access" },
  "units": [ { "key": "dw.nicos-weg/a1-ru/u00", "lessons": ["dw.nicos-weg/a1-ru/00-01"] } ],
  "exams": [],
  // The course's can-do statements in order with their lessons (read by its can-do list: planned).
  "goals": [ { "key": "dw.nicos-weg/a1-ru/00-01/goal-1", "lessons": ["dw.nicos-weg/a1-ru/00-01"] } ] }

// canonical/<course>/lessons/00-01.json
{ "format": 1, "key": "dw.nicos-weg/a1-ru/00-01", "unit": "dw.nicos-weg/a1-ru/u00",
  "media": { "video": { "sd": "media/video/…_sd.mp4", "subtitles": "media/subtitles/….vtt" } }, "goals": ["dw.nicos-weg/a1-ru/00-01/goal-1"],
  "pages": [ { "exercise": { "key": "…/00-01/ex-03", "type": "single_choice", "fingerprint": "…",
      "newWords": ["…/00-01/v-guten-tag"], "ruleIds": [],
      "items": [ { "key": "…/ex-03#1", "media": { "image": "media/image/….jpg" },
                   "options": [ { "id": "a", "text": "Hi!" }, { "id": "b", "text": "Guten Tag." } ],
                   "answer": { "optionIds": ["b"] } } ] } } ],
  "vocab": [ { "key": "…/00-01/v-frau", "lexeme": "lex:de:frau:noun:f", "target": "die Frau, die Frauen",
               "gender": "f", "plural": "die Frauen", "audio": "media/audio/….mp3" } ],
  // What the provider could not map, and words it left out (no usable headword, no translation).
  "unmapped": [ { "path": "raw/ru-de/a1/00-01/ex-07.json", "reason": "unknown inputType X" } ] }

// canonical/<course>/exams/<slug>.json — the Leben in Deutschland test (03)
{ "format": 1, "key": "bamf.lid/lid/exam-test", "timeLimitSec": 3600,
  "sections": [ { "key": "…/s-general", "pool": ["…/q-001"], "draw": 30, "filter": null },
                { "key": "…/s-state", "pool": ["…/q-be-01"], "draw": 3,
                  "filter": { "tag": "federalState", "setting": "exam.federalState" } } ],
  "items": [ { "key": "…/q-001", "type": "single_choice", "tags": { "federalState": null },
               "prompt": "…", "options": [ … ], "answer": { "optionIds": ["c"] } },
             { "key": "…/q-055", "type": "single_choice", "tags": { "federalState": null }, "prompt": "…",
               "media": { "image": "media/image/lid-055.png", "credit": "© …" }, "options": [ … ], … } ],
  "thresholds": [ { "id": "lid", "minPoints": 15 }, { "id": "naturalisation", "minPoints": 17 } ] }

// canonical/<course>/exams/<slug>.json — a language exam's model test (modules of Teile)
{ "format": 1, "key": "goethe.a1/a1/exam-modell", "timeLimitSec": 2700,
  "modules": [ { "id": "hoeren", "timeLimitSec": 1200, "scaleTo": 25 }, { "id": "lesen", … } ],
  "sections": [ { "key": "…/s-h1", "module": "hoeren", "pool": ["…/q-h1", "…/q-h2"], "draw": 2,
                  "filter": null, "plays": 2, "examples": ["…/q-h0"] },
                { "key": "…/s-l2", "module": "lesen", "pool": ["…/q-l6"], "draw": 1, "filter": null,
                  "text": "a  Café Weber …\n\nb  Teeladen …" } ],
  "items": [ { "key": "…/q-h1", "type": "single_choice", "tags": {}, "media": { "audio": "media/audio/….mp4" },
               "prompt": "…", "options": [ { "id": "a", "text": "a", "media": { "image": "…" } }, … ], … },
             { "key": "…/q-s1", "type": "gap_text", "tags": {}, "segments": ["Name: ", { "gap": "g1" }],
               "answer": { "g1": { "accepted": ["4", "vier"] } } } ],
  "thresholds": [ { "id": "pass", "minPoints": 60 },
                  { "id": "written", "minPoints": 45, "modules": ["lesen", "hoeren", "schreiben"] } ],
  "passWhen": "all" }
```

Lesson `media`: `video` (`sd`, `hd`, `subtitles`, `poster` — the episode's own still), `image`, and
`audio` — a lesson-level recording (Deutschtrainer reads the lesson's words and phrases aloud); all
optional. Any `media` (a lesson's, an exercise's, an item's or an option's) may carry `credit`: whose
picture or recording it is, as the source credits it, shown with it; one with a `video` its `poster`,
the video's own still.

## Exercise types

`docs/research/dw-nicos-weg.md` maps every DW mechanic to a type. All types share `key`, `type`, `fingerprint`, `items[]`, optional `media` (stimulus) and `text`
(target-language stimulus), `newWords`, `ruleIds` (both written empty by every provider — only the
fixture fills them —, read by nothing yet: rule ids come with enrichment, plan "Enrichment and rules";
they stay, as every library file and page snapshot holds them). Items have `key`, optional `media` (what the item
asks with: its recording is heard before answering), `answerAudio` (the source's answer, spoken: offered
once the item is checked — before, it would give the answer away) and `prompt` (target language; a
learner-language prompt lives in the locale file). Answers are compared by
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
| `speech_selfrate` | `text?` (a phrase to repeat after its recording), `reference?[text]` (the source's answer to say: a line, alternatives split by " / ", or its frame "Ich trinke …"), `media.audio?` (its `answerAudio` played after the first try); `prompt` is what it asks | `{recording?, transcript?}` (08; old stored answers may carry `rating`) | not scored; recorded is done. With a line to say (`reference`, else `text`; not a frame — an ellipsis, a gap, words in brackets), what was heard gets a word diff; without, the AI checks it (08) |
| `respond` | `input` (`text`\|`speech`), `rubric?{required[{id,anyOf[text]}]}`, `reference[text]` (target), `answerIn?` (`target`\|`learner`: a translation into the learner's language keeps its model answers in the locale item's `reference`) | `{text, speech?}` | rubric (an LLM verdict: plan, "Later"); without a rubric unscored, the model answers shown |
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
titles them (DW: a paragraph of bold text only, course-kit `boldLinesAsHeadings`; Lingust and Let's
Learn English: their sub-headings); the app shows each
section as a card. An exercise's title is absent when the source has none,
never empty.

```jsonc
// locale/<edition>/<course>/lessons/00-01.json
{ "format": 1, "edition": "ru-de", "lesson": "dw.nicos-weg/a1-ru/00-01", "sourceId": "46381195",
  "title": "Hallo!", "synopsisHtml": "…",
  "exercises": { "dw.nicos-weg/a1-ru/00-01/ex-03": { "sourceId": "46381693", "title": "…", "instructionHtml": "…",
                  "items": { "#1": { "hintHtml": "<p>Справка: …</p>" } } } },
  "vocab": { "dw.nicos-weg/a1-ru/00-01/v-frau": { "translation": "женщина", "examples": ["…"] } },
  "tabs": { "grammar": [ { "title": "…", "bodyHtml": "…" } ], "culture": [ … ], "script": { … } },
  "downloads": [ { "title": "…", "path": "media/pdf/….pdf" } ] }
```

Items are referenced as `#<n>` within their exercise; an item may carry `prompt`, `hintHtml`, option
texts (`options{id:text}`), image descriptions (`alt`), learner-language model answers (`reference`)
and an exam's open answer's criteria named, with what each level means (`criteria`). A vocab entry's `examples` (canonical, target language) have their translations in the
locale entry's `examples`, in the same order. Which source fields are learner
language is decided by the provider per mechanic and field; a field the source fills in either
language (DW's choice prompts and options — a question on what a text says —, Lingust's prompts and
answer keys) is read by `inLearnerLanguage` (course-kit `language.ts`) by script, where the two
languages differ in it; two languages of one script are not told apart (the text stays the
target's: the few such texts are not worth a guess that could move German). Comparing editions
cannot do it: DW's editions number their exercises apart, and few are
installed together. An item's options in the learner's language move to the locale file together,
and the app shows them from there. UI labels of the source ("Play audio") are not content and are
dropped.

The locale course file holds the course title, unit titles and goal texts in the same way.

## Grammar rules registry (ours)

`courses/_shared/rules/<lang>.yaml` — the only place rules are defined. A start of German's is there,
checked with the fixture's rule ids (10); the app reads none yet (plan, "Enrichment and rules").

```yaml
- id: de.greeting.du-sie
  title: { en: "Informal and formal address", ru: "«Ты» и «Вы»", de: "Duzen und Siezen" }
  explanation: { ru: "…", en: "…" }        # contrastive, per learner language; markdown
  examples: ["Wie geht es dir?", "Wie geht es Ihnen?"]
```

Every `ruleIds` value anywhere MUST exist in the registry.

## Enrichment (ours, in the repository)

Planned (plan, "Enrichment and rules"); the format is fixed by `packages/schema/src/enrichment.ts`:
`courses/<provider>/enrichment/<course>/<NN>-<NN>.yaml`, written by hand and reviewed, never generated
by an LLM (00), keyed by keys and fingerprints only — never copies of third-party text. An entry whose
fingerprint differs from its exercise's is stale and skipped.

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
  an invalid file is an error, never partially used. A file with an unknown `format` fails validation,
  and so does one with a field its schema does not know (the schemas are strict: a misspelt field is
  never written and silently dropped on read). A normaliser writes a file that fails its schema all the
  same — where it is read, it says so — and the import counts it: the CLI exits with an error, a
  download from the app ends with one.
- Restore = copy the series folder.
- **verify** (`packages/course-kit/src/verify.ts`, CLI `sprachanker verify`) reads every installed course
  the way the app does and checks what the schemas cannot: lessons listed once and in their unit, no
  unlisted lesson files, answers naming existing options/parts/gaps, fingerprints, locale texts per
  edition matching the canonical exercises and words (missing ones are notes), unit titles, and every
  referenced media file on disk. Planned: checks of manifest hashes and rule ids, normalising from
  `raw/` offline (plan, "Open items in built areas", Library).
