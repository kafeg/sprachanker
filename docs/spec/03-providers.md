# 03 — Providers (importers)

A provider turns an external source into library content (02). Each provider is a folder in `courses/`:

```
courses/<provider-id>/
├── provider/        # catalog entries, fetcher, normaliser, keymap.json
├── enrichment/      # our layer (YAML/Markdown), keyed by stable keys
├── fixtures/        # SYNTHETIC test inputs only — never real third-party content
└── tests/
```

## Provider contract

```ts
interface Provider {
  id: string;                                         // "dw-nicos-weg"
  catalog(): CatalogEntry[];                          // static declaration, no network
  fetch(sel: Selection, io: FetchIO, progress: Progress): Promise<FetchReport>;  // writes raw/ + media/
  normalise(raw: RawView): { files: Map<string, unknown>; report: NormaliseReport };  // offline
}
```

`course-kit` owns the library format (read and write, `LibraryView`) and supplies `FetchIO` (HTTP
client: robots.txt, retries with backoff, resumable downloads, identifiable User-Agent, stop on
403/429; no fixed rate limit, providers choose their concurrency), the media store, writing files and the manifest, the HTML sanitiser, fingerprints and
`contentVersion`, and the generic `verify`. The exact interface is fixed in stage 2.

## Importer behaviour (all providers)

- **On demand only**, from the UI or CLI (`sprachanker import <provider> --courses a1 --editions ru-de`).
- **Idempotent and resumable.** With raw data present, a re-run makes no requests unless `--refresh`.
- **Separate phases.** `fetch` writes raw + media; `normalise` builds canonical + locale offline.
- **Reports** unknown exercise types, unmapped fields, edition mismatches, changes since the last fetch.
- **No partial installs visible.** A course becomes visible after normalise + verify succeed.
- One import per series at a time (lock file in the series folder).

## 1. DW Learn German (`courses/dw`)

One provider for the DW platform: every DW course has the same page model (course → lessons →
exercise pages, `window.__APOLLO_STATE__`), so one fetcher and normaliser serve all of them. Each DW
course is its own series: `dw-nicos-weg` → `dw.nicos-weg`, `dw-deutschtrainer` → `dw.deutschtrainer`
(100 short A1–A2 lessons on words and phrases by topic, course `a1-a2`, edition `ru-de`; also in
uk, pl, tr, ar, not en).

### Nicos Weg (`dw-nicos-weg` → `dw.nicos-weg`)

Source facts: `docs/research/dw-nicos-weg.md`. Closed licence: personal use.

- Courses `a1`, `a2` (editions `ru-de`, `en-de`), `b1` (`de-de`). **MVP: `a1` `ru-de` only.**
- **Fetch**: the course page (lesson order, unit groups), each lesson page (overview, vocabulary,
  grammar, culture, script, videos) and one page per exercise; URLs are built from ids. The embedded
  state JSON (`window.__APOLLO_STATE__`) is stored in `raw/`, not full HTML. A1 = 1 + 77 + 1071
  pages. Media: episode video and subtitle track, exercise images and audio, vocabulary audio. Which
  video variants and PDFs are fetched is decided in stage 2. Hosts refusing cloud IPs are reported.
- **Normalise**: the mechanics table in `docs/research/dw-nicos-weg.md` maps every DW mechanic to a
  type (02); an unseen combination → `unknown` + report. Units are the course's lesson groups in
  order (`u00`…); the final test is a lesson in its own unit after the last one (A1: `19-01`).
  Learner-language fields are fixed per mechanic and field (research, "Which strings are learner
  language"); the "Play audio" label is dropped; image options keep only the image. Vocabulary
  headwords give part of speech, gender, plural and forms as in 02; valency in parentheses ("(etwas)
  studieren") stays in the headword and not in the lemma.
- **Edition alignment** (after MVP): editions have different source ids; lessons and exercises align by
  order; options are matched by text because their order and punctuation can differ between editions;
  mismatches are reported, never merged silently.
- **B1** (after MVP) has a German glossary (`GLOSSARY`, definitions instead of translations) that
  needs its own vocabulary parser.

## 2. Leben in Deutschland (`bamf-lid` → `bamf.lid`, edition `de-de`)

Official BAMF question catalogue (PDF): 300 general questions + 10 per federal state. A test has 33
questions (30 general + 3 for the learner's state), 60 minutes; 15 correct passes the course test, 17 are
needed for naturalisation — both shown. Modes: browse, my state, timed exam, practise wrongly answered
questions. Question translations into the learner's language by LLM, marked as machine translation.

## 3. COERLL — Deutsch im Blick (`coerll-dib` → `coerll.dib`, edition `en-de`)

2nd edition (2017), **CC BY 4.0** only (the 2013 edition is CC BY-NC-ND and MUST NOT be used); the
attribution is the course description. Facts: `docs/research/coerll-dib.md`. Tests that the schema is
not DW-shaped.

- **Fetch**: `toc.php?k=1..10` and `voc.php?k=1..10` stored as HTML under `raw/en-de/dib/`; media: the
  recording of each vocabulary section and the chapter's textbook PDF.
- **Normalise**: a chapter is a unit (title from the chapter page), a vocabulary section a lesson
  (`<chapter>-<section>`) with its words, its recording as `media.audio` and no pages — the site has no
  interactive exercises; they are in the textbook PDF, a download of the chapter's first lesson.
  Headwords as the book writes them ("der Apfel (Äpfel)", "(no plural)", "(plural only)") give
  gender and plural; verbs and phrases by shape.
- **Not imported yet**: the interviews (several videos per topic with parallel de/en transcripts) —
  they need lessons with more than one video and transcript pages (02); web quests; pronunciation.

## Later

- **SprachAnker Starter English** (`sa-starter-en` → `sprachanker.starter-en`): small ru → en course
  authored by us, with open data fetched at runtime (Tatoeba, Wiktionary via kaikki.org) and per-item
  attribution.
- Goethe-Zertifikat A1 practice sets, more DW courses, readers.

## Rules for every provider

- No third-party content in the repository, including fixtures and tests.
- No brand assets of the source used as SprachAnker branding; the source is shown only as attribution.
- Crawling as above; stop and report on 403/429.
- Licence and attribution recorded in the manifest and displayed in the UI.
