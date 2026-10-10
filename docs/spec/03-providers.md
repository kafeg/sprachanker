# 03 — Providers (importers)

A provider turns an external source into library content (02). Each provider is a workspace package in
`courses/<provider>/` with `src/` (course list, fetch, normalise) and `test/` (on SYNTHETIC inputs only —
never real third-party content). Our enrichment goes next to it (02).

## Provider contract

`packages/course-kit/src/provider.ts` is the contract every provider follows:

- A provider is a `CourseProvider`: its id (the CLI's and the downloads'), the series folder it
  writes, its offers and its import. Each provider package exports its own (DW one per series); the
  server's test checks every one against the contract (unique ids and series, offers with valid keys).
- An import function takes `ImportOptions` (library folder, optional `courses` / `editions` filters,
  `refresh`, `log`, `progress`) and returns an `ImportReport`: failed media and, per "<course>
  <edition>", a `NormaliseResult` (lessons, unknown exercises, files that failed validation).
- Each provider offers its courses as `CourseOffer`s (course, edition, title, source, approximate size
  measured on a full download; `kind: "exam"` for a course of exams, offered in the Exams section),
  known without the network: the catalogue lists them before anything is downloaded.
- Progress: pages read or fetched (`rawPages`), media fetched of those missing with their bytes
  (`fetchMedia`), normalising.
- Normalised files are `LibraryFile`s (path, schema, value) written by `writeLibraryFiles`, which
  validates each one; raw pages are fetched once and kept through `rawPages` (`importing.ts`, with
  the report: `importReport` from the media index, `emptyReport` when nothing was asked for).
- `packages/server/src/providers.ts` lists the providers (`dw-nicos-weg`, `dw-deutschtrainer`,
  `coerll-dib`, …); `importCourse` runs one into `<data-root>/library`; `courseInstaller` is what the
  download job uses (06).

`course-kit` also supplies the polite HTTP client (`http.ts`: robots.txt, retries with backoff,
identifiable User-Agent, stop on 403/429; no fixed rate limit, providers choose their concurrency; a
browsing session for a site run by forms — its cookies kept, forms posted, redirects followed),
the media store and media index (`media-index.ts`, 02), the HTML sanitiser, fingerprints and the
library reader, and the helpers normalisers share: a lesson's vocabulary entries from headwords
(`vocab.ts`: keys, numbered duplicates, translations), plain text and entity decoding, HTML escaping,
exercises drafted and checked against their type's schema where they are made (`exercise-draft.ts`:
`draftExercise`, `Unmapped`, `unknownExercise`), the key map (`key-map.ts`), and two scripts told
apart in one line (`CYRILLIC`, `latinLetters`, `splitAtCyrillic`).

## Offered in the app

A provider declares whether it is ready for learning (`CourseProvider.stable`): DW Nicos Weg
(`dw.nicos-weg`, every edition) and Leben in Deutschland (`bamf.lid`). Every other provider is
experimental (owner, 2026-10-10): its catalogue entries say so (`experimental`), and its courses and
exams are shown only once the learner turns on their section and the source in Settings →
Experimental (09).

Every provider's courses are offered in Courses → Available (owner, 2026-10-08), unfiltered until the
learner narrows them by pair or course (owner, 2026-10-10: nothing sets a filter for them). A course taken
out of the library keeps working where it is remembered: its cards (their text is kept with them), its
runs (left out of progress), its pages say it is not installed.

## Importer behaviour (all providers)

- **On demand only**: "Download" in Courses → Available (a background job, 06) or the CLI
  (`sprachanker import <provider> --courses a1 --editions ru-de`). Content goes from the source site to
  the learner's machine; nothing is hosted by us.
