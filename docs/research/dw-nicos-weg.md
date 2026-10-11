# Research — DW Nicos Weg

Facts observed on learngerman.dw.com (October 2026): every page of A1 `ru` (77 lessons, 1071
exercises) plus samples of A1 `en`, A2 `ru` and B1 `de`. Raw data stays outside the repository.
Re-verify when the importer changes.

## Terms and robots.txt

- `robots.txt` disallows for all agents only `/*/*/l-*/ler`, `/*/*/l-*/sum`, `/*/*/placement-*`,
  `/*/*/final-*` and user/search pages. Lesson (`l-`), exercise (`e-`), grammar (`gr-`) and culture
  (`rs-`) pages are allowed. The final test is a normal lesson (`l-…`), not a `final-*` page.
- It blocks named AI crawlers entirely (among them `GPTBot`, `CCBot`, `ClaudeBot`, `anthropic-ai`,
  `Claude-Web`, `Google-Extended`, `PerplexityBot`).
- A comment states that content is for personal, non-commercial use and that tools or processes that
  data-mine or scrape it by automated means are prohibited without DW's prior written permission.
  The importer therefore downloads only on the user's explicit request, for that user's personal use,
  politely and without redistribution (00, "Legal position").

## Courses and editions

Nicos Weg is published in 19 interface languages (checked 2026-10-08 by asking each language's
dashboard, `/<lang>/overview`, and its section pages for courses named "Nicos Weg";
`dkLearningLevel` 2 = A1, 4 = A2, 8 = B1):

| URL segment | Our code | A1 | A2 |
|---|---|---|---|
| ar | ar | `c-36519911` | `c-36519923` |
| bs | bs | `c-63700880` | `c-64297340` |
| de | de | `c-36519687` | `c-36519709` |
| el | el | `c-61913011` | `c-61998903` |
| en | en | `c-36519789` | `c-36519797` |
| es | es | `c-47994059` | `c-47994051` |
| fa-ir | fa | `c-45477023` | `c-45477041` |
| fr | fr | `c-47994036` | `c-47994035` |
| hi | hi | `c-71245621` | `c-71245696` |
| hu | hu | `c-65959869` | `c-66442819` |
| id | id | `c-75397583` | `c-75929056` |
| pl | pl | `c-50080643` | `c-50080708` |
| pt-br | pt | `c-45457080` | `c-45476771` |
| ro | ro | `c-61583453` | `c-61816530` |
| ru | ru | `c-45476888` | `c-45476921` |
| sw | sw | `c-77498923` | — |
| tr | tr | `c-54846011` | `c-47993853` |
| uk | uk | `c-57366636` | `c-57366663` |
| zh | zh | `c-47993645` | `c-47993807` |

B1 exists in German only: `/de/nicos-weg/c-36519718`. Each page carries the interface strings of its
language (`ROOT_QUERY.i18nByLang({"lang":…}).all`, JSON): the player's "play audio" label, which
DW also writes into some exercise fields, is `exercise.playAudio` there.

- 77 = 76 lessons + final test. A1: units 0–18 with 4 lessons each, then the final test.
- Editions have different ids for the same lesson ("Hallo!" = `l-37250531` en, `l-46381195` ru);
  exercise ids differ too. URL slugs are localised but **ignored by the server**: `/ru/x/l-<id>` and
  `/ru/x/l-<id>/e-<id>` return the same pages, so URLs can be built from ids.
- Russian edition published late 2018, lessons last updated mid-2019; English edition updated until
  2020–2022.

## Pages and embedded data

Every page embeds an Apollo cache as `window.__APOLLO_STATE__ = {…}` (≈110–120 KB per page). Plain HTTP
and extraction is enough. Pages needed per lesson: the **lesson page** (overview, vocabulary, grammar,
culture and script texts, videos) and **one page per exercise** (exercise data is not on the lesson
page). A1 `ru` = 1 course page + 77 lesson pages + 1071 exercise pages.

