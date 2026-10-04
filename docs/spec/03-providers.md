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
  fetch(sel: Selection, io: FetchIO, progress: Progress): Promise<FetchReport>;  // writes raw/ + blobs/
  normalise(raw: RawView): { files: Map<string, unknown>; report: NormaliseReport };  // offline
}
```

`course-kit` owns the library format (read and write, `LibraryView`) and supplies `FetchIO` (polite HTTP
client: robots.txt, ≤1 req/s per host, retries with backoff, resumable downloads, identifiable
User-Agent), the blob store, writing files and the manifest, the HTML sanitiser, fingerprints and
`contentVersion`, and the generic `verify`. The exact interface is fixed in stage 2.

## Importer behaviour (all providers)

- **On demand only**, from the UI or CLI (`sprachanker import <provider> --courses a1 --editions ru-de`).
- **Idempotent and resumable.** With raw data present, a re-run makes no requests unless `--refresh`.
- **Separate phases.** `fetch` writes raw + blobs; `normalise` builds canonical + locale offline.
- **Reports** unknown exercise types, unmapped fields, edition mismatches, changes since the last fetch.
- **No partial installs visible.** A course becomes visible after normalise + verify succeed.
- One import per series at a time (lock file in the series folder).

## 1. DW — Nicos Weg (`dw-nicos-weg` → `dw.nicos-weg`)

Source facts: `docs/research/dw-nicos-weg.md`. Closed licence: personal use.

- Courses `a1`, `a2` (editions `ru-de`, `en-de`), `b1` (`de-de`). **MVP: `a1` `ru-de` only.**
- **Fetch**: course page → lesson list and unit headings; each lesson page and its exercise, grammar,
  culture, vocabulary, script pages → extracted embedded state JSON (`window.__APOLLO_STATE__`) stored in
  `raw/`, not full HTML; media (episode video, exercise images and audio, vocabulary audio). Which
  video variants and PDFs are fetched is decided in stage 2. Hosts refusing cloud IPs are reported.
- **Normalise** (*provisional until stage 1*): DW exercises (inquiries → alternatives with `isCorrect`,
  `inputType`, `clozeType`, media) map to our types; unknown combinations → `unknown` + report. The
  first exercise page is the episode. Self-rated speaking → `speech_selfrate`. The final test → a lesson
  (confirmed in stage 1). Vocabulary "die Frau, die Frauen" → gender/plural + lexeme key.
- **Stage 1 reconnaissance**: sample A1 `ru-de` thoroughly plus one lesson each of A1 `en-de`, A2, B1
  and one Deutsch im Blick chapter (schema check only); catalogue all exercise and page kinds; decide
  how learner-language and target-language strings are told apart and how lexeme POS is derived;
  record findings in `docs/research/dw-nicos-weg.md`.
- **Edition alignment** (after MVP): editions have different source ids; lessons and exercises align by
  order, confirmed by fingerprints; mismatches are reported, never merged silently.

## 2. Leben in Deutschland (`bamf-lid` → `bamf.lid`, edition `de-de`)

Official BAMF question catalogue (PDF): 300 general questions + 10 per federal state. A test has 33
questions (30 general + 3 for the learner's state), 60 minutes; 15 correct passes the course test, 17 are
needed for naturalisation — both shown. Modes: browse, my state, timed exam, practise wrongly answered
questions. Question translations into the learner's language by LLM, marked as machine translation.

## Later

- **COERLL — Deutsch im Blick** (`coerll-dib`): 2nd edition (2017), **CC BY 4.0** only (the 2013
  edition is CC BY-NC-ND and MUST NOT be used). Edition `en-de`. Tests that the schema is not DW-shaped.
- **SprachAnker Starter English** (`sa-starter-en` → `sprachanker.starter-en`): small ru → en course
  authored by us, with open data fetched at runtime (Tatoeba, Wiktionary via kaikki.org) and per-item
  attribution.
- Goethe-Zertifikat A1 practice sets, more DW courses, readers.

## Rules for every provider

- No third-party content in the repository, including fixtures and tests.
- No brand assets of the source used as SprachAnker branding; the source is shown only as attribution.
- Polite crawling as above; stop and report on 403/429.
- Licence and attribution recorded in the manifest and displayed in the UI.
