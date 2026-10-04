# Research — DW Nicos Weg

Facts observed on learngerman.dw.com (October 2026). Re-verify during stage 1; update this file.

## Courses and editions

| Level | Edition | Course page | Entries |
|---|---|---|---|
| A1 | en | `/en/nicos-weg/c-36519789` | 77 |
| A1 | ru | `/ru/nicos-weg/c-45476888` | 77 |
| A2 | en | `/en/nicos-weg/c-36519797` | 77 |
| A2 | ru | `/ru/nicos-weg/c-45476921` | 77 |
| B1 | de | `/de/nicos-weg/c-36519718` | 77 (German interface only; no en/ru) |

- 77 = 76 episodes + final test (e.g. `/ru/итоговый-тест-a1/l-46680726`).
- Editions have different ids for the same lesson: "Hallo!" = `l-37250531` (en), `l-46381195` (ru).
  Exercise ids differ too. Slugs are localised (ru slugs in Cyrillic, URL-encoded).
- Russian edition: published late 2018, lessons last updated mid-2019. English edition: lessons updated
  until 2020–2022. Sampled lessons (A1 1, 38, 75; A2 1, 38, 75) have equal exercise counts and vocabulary
  sizes across editions; lesson A1 1 has the same 12 exercises in the same order with the same types.
- Overview pages: `/en/beginners/s-62078399`, `/ru/начинающие/s-62628136`, `/de/fortgeschrittene/s-62079033`.

## Lesson page kinds (A1 lesson 1, en)

| Path | Content |
|---|---|
| `/en/hallo/l-37250531` | overview: synopsis, goals, video, list of exercise pages |
| `/en/<slug>/l-37250531/e-<id>` | exercise page (12 for lesson 1; first is the episode with questions) |
| `/en/<slug>/l-37250531/gr-<id>` | grammar ("Informal and formal (1)") |
| `/en/hallo/l-37250531/lv` | vocabulary (30 entries: word, article/plural, note, translation) |
| `/en/<slug>/l-37250531/rs-<id>` | culture ("Greetings in German") |
| `/en/hallo/l-37250531/lm` | script (audio course part + episode dialogue) |
| `/en/hallo/l-37250531/le` | downloads (PDFs, MP4 links) |

## Embedded data

Every page embeds an Apollo cache as `window.__APOLLO_STATE__ = {…}` in a `<script>` (≈80–100 KB). No
client-side rendering is needed to get data; plain HTTP + extraction works.

Observed `__typename`s: `Lesson`, `Exercise`, `Inquiry`, `Alternative`, `Knowledge`, `Image`, `Video`,
`Navigation`, `Course`, `Article`, `ContentLink`.

- `Lesson`: `name`, `description`, `teaser`, `manuscript` (HTML), `knowledges`, `contentLinks`,
  `firstPublicationDate`, `lastPublicationDate`, `dkLearningLevel`.
- `Exercise`: `name`, `description` (instruction HTML), `inputType`, `inputText`, `inquiries`, `images`,
  `audios`, `videos`, `knowledges`, `lastPublicationDate`.
  Observed `inputType`: `VIDEO`, `NONE`, `TEXT`, `IMAGE`.
- `Inquiry`: `order`, `inquiryText`, `inquiryDescription`, `images`, `alternatives`, `clozeType`.
- `Alternative`: `alternativeText`, `isCorrect`, `images`.
- `Knowledge`: `knowledgeType` (`VOCABULARY`, …), `shortTitle` (word), `text` (translation HTML),
  `subTitle`, `name`.
- `Image`: `staticUrl` template `https://static.dw.com/image/<id>_${formatId}.jpg` — format ids to be
  determined from page `<img>` srcsets.

## Exercise kinds seen in lesson 1 (en)

video + comprehension · listen and pick lines heard (multi) · photo → greeting (single) · listen → which
question (single) · listen and repeat + self-rating · emoji/picture → fitting answers (multi) · read
example, listen, order dialogue lines · choose Herr/Frau (gap) · time → greeting (single) · match
text to picture · respond to prompt + self-rating. Pages introduce "New words" and show "Info" boxes.

## Media and downloads

- Videos: `https://tvdownloaddw-a.akamaihd.net/downloads/Events/mp4/nicosweg/A1_E0_L1_F1_{sd,hd}.mp4`
  (≈7 MB SD, 22 MB HD for episode 1); subtitled versions under `…/dwtv_video/flv/nicosweg/de/…`.
- PDFs on `static.dw.com/downloads/<id>/…`: script + vocabulary (per edition language), teacher guide
  ("Lehrerhandreichung und Übungen", 4 pages: before/during/after viewing + extra activities + 3
  exercises), grammar overview (level), workbook A1–B1.
- `static.dw.com` returned HTTP 403 to requests from cloud IP ranges; from a home connection it works.
- Rough size: A1–B1 videos ≈ 1.6 GB in SD plus ≈ 2.7 GB for subtitled SD (≈12 MB per episode); media are
  shared between editions.

## Legal page

Legal notice names Deutsche Welle (Anstalt des öffentlichen Rechts); the course was produced on behalf
of the Bundesagentur für Arbeit with support of Cornelsen. No open licence is stated.

## Community references (not dependencies)

- `lightsongjs/DW-Nicos-Weg` — episode scripts A1–B1.
- `alexplusplus/DW-Nicos-Weg-A1` — A1 scripts with Russian translations (2018).
- Anki generators from DW vocabulary pages: `brkhrdt/dw_anki`, `AradiPatrik/nicosweg-to-anki`,
  `tpotie/DW_Audio_Downloader`.