- **Course** (`Course:<id>`): `contentLinks({"targetTypes":"LESSON"})` lists lessons in course order;
  each `ContentLink` has `groupName` = unit title in the learner's language ("1 Знакомство"; the
  first unit has no number, the final test an empty name). Unit number = order of the groups.
- **Lesson** (`Lesson:<id>`): `name` (German title, same in all editions), `description` (synopsis
  HTML), `learningTargetHeadline`, `learningTargetDescription` (goals as an HTML list), `manuscript`
  (script HTML with vocabulary placeholders), `knowledges` (vocabulary, grammar, culture),
  `videos`, `mainContentImageLink` (image with a learner-language description), `overviewParts`.
- `overviewParts` = ordered parts with `lessonPart`: `EXERCISE` (8–20 per lesson), `GRAMMAR` (0–2),
  `REGIONAL_STUDIES` (1–2), `VOCABULARY_GLOSSARY`, `MANUSCRIPT`, `DOWNLOAD`.
- **Knowledge** (`knowledgeType`): `VOCABULARY` (see below), grammar and culture entries with `name`
  and `text` (HTML with embedded images `static.dw.com/image/<id>_${formatId}.jpg`).
- **Video**: two per lesson — plain (`hlsVideoSrc` HLS master with `sd`/`hd`, a separate German
  subtitle track `https://www.dw.com/media/subtitles/<id>`, `duration` in seconds) and a variant with
  burned-in subtitles. Direct MP4s are on `tvdownloaddw-a.akamaihd.net/downloads/`: the lesson's download
  page (`l-<id>/le`) lists them in `videoResourceLinks` with `techFormat` `PODCAST_SD` / `PODCAST_HD`
  (re-edited videos: `AVC_640x360` / `AVC_1280x720`); the HLS variants name the same files.
- **Audio**: items link `Audio.mp3Src` on `radiodownloaddw-a.akamaihd.net` (2769 of 2845 A1 items
  have audio). Vocabulary entries have their own MP3.
- **Image**: `staticUrl` template `https://static.dw.com/image/<id>_${formatId}.<ext>`; `name` is an
  internal asset name (not alt text). The importer uses format id 6 (940×529).

## Exercises

`Exercise`: `name` (title), `description` (instruction HTML), `inputType` (stimulus: `NONE` 477,
`TEXT` 280, `VIDEO` 158, `IMAGE` 131, `AUDIO` 25), `inputText` (HTML info box, mostly "New words: …"
in mixed languages), `images`/`audios`/`videos`, `inquiries`. Each **inquiry** is one item (1–8 per
exercise, 2845 in A1) with `inquiryType`, `inquiryText`, `inquiryDescription` (hint: "Info", "Tip",
"Careful"), `text` (cloze text), audio, `subInquiries` and/or `alternatives` (`alternativeText`,
`isCorrect`, `images`, `order`).

All A1 exercises fall into these mechanics (count of exercises; one exercise mixes two `SORTING` kinds):

| Mechanic | Count | Our type |
|---|---|---|
| `ASSOCIATION` `SINGLE` (text or image options) | 252 | `single_choice` |
| `ASSOCIATION` `MULTIPLE` | 127 | `multi_choice` |
| `ASSOCIATION` `DIRECT` (sub-inquiries, each with its one correct partner; text or image) | 60 | `match` |
| `REPEAT` (listen, repeat, rate yourself; sub-inquiry text or a learner-language task; a second audio link, `mainContent: false`, is the answer spoken — "Lösungsaudio" — on almost every item) | 180 | `speech_selfrate` (`answerAudio`) |
| `CLOZE` `CHOOSE` (gaps filled from a shared word bank, each word once) | 153 | `gap_choice` (`bank`) |
| `CLOZE` `PULLDOWN` (options per gap) | 60 | `gap_choice` (`dropdown`) |
| `CLOZE` `WRITING` | 132 | `gap_text` |
| `SORTING` `NORMAL` / none (words, punctuation as separate parts) | 87 | `order` (`space`) |
| `SORTING` `MERGE` (letters into a word) | 10 | `order` (`none`) |
| `SORTING` with images | 3 | `order` (image parts) |
| `DICTATION` | 7 | `dictation` |