- **Gone at the source**: a medium the source answers 404 or 410 for is reported apart ("not at the
  source") and tried again on the next run, but leaves no course incomplete — the normaliser leaves it
  out; other failures (network, refusals, server errors) make the course incomplete until fetched.
- **Idempotent and resumable.** Stored raw pages are not fetched again unless `--refresh`; stored media
  are skipped, failed media — and stored ones gone from the disk — are fetched again on the next run.
  Every file is written whole or not at all (a temporary file, flushed, renamed: `writeFileAtomic`),
  so an import stopped midway never leaves a half page, lesson or index that a later run would take
  as stored; the temporary files and the downloads it left are removed by the series' next import. Media are streamed to disk (never held whole in memory), each URL fetched once; a name
  from the source is a plain file name under its kind's folder, nothing that walks out. A connection
  silent for 60 s counts as failed and is retried.
- **Normalising again** writes a course whole: the files of its courses that this normalisation no
  longer produced (a lesson the source dropped or renumbered) are removed (`libraryWriter`).
- `--courses` / `--editions` select what is imported in every provider (`wanted`); a provider with one
  course imports nothing when it is not asked for.
- **Phases.** Fetch the pages into `raw/` and the media into `media/`, then normalise offline and
  deterministically. A course is installed (can be opened) once it is normalised; until then its card
  shows the download. Media that failed leave it `incomplete` — it opens, its card counting the
  files missing — until a later download fetches them.
- **Reports** unknown exercises and left-out words (`unmapped`), files that failed validation, media
  that failed — a host that refused (403/429, also on robots.txt) records every file of it not fetched,
  so the download stays marked incomplete. A robots.txt that could not be read is asked again later.
- One download at a time (the job queue) and one import per series across processes (a lock folder
  with the owner's pid, made elsewhere and renamed into place so it is never seen without its owner;
  taken over when that process is gone or is no SprachAnker), so the CLI and the server never write one `media.json`
  together.

## 1. DW Learn German (`courses/dw`)

One provider for the DW platform: every DW course has the same page model (course → lessons →
exercise pages, `window.__APOLLO_STATE__`), so one fetcher and normaliser serve all of them. Each DW
course is its own series: `dw-nicos-weg` → `dw.nicos-weg`, `dw-deutschtrainer` → `dw.deutschtrainer`
(100 short A1–A2 lessons on words and phrases by topic, course `a1-a2-ru`, edition `ru-de`; also in
uk, pl, tr, ar, not en). Each language edition of a DW course is a course of its own (01): `a1-ru`
and `a1-en` are normalised separately from their own pages (`raw/<edition>/<DW course>/`).

### Nicos Weg (`dw-nicos-weg` → `dw.nicos-weg`)

Source facts: `docs/research/dw-nicos-weg.md`. Closed licence: personal use.

- Courses and source ids: `courses/dw/src/catalog.ts` — A1 and A2 in every language DW publishes them
  (19: ar, bs, de, el, en, es, fa, fr, hi, hu, id, pl, pt, ro, ru, sw — A1 only —, tr, uk, zh; owner,
  2026-10-08), `a1-<lang>`, `a2-<lang>`, and `b1-de`. The editions of a level share their media (same
  URLs), so another edition adds its pages and a few images (~110 MB), not the videos.
- **Fetch** (`courses/dw/src/pages.ts`): the course page (lesson order, unit groups), per lesson its
  page (overview, vocabulary, grammar, culture, script, videos) and its download page (`…/le`), and one
  page per exercise; URLs are built from ids. The embedded state JSON (`window.__APOLLO_STATE__`) is
  stored in `raw/<edition>/<course>/` (`course.json`, `l-<id>.json`, `le-<id>.json`, `e-<id>.json`),
  not full HTML. A stored page without the lesson or exercise it is for is fetched once more (DW
  serves an empty content now and then). An exercise page the source no longer serves (404), or
  still serves without its exercise, is left out and reported; the lesson keeps the others under their own numbers.
- **Media** (`courses/dw/src/media.ts`): every MP3 the pages link (items, vocabulary, lessons); images
  in format 6 (940×529); episode videos as direct MP4s in SD and HD (from the download page, else
  remuxed from the HLS stream), not the variant with burned-in subtitles; the German subtitle track;
  the lesson PDFs. Hosts refusing requests are reported.
- **Normalise**: the mechanics table in `docs/research/dw-nicos-weg.md` maps every DW mechanic to a
  type (02); an unseen combination → `unknown` + report. Units are the course's lesson groups in
  order (`u00`…); the final test is a lesson in its own unit after the last one (A1: `19-01`).
  Learner-language fields are fixed per mechanic and field (research, "Which strings are learner
  language"); the player's "play audio" label is dropped — read from the page's own interface strings
  (`exercise.playAudio`), so every edition language is covered; image options keep only the image. An
item's recordings are told apart by DW's own flag: its main content (`mainContent`) → `media.audio`,
heard before answering; one that is not ("…_Loesungsaudio.mp3": most items' only recording, the answer
read out) → `answerAudio`, offered once checked (a dictation's only recording is what it dictates). The
Arabic and Persian editions keep some texts in the order they are seen, closing punctuation first —
German ("?Was trinkst du", "!(Ich mag (nicht") and their own (".با نه پاسخ بده"): a title, note, prompt,
task or option of theirs that starts with such a run and does not end in punctuation is read as written
("Was trinkst du?", "Ich mag (nicht)!"); one that opens with a bracket is the text's own. Vocabulary
  headwords give part of speech, gender, plural and forms as in 02; valency in parentheses ("(etwas)
  studieren") stays in the headword and not in the lemma. Grammar and culture pages: DW numbers the
  parts of a topic ("Spelling (2)", in the edition's own digits and brackets: "(۲)", "(२)", "（2）"; titles compared with full-width forms as plain ones and spaces ignored); the parts within a lesson are joined into one page, the number
  leaves the title and a topic begun in an earlier lesson keeps it as `part` (02). Exercise titles keep
  their numbers ("Im Unterricht (1)", "(2)"): they tell apart exercises of one topic in a lesson.
- **B1** lessons have no vocabulary: B1 has a German glossary (`GLOSSARY`, definitions instead of
  translations) not read yet (plan, "More sources").

## 2. Leben in Deutschland (`bamf-lid` → `bamf.lid`, course `lid`, edition `de-de`)

BAMF's question catalogue for the "Leben in Deutschland" test and the naturalisation test as one exam
(`bamf.lid/lid/exam-test`; research `docs/research/exams.md`): 300 general questions and 10 for each
federal state. A test has 33 questions (30 general, 3 of the learner's state), 60 minutes; 15 right pass
the "Leben in Deutschland" test, 17 the naturalisation test — both shown. The catalogue is German only
and shown as it is: no translation is made (content is never generated, 00). Offered in the Exams
section (`kind: "exam"`), not among the courses.

- **Fetch** (`courses/bamf-lid/src/import.ts`): the catalogue PDF stored as published
  (`raw/de-de/lid/gesamtfragenkatalog.pdf`); then BAMF's online test centre (`oet.bamf.de`, an Oracle
  APEX application) page by page through a browsing session (`fetcher.session()`: its cookies kept, its
  forms posted as a browser posts them, one request every 500 ms): the general questions with one state
  chosen, each state's 301–310 with that state chosen — about 470 pages, each kept as
  `raw/de-de/lid/centre/<general|state>/<NNN>.html`. A page that is not the question asked stops the
  import.
- **Read** (`pdf.ts`, `catalogue.ts`, `centre.ts`): the PDF through pdf.js — text lines with their place,
  pictures decoded with their box; sections by "Allgemeine Fragen" and "Fragen für das Bundesland …",
  questions by "Aufgabe N", options by the box before each, a line after an option continuing it; the
  number some stems repeat ("184.   …") dropped; pictures belong to the question above them on their
  page, a row as many as the options being the options' pictures ("Bild 1" … "Bild 4", left to right),
  a single one the question's; what is printed below a picture ("© …", "In Anlehnung an …") is its
  `credit`. A test centre page gives its number and the right option, marked twice in the page (its row
  and its radio button), which must agree.
- **Pictures** (`png.ts`): each saved as a PNG (scaled to at most 1200 pixels on its longer side) through
  `fetchMedia` with a URL naming the PDF's content and the question (`…pdf#pdf=<sha>&q=<id>&at=<place>`),
  so a new catalogue's pictures are taken anew.
- **Normalise** (`normalise.ts`): each question joined with its test centre page by part and number; its
  options as the PDF prints them, the right one as the test centre marks it — only where both list the
  same options word for word (the order of words inside an option aside: "Bürger/Bürgerin",
  "Bürgerin / Bürger"); a question the sources disagree on, or whose page was not read, is left out and
  reported. Keys `q-001` … `q-300`, `q-<state>-01` … `-10` (ISO 3166-2 codes); tags
  `{ federalState }`; sections `s-general` (draw 30) and `s-state` (draw 3, filtered by the profile's
  `exam.federalState`); pass marks `lid` 15 and `naturalisation` 17. The catalogue's date ("Stand: …")
  is in the course's description; a catalogue without one is refused. Its sources (02): the catalogue
  (its copy's sha256) and the test centre, each question's place in both ("Saarland, Aufgabe 1";
  "Frage 301 (Saarland)"), the checks: 460 questions read, options the same word for word,
  answers marked twice, pictures kept.

## 2b. Goethe-Zertifikat model tests (`goethe` → `goethe.zertifikat`, courses `a1`, `a2`, `b1`, edition `de-de`)

Each level's Modellsatz from the Goethe-Institut's accessible online version (`bfu.goethe.de/a1_sd1/`,
`a2_mod_2MX5/`, `b1_mod/`; research `docs/research/exams.md`) as one exam of modules
(`goethe.zertifikat/<level>/exam-modellsatz`): Hören, Lesen, Schreiben and Sprechen, every Teil,
question, option, picture, recording and right answer, and each writing and speaking task with the
criteria it is rated by. German only and shown as it is. Offered in the Exams section.

- **Fetch** (`courses/goethe/src/import.ts`): plain GET over HTTPS, one request every 300 ms: each
  module page (`raw/de-de/<level>/<module>.html`), the solution page each Teil's form names
  (`raw/de-de/<level>/solutions/<name>.html`; a form posting back to its own page has none), the pages
  holding the text of a picture (`longdesc`) or of a writing task (B1's guestbook link,
  `raw/de-de/<level>/texts/`); every recording (`.mp4`, sound only) and picture into media, named
  `<level>-<file>`.
- **Read** (`page.ts`, `teile.ts`, `solutions.ts`): a module page from its "Inhalt" anchor as a tolerant
  tree (course-kit `parseHtml`; the markup is not well-formed) into blocks in document order — a Teil's
  heading (`h3` "Teil N"), headings, paragraphs, pictures, recordings (the n-th audio player is the
  page's n-th entry of its `var audio = [...]` list; the links beside the players are wrong on some
  pages), forms, fieldsets (legend, options with their pictures, a one-letter answer box, tables written
  out as text) and tables of one-letter answers. Teile are put together from them: instructions until
  the first question or label heading ("Text - Teil 1", "Die Aufgaben 6 bis 10"); the material after a
  label (a text, pictures, a recording, the letters a–j of ads or pictures answered by letter); a
  question per item heading ("Aufgabe N", "Beispiel 0", "Situation N") or fieldset, an example being one
  whose answer is marked already. A recording inside a question before its options is the question's,
  one after a group of questions (B1) the group's — the Teil's when it is all of them. A form opened
  before its Teil's heading belongs to that Teil; "Teil 2 Text 1/2" are two sections sharing a
  solution page. A solution page is a list ("Lösung: …") or a table (number, the right answer,
  alternatives by " / "). The Schreiben page is read on its own (`writing.ts`): per Teil ("Teil N",
  B1 "Aufgabe N") the task before its form (paragraphs, the points to write about as "• …", a picture
  and a linked text), then either a form to fill in — its lines in order: fields filled in, gaps
  numbered "(n)", a choice under the line naming it — or a box to write in, and after the form the
  criteria: levels with their points and meaning under each title (A1), a table of bands A–E whose
  rows are a criterion's aspects (A2, the note "Wird das Kriterium … mit E … bewertet" voiding it), or
  each criterion's maximum (B1).
- **Normalise** (`normalise.ts`): a module per page — timed by the page ("Reguläre Prüfungszeit: …",
  else its Teile's), scaled as the regulations (Durchführungsbestimmungen) say: A1 each part × 1.66 and
  the sum rounded, A2 × 1.25, B1 to 100 rounded to whole points (its table: 29 → 97) — and a section
  per Teil with its instructions
  in the locale, its text, recording or picture, how often its recordings play (its instructions:
  "einmal", "zweimal") and its examples. Questions numbered in the module's order (a heading's own
  number checked against it) as `single_choice` items: options as the page gives them (picture options
  with their descriptions in the locale), or for a Teil answered by letter the letters alone with
  "X"/"0" for none where the Teil has it, its ads or pictures (and an ad's text page) once as the
  section's `letters`; the right one from the Teil's solution page by number (by order where a page numbers its own Teil
  from 1), matched by its text, its letter ("Bild c") or letter and text. A question no answer matches is
  left out and reported. Keys `q-<module>-<n>`, examples `q-<section>-bsp<n>`, sections
  `s-<module>-<teil>`. Its sources (02): every module and solution page with its copy's sha256, each
  question's place ("Teil 1, Aufgabe 2") and its answer's ("Lösung 2"), the checks: questions read,
  answers matched, numbers, recordings placed, media kept, writing criteria read. Schreiben
  (`writing-exam.ts`): a form's gaps as questions from its solution page (`gap_text` with the
  alternatives, a choice as `single_choice`; keys `q-schreiben-<teil>-<n>`), the form's lines the
  section's text; a text to write as a `respond` item (`q-schreiben-<teil>`) with criteria (02):
  "pro Inhaltspunkt" one per point of the task (A1), else one per criterion (ids from titles); each
  level's points as the page gives them, else the model test's score sheet's bands for the criterion's
  maximum (catalog: A2 5 / 3.5 / 2 / 0.5 / 0, its page naming no maximum; B1 10 / 7.5 / 5 / 2.5 / 0,
  6 / 4.5 / 3 / 1.5 / 0, 4 / 3 / 2 / 1 / 0, "Erfüllung" voiding), what each level means in the locale
  where the page says it. Sprechen (`speaking.ts`, `speaking-exam.ts`): the page's parts ("Teil 3 -
  Prüfungsteilnehmer/-in A", "Aufgabe 2 A – …"), each with its lines, cards or slides (a picture and
  what its description says: a slide's text, a card's theme and word) and linked texts (A2's
  calendars), candidate A's or B's where the page says so; a section per part number with one
  `respond` item said aloud (`input: speech`, `q-sprechen-<n>`): the learner's (A's) cards as the
  section's letters (a card shown only as a picture takes its linked text), B's lines, cards and texts
  the item's `partner`; criteria as the page lists them (B1 "Bewertung:": each maximum at the score
  sheet's bands, "Erfüllung" voiding, those of all three with the last), else the level's from its
  score sheet and regulations (catalog: A1 Teil 1 3 / 1.5 / 0, Teile 2 and 3 four tasks of 1.5 /
  0.75 / 0 — the full points, half or none; A2 Aufgabenerfüllung and Sprache 2 or 4 by Teil,
  Aussprache 5 with Teil 3). Pass marks: the regulations' where the catalog has them and their
  modules are all there (A2: 60 of 100, of them 45 of the written 75 and 15 of the spoken 25, all
  needed), else A1 60 % of the points of all modules, B1 each module 60 of 100, all needed.

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
- Not imported: the interviews (several videos per topic with parallel de/en transcripts; plan, "More
  sources") — they need lessons with more than one video and transcript pages (02).

## 4. Lingust «Правильный английский» (`lingust-english` → `lingust.english`, edition `ru-en`)

Free online course (© Lingust, no open licence), 52 lessons A1–B1+ with Russian explanations. Facts:
`docs/research/lingust-english.md`.

- **Fetch**: the index, `lesson1…52` and `irregular-verbs` as HTML; recordings via `fetchMedia`. The site
  serves MP3s only with a `Referer` of its lesson pages (hotlink protection); the importer sends it for
  `/media/` requests. `/images/` is disallowed by robots and not fetched; locked (paid) players are skipped.
- **Normalise**: the index's stages are units (plus a bonus unit with the irregular-verbs table); lesson
  text before «Словарь» → grammar pages (split at `<h2>`, their sub-headings section titles); each
  section's example recordings with their lines → `speech_selfrate` (a recording reads the example
  block right before it — "a block, then its recording" — else the one after it; an example line is
  English without its transcriptions in slashes, then its Russian part: the sound in Russian letters —
  after "≈" or in brackets — and the translation, the item's hint); the first full-width recording → `media.audio`; «Словарь» → vocab (IPA in `ipa`; a past form the irregular-verbs table lists has its verb as lemma: "came" is "come");
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

## Rules for every provider

- No third-party content in the repository, including fixtures and tests.
- No brand assets of the source used as SprachAnker branding; the source is shown only as attribution.
- Crawling as above: robots.txt respected, an identifiable User-Agent, stop and report on 403/429,
  resume instead of downloading again.
- Licence and publisher recorded in the course index (`source`, 02) and shown with the course in the
  UI; Deutsch im Blick's CC BY attribution is its course description.
