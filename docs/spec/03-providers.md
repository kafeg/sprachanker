# 03 — Providers (importers)

A provider turns an external source into library content (02). Each provider is a workspace package in
`courses/<provider>/` with `src/` (course list, fetch, normalise) and `test/` (on SYNTHETIC inputs only —
never real third-party content). Our enrichment will live next to it (02, planned).

## Provider contract

`packages/course-kit/src/provider.ts` is the contract every provider follows:

- An import function takes `ImportOptions` (library folder, optional `courses` / `editions` filters,
  `refresh`, `log`) and returns an `ImportReport`: failed media and, per "<course> <edition>", a
  `NormaliseResult` (lessons, unknown exercises, files that failed validation).
- Normalised files are `LibraryFile`s (path, schema, value) written by `writeLibraryFiles`, which
  validates each one; raw pages are fetched once through `storedPage`.
- `packages/server/src/providers.ts` maps CLI provider ids to import functions (`dw-nicos-weg`,
  `dw-deutschtrainer`, `coerll-dib`); `importCourse` runs one into `<data-root>/library`.

`course-kit` also supplies the polite HTTP client (`http.ts`: robots.txt, retries with backoff,
identifiable User-Agent, stop on 403/429; no fixed rate limit, providers choose their concurrency),
the media store and media index (`media-index.ts`, 02), the HTML sanitiser, fingerprints and the
library reader.

## Importer behaviour (all providers)

- **On demand only**, from the CLI (`sprachanker import <provider> --courses a1 --editions ru-de`);
  from the UI later (install job, 06).
- **Idempotent and resumable.** Stored raw pages are not fetched again unless `--refresh`; stored media
  are skipped, failed media are tried again on the next run.
- **Two phases in one command.** Fetch writes `raw/` + `media/`; normalise then builds canonical +
  locale files offline from them.
- **Reports** unknown exercises (`unmapped`), files that failed validation, media that failed.
- Planned: no partial installs visible (a course appears only after normalise + verify), one import
  per series at a time (lock file).

## 1. DW Learn German (`courses/dw`)

One provider for the DW platform: every DW course has the same page model (course → lessons →
exercise pages, `window.__APOLLO_STATE__`), so one fetcher and normaliser serve all of them. Each DW
course is its own series: `dw-nicos-weg` → `dw.nicos-weg`, `dw-deutschtrainer` → `dw.deutschtrainer`
(100 short A1–A2 lessons on words and phrases by topic, course `a1-a2-ru`, edition `ru-de`; also in
uk, pl, tr, ar, not en). Each language edition of a DW course is a course of its own (01): `a1-ru`
and `a1-en` are normalised separately from their own pages (`raw/<edition>/<DW course>/`).

### Nicos Weg (`dw-nicos-weg` → `dw.nicos-weg`)

Source facts: `docs/research/dw-nicos-weg.md`. Closed licence: personal use.

- Courses and source ids: `courses/dw/src/catalog.ts` — `a1-ru`, `a1-en`, `a2-ru`, `a2-en`, `b1-de`.
- **Fetch** (`courses/dw/src/pages.ts`): the course page (lesson order, unit groups), per lesson its
  page (overview, vocabulary, grammar, culture, script, videos) and its download page (`…/le`), and one
  page per exercise; URLs are built from ids. The embedded state JSON (`window.__APOLLO_STATE__`) is
  stored in `raw/<edition>/<course>/` (`course.json`, `l-<id>.json`, `le-<id>.json`, `e-<id>.json`),
  not full HTML.
- **Media** (`courses/dw/src/media.ts`): every MP3 the pages link (items, vocabulary, lessons); images
  in format 6 (940×529); episode videos as direct MP4s in SD and HD (from the download page, else
  remuxed from the HLS stream), not the variant with burned-in subtitles; the German subtitle track;
  the lesson PDFs. Hosts refusing requests are reported.