- An item's audio links carry `mainContent`: `true` is what the item asks with, `false` the answer
  read out ("…_Loesungsaudio.mp3"). Counted on 2026-10-10 over the ru-de and de-de pages: 3655
  `ASSOCIATION`, 2769 `CLOZE` and 685 `SORTING` items have only a `false` link — the answer, not a
  question to listen to; 805, 341 and 131 have both; 54 dictations have only a `true` one. Of 11 000
  `false` links, 10 834 are named "Loesungsaudio".
- The Arabic and Persian editions store German lesson titles (and two vocabulary notes) in visual
  order: "?Was trinkst du", "!(Ich mag (nicht", "?... Was passiert, wenn" for "Was trinkst du?",
  "Ich mag (nicht)!", "Was passiert, wenn …?" (58 titles in Persian A1–A2, as many in Arabic, seen on
  2026-10-10), and some texts of their own the same way (".با نه پاسخ بده": 22 speaking tasks in
  Persian, 23 in Arabic; six Persian options); other editions write them as they are read.
- Clips on items: 53 A1 `ru` exercises without a video stimulus (`inputType` `NONE`, `TEXT`, once
  `IMAGE`) link a clip on each top-level inquiry (`videos`; "watch the clip again"): in 32 every item
  links the same one, in 21 the items have different clips. Over all 38 Nicos Weg courses (every
  edition, A1–B1): 1243 such exercises, 789 with one clip for all items and 454 with the items' own
  (399 of them in A1) (counted 2026-10-11).
- A `REPEAT` item has up to three texts (A1+A2 `ru`, 1325 items): its own `inquiryText` (92: words
  to use "Zum Frühstück / essen / ich / …", a situation, a task "Sprich den Satz im Perfekt.", a
  sound "Kurzes und langes E"), the sub-inquiry's `inquiryText` (the line heard: a question or a
  sentence to change, or "Прослушать аудио" when it is heard only), and its `inquiryDescription`.
  The description in German is the source's answer — a line ("Es geht mir super.", 296 items), its
  frame ("Ja, … / Nein, …", "Ich brauche …, damit ich (Kaffee kochen können)", 463) — → `reference`;
  in the learner's language the task (locale `prompt`, 180); only "…" or "..." an answer of one's own
  (130); none: the line heard is the phrase to repeat (`text`, 237). The item's own text and a line
  heard that is answered go to `prompt`, one per line. In editions whose language shares German's
  script (en, es, fr, …) a description is not told from a task ("Say that you are fine."): it joins
  the `prompt`, no line to say.
- Vocabulary chips: words of a text linked to their vocabulary entry
  (`<span class="editable placeholder" data-id=…>`, often inside `<span class="invalid_placeholder">`)
  are shown as spaced chips, so editors left out the spaces next to them ("Wir <chip>lernen</chip>Deutsch.",
  "eine<chip>Pause</chip> .", "Mann:<chip>Guten Tag</chip>"); other fields carry double spaces and
  spaces before punctuation as typed. A chip on a compound's head ("<chip>Lamm</chip>fleisch",
  "<chip>Frosch</chip>beinen": 3 compounds, one A2 text) reads in the markup exactly as a chip before a
  word of its own whose space was left out ("<chip>Garage</chip>haben", "<chip>Birnen</chip>meiner",
  "Am <chip>Montag</chip>spiele": some 80 texts); a hyphen next to a chip has no space
  ("<chip>Massage</chip>-<chip>Gutschein</chip>", "<chip>Wellness</chip>-Hotel").
- Cloze texts mark gaps with `#p#`, `#ps#`, `#pm#`, `#pl#` (width hints); layout `CONTINUOUS_TEXT`
  (gaps in the inquiry `text`) or `SINGLE_SENTENCE` (one gap per sub-inquiry `inquiryText`).
- Options with identical content occur (repeated letters in `MERGE`, "isst" twice in a conjugation
  match): any of them is correct in that position.