- **Normalise**: the mechanics table in `docs/research/dw-nicos-weg.md` maps every DW mechanic to a
  type (02); an unseen combination → `unknown` + report. Units are the course's lesson groups in
  order (`u00`…); the final test is a lesson in its own unit after the last one (A1: `19-01`).
  Learner-language fields are fixed per mechanic and field (research, "Which strings are learner
  language"); the "Play audio" label is dropped; image options keep only the image. Vocabulary
  headwords give part of speech, gender, plural and forms as in 02; valency in parentheses ("(etwas)
  studieren") stays in the headword and not in the lemma.
- Planned: **B1** has a German glossary (`GLOSSARY`, definitions instead of translations) that needs its
  own vocabulary parser; until then B1 lessons have no vocabulary.

## 2. Leben in Deutschland (`bamf-lid` → `bamf.lid`, edition `de-de`; planned, stage 9b)

Official BAMF question catalogue (PDF): 300 general questions + 10 per federal state. A test has 33
questions (30 general + 3 for the learner's state), 60 minutes; 15 correct passes the course test, 17 are
needed for naturalisation — both shown. Modes: browse, my state, timed exam, practise wrongly answered
questions. Questions are shown in German; translations only where the source has them (no machine
translation: course content is not generated, 00).

## 3. COERLL — Deutsch im Blick (`coerll-dib` → `coerll.dib`, edition `en-de`)

2nd edition (2017), **CC BY 4.0** only (the 2013 edition is CC BY-NC-ND and MUST NOT be used); the
attribution is the course description. Facts: `docs/research/coerll-dib.md`. Shows that the schema is
not DW-shaped: an `en-de` edition with English learner strings and no exercises.

- **Fetch**: `toc.php?k=1..10` and `voc.php?k=1..10` stored as HTML under `raw/en-de/dib/`; media: the
  recording of each vocabulary section and the chapter's textbook PDF.
- **Normalise**: a chapter is a unit (title from the chapter page), a vocabulary section a lesson
  (`<chapter>-<section>`) with its words, its recording as `media.audio` and no pages — the site has no
  interactive exercises; they are in the textbook PDF, a download of the chapter's first lesson.
  Headwords as the book writes them ("der Apfel (Äpfel)", "(no plural)", "(plural only)") give
  gender and plural; verbs and phrases by shape.
- Planned (after MVP): the interviews (several videos per topic with parallel de/en transcripts) —
  they need lessons with more than one video and transcript pages (02); web quests; pronunciation.

## 4. Lingust «Правильный английский» (`lingust-english` → `lingust.english`, edition `ru-en`)

Free online course (© Lingust, no open licence), 52 lessons A1–B1+ with Russian explanations. Facts:
`docs/research/lingust-english.md`.

- **Fetch**: the index, `lesson1…52` and `irregular-verbs` as HTML; recordings via `fetchMedia`. The site
  serves MP3s only with a `Referer` of its lesson pages (hotlink protection); the importer sends it for
  `/media/` requests. `/images/` is disallowed by robots and not fetched; locked (paid) players are skipped.
- **Normalise**: the index's stages are units (plus a bonus unit with the irregular-verbs table); lesson
  text before «Словарь» → grammar pages; each section's example recordings with their lines →
  `speech_selfrate`; the first full-width recording → `media.audio`; «Словарь» → vocab (IPA in `note`);
  exercises with the tooltip answer keys → `gap_text` / `gap_choice` / `respond` (model answers as
  `reference`, `answerIn: "learner"` with locale model answers for translations into Russian; "no
  article" gaps accept ""; comma check boxes → `gap_choice`, several right options where the key allows);
  word grids → one `respond` per row; retell/read-aloud → `speech_selfrate`; tasks without answers →
  `tabs.homework`.

## 5. VOA «Так говорят в Америке» (`voa-english-usa` → `voa.english-usa`, edition `ru-en`)

Голос Америки, 2001–2002: 104 lessons plus two review lessons; VOA staff material is public domain
(credit «Голос Америки»). Facts: `docs/research/voa-english-usa.md`.

- **Fetch**: the site has no index; the article paths of the lessons and the folders of their MP3s are a
  URL manifest in `src/catalog.ts` (found once through the sitemap). Articles as HTML, MP3s via
  `fetchMedia` (av.voanews.com).
- **Normalise**: «Цель» → the lesson goal; «Содержание» → synopsis; the dialogue → `tabs.script`; words and
  phrases → vocab (part of speech from the source's headings, else by shape; example sentences as the
  entry's `examples`); grammar and usage notes → grammar pages; the homework → `tabs.homework`; the MP3 → `media.audio`. There
  are no exercises: the homework has no answers anywhere. Units of 10 lessons.

## 6. VOA «Let's Learn English» (`voa-lets-learn-english` → `voa.lets-learn-english`, edition `en-en`)

VOA Learning English, public domain: Level 1 (52 lessons) and Level 2 (30 lessons and 5 reviews) as
courses `level-1`, `level-2`. Facts: `docs/research/voa-lets-learn-english.md`.

- **Fetch**: landing pages, lesson articles, document pages and quiz pages as HTML; renditions from the
  pages' `data-sources`: main video `sd` 360p and `hd` 720p, practice and quiz clips `sd` only, the 64 kbps
  conversation MP3, lesson-plan PDFs. About 9.3 GB in all (720p main videos are 60%).
- **Normalise**: the landing pages' groups are units; main video → `media.video`, conversation →
  `media.audio`, transcript → `tabs.script`, its bold words → vocab (no definitions: those are only in the
  PDFs); Speaking Practice and Pronunciation videos → `speech_selfrate` with the video as exercise media;
  the listening quiz → `single_choice` with each question's clip. Quiz answers come by GET: even `page`
  values of `/Quiz/Start` show the result view with the correct option marked — nothing is POSTed.

## Later

- **SprachAnker Starter English** (`sa-starter-en` → `sprachanker.starter-en`): small ru → en course
  authored by us, with open data fetched at runtime (Tatoeba, Wiktionary via kaikki.org) and per-item
  attribution.
- Goethe-Zertifikat A1 practice sets, more DW courses, readers.

## Rules for every provider

- No third-party content in the repository, including fixtures and tests.
- No brand assets of the source used as SprachAnker branding; the source is shown only as attribution.
- Crawling as above; stop and report on 403/429.
- Licence and attribution recorded in the manifest and displayed in the UI (planned with the manifest,
  02; Deutsch im Blick already carries its CC BY attribution in the course description).