- Image options carry an asset name as `alternativeText`; it is not content and is dropped.
- No `classify`-like mechanic and no free-text answers exist in A1.
- The final test (`Итоговый тест A1`, 20 exercises) uses the same mechanics and has no time limit or
  pass mark: it is a lesson.

## Which strings are learner language

Compared field by field between A1 `ru` and `en` (lessons 1–5, 49 exercise pairs):

- Same in both editions (German, canonical): lesson `name`, cloze texts and options, sorting parts,
  dictation texts, association options and most sub-inquiry texts.
- Different (learner language, locale): lesson `description`, `learningTargetDescription`, exercise
  `name`, `description`, `inputText` (mixed), every `inquiryDescription`, `groupName`.
- `inquiryText` is usually German but is sometimes the UI label "Прослушать аудио" / "Play audio"; that
  label is not content and is dropped. `REPEAT` sub-inquiries sometimes hold a learner-language task
  ("Say hello and …") instead of German text.
- Hence the normaliser decides per mechanic and field, not by language detection.
- Editions differ in details: option order, small punctuation ("Guten Morgen" vs "Guten Morgen."),
  and partly the vocabulary lists. Aligning editions (stage 11) must match options by text and
  cannot rely on identical fingerprints.

## Vocabulary

`Knowledge` with `knowledgeType: VOCABULARY`: `name` (headword), `subTitle` (German grammar note or
forms), `text` (translation HTML), `audios[].mp3Src`, optional image. A1 has 1865 entries (1707 lemmas).

| Headword shape | Entries | Part of speech |
|---|---|---|
| article + noun, plural ("die Frau, die Frauen") | 762 | noun + gender |
| article + noun, no plural ("die Musik" + "nur Singular") | 93 | noun + gender |
| "die Eltern (Plural)" | 9 | noun, plural only |
| `subTitle` with three verb forms ("studiert, studierte, hat studiert") | 289 | verb |
| `subTitle` with comparison ("besser, am besten") | 147 | adj |
| sentence or 3+ words ("Es geht mir gut.") | 182 | phrase |
| one or two words without grammar info ("auch", "sehr gut", "(das) Deutsch") | 383 | word (or noun when an optional article is given) |

- Verbs carry valency in parentheses: "(etwas) studieren", "(jemandem) helfen".
- Only 7 lemmas occur both as `word` and as another part of speech, and all are distinct words
  ("Frau" as a title vs "die Frau", "morgen" vs "der Morgen", "weg" vs "der Weg").
- Seven lessons list the same lemma twice ("der/die Bekannte", "fett"/"das Fett", "ihr(e)" ×3).

## A2 and B1 samples

- A2 `ru` lesson 1 and B1 `de` lesson 1 use only the mechanics above.
- B1 (German-only edition) has no `VOCABULARY` entries: its glossary is `knowledgeType: GLOSSARY` with
  German definitions instead of translations and headwords like "Arbeitsmarkt, -märkte (m.)",
  "Agentur für Arbeit (f., nur Singular)" — a different parser (not handled).

## Downloads and media sizes

- PDFs on `static.dw.com/downloads/<id>/…`: script + vocabulary (per edition language), teacher guide,
  grammar overview, workbook A1–B1.
- `static.dw.com` returned HTTP 403 to requests from cloud IP ranges; from a home connection it works.
- Rough size: A1–B1 videos ≈ 1.6 GB in SD.

## Legal page

Legal notice names Deutsche Welle (Anstalt des öffentlichen Rechts); the course was produced on behalf
of the Bundesagentur für Arbeit with support of Cornelsen. No open licence is stated.

## Community references (not dependencies)

- `lightsongjs/DW-Nicos-Weg` — episode scripts A1–B1.
- `alexplusplus/DW-Nicos-Weg-A1` — A1 scripts with Russian translations (2018).
- Anki generators from DW vocabulary pages: `brkhrdt/dw_anki`, `AradiPatrik/nicosweg-to-anki`,
  `tpotie/DW_Audio_Downloader`.
