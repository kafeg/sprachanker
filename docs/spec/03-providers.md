# 03 — Providers (importers)

A provider turns an external source into library content (02). Each provider is a folder in `courses/`:

```
courses/<provider-id>/
├── provider/        # catalog entries, crawler, normaliser (TypeScript)
├── enrichment/      # our layer (YAML/Markdown), keyed by stable keys
├── fixtures/        # SYNTHETIC test inputs only — never real third-party content
└── tests/
```

## Provider contract

```ts
interface Provider {
  id: string;                                       // "dw-nicos-weg"
  catalog(): CatalogEntry[];                        // static declaration, no network
  plan(sel: Selection, lib: LibraryView): Plan;     // what to fetch for courses × editions
  fetch(plan: Plan, io: FetchIO, progress: Progress): Promise<FetchReport>;   // writes raw/ + blobs/
  normalise(raw: RawView): { canonical: Lesson[]; locale: Locale[]; report: NormaliseReport };
  verify(lib: LibraryView): VerifyReport;
}
```

`course-kit` supplies `FetchIO`: polite HTTP client (robots.txt, ≤1 req/s per host, retries with
backoff, `If-Modified-Since`/ETag, resumable downloads, identifiable User-Agent), blob store, manifest
writer, HTML sanitiser, progress events.

Every provider's output MUST satisfy the **normalisation contract** in 02 (required fields, keys, text
placement, determinism). That contract is what lets any course be studied, tracked and enriched the
same way.

## Importer behaviour (all providers)

- **On demand only.** Triggered from the UI ("Install / Update / Add edition") or CLI
  (`sprachanker import <provider> --courses a1,a2 --editions ru-de,en-de`). Never at build time.
- **Idempotent and resumable.** Re-running fetches only missing or changed resources; verifies hashes.
- **Edition-aware.** Media are fetched once; adding an edition fetches only its texts.
- **Separate phases.** `fetch` writes raw + blobs; `normalise` builds canonical + locale offline. A
  normaliser fix never needs the network.
- **Reports.** Unknown exercise types, unmapped fields, edition mismatches (different structure or
  fingerprints), changes since the previous fetch. Shown in UI and CLI output.
- **No partial installs visible.** A course becomes visible after normalise + verify succeed.

Provider folder ids use dashes (`dw-nicos-weg`); the series they produce use the global series id from 02
(`dw.nicos-weg`).

## 1. DW — Nicos Weg (`dw-nicos-weg` → series `dw.nicos-weg`)

Source facts: `docs/research/dw-nicos-weg.md`. Closed licence: personal use only.

**Catalog**

| Course | Editions | Notes |
|---|---|---|
| `a1` | `ru-de` (MVP), `en-de` (after MVP) | 77 entries: 76 episodes + final test |
| `a2` | `ru-de`, `en-de` (after MVP) | 77 entries |
| `b1` | `de-de` (after MVP) | German-only interface |

Other interface languages exist on DW; the provider SHOULD declare them generically (edition list from
the course page) but only `ru`, `en`, `de` are tested.

**Fetch**

1. Course page per edition → ordered list of lesson URLs and unit headings.
2. Lesson page → embedded state JSON (`window.__APOLLO_STATE__`): lesson meta, synopsis, goals,
   manuscript, vocabulary, videos, list of exercise pages.
3. Each exercise page, grammar page(s), culture page(s), vocabulary page, script page, tools page.
4. Media: episode video (SD and subtitled SD by default, together ≈ 4–5 GB for A1–B1; HD optional;
   each variant can be switched off in the install dialog), exercise images and audio, vocabulary
   audio, PDFs from the tools page (script + vocabulary, teacher guide) and level-wide PDFs (grammar
   overview, workbook).
5. Store each page's extracted JSON in `raw/<edition>/…` — not the full HTML.
6. Some hosts (e.g. `static.dw.com`) refuse cloud IP ranges; imports run on the user's machine and
   report such refusals clearly.

**Normalise** — *provisional until stage 1 reconnaissance; mapping details are expected to change.*

- Map DW exercise data (exercise → inquiries → alternatives with `isCorrect`, `inputType`, `clozeType`,
  media) to our exercise types (04). Unknown combinations become `type: "unknown"` with a raw reference
  and appear in the report; the UI renders them as "not supported yet".
- The first exercise page of a lesson is the episode itself (video + comprehension questions).
- Self-rated speaking exercises ("How did you do? Good / Not so great") are typed `speech_selfrate` with
  their reference text and audio kept; the engine upgrades them to checked speaking (04).
- The final test (77th entry) is normalised as an exam (`kind: exam`) belonging to the course.
- **Keys** come from the key map (02); a first full import creates it, later imports only extend it.
- **Edition alignment:** editions have different source ids. Lessons align by course order; exercises by
  order within the lesson; both confirmed by fingerprint of the German content. Mismatches are reported,
  never silently merged.
- Vocabulary: `Knowledge` entries of type vocabulary → vocab entries; parse "die Frau, die Frauen" into
  gender/plural; derive lexeme keys; translation into the edition's locale.
- Units from course-page headings (ordered); lesson goals ("Here you will learn") → goal keys
  `<lesson>/goal-<n>` with texts in locale; synopsis/teaser → locale.

**Stage 1 reconnaissance (before the normaliser is written)**: sample lessons A1 1, ~15, ~40, A2 ~10,
B1 ~5 in all editions; produce a catalogue of all `inputType`/`clozeType`/media combinations and any
other page kinds; confirm edition alignment; record findings in `docs/research/dw-nicos-weg.md`.

## 2. COERLL — Deutsch im Blick (`coerll-dib` → series `coerll.dib`) — after MVP

- Licence: **2nd edition (2017), CC BY 4.0** — the 2013 edition was CC BY-NC-ND and MUST NOT be used.
  Attribution: University of Texas at Austin, COERLL; author Zsuzsanna Abrams.
- Edition: `en-de` (first-year university German, 10 chapters; videos of native speakers, vocabulary
  with audio, phonetics, grammar via the companion "Grimm Grammar", CC BY).
- Structure differs from Nicos Weg (chapters, textbook PDF, website). Stage 1 includes reconnaissance
  of the website and PDF (schema check only — implementation after MVP) to decide what to import (likely: chapter vocabulary + audio, videos with
  transcripts, selected exercises). This provider is the test that the schema is not DW-shaped.
- Because the licence allows it, a pre-built content pack MAY later be published as a release asset;
  v1 still uses the importer path.

## 3. SprachAnker Starter English (`sa-starter-en` → series `sprachanker.starter-en`) — after MVP

- Small A1 course, **ru → en**, 5–6 lessons, authored by us — the test of a second target language and of
  an own-authored course. No suitable openly-licensed Russian→English beginner course was found.
- Repository contains our lesson definitions (enrichment-style YAML, our licence). The importer
  downloads open data referenced by it: example sentence pairs and audio from Tatoeba (CC BY 2.0 FR,
  per-sentence attribution), lexical data from Wiktionary (CC BY-SA) via kaikki.org, and a frequency list.
- Its normaliser builds canonical + locale from our YAML plus the downloaded open data, so the course is
  installed and versioned like any other (library folder, manifest, verify).
- Lessons authored with LLM assistance (`enrich draft`) and reviewed by a human.

## 4. Exams

Kind `exam`: sections, items, timing, scoring rules, pass mark. Runs in mode `exam`, with review.

- **Nicos Weg final tests** — part of `dw-nicos-weg` (A1, A2, B1).
- **Leben in Deutschland** (`bamf-lid` → `bamf.lid`, edition `de-de`): official BAMF question catalogue
  (PDF): 300 general questions + 10 for each federal state, i.e. 310 relevant to one learner (profile
  setting: state, e.g. Berlin). A test has 33 questions (30 general + 3 state), 17 correct to pass,
  60 minutes. Importer parses the PDF (some questions have images). Modes: browse all, my state,
  timed exam, practise wrongly answered questions (practice runs, 04); translations of questions into the learner's language by LLM,
  clearly marked as machine translation.

## Later

**Goethe-Zertifikat A1 practice sets** (`goethe-a1` → `goethe.a1`, edition `de-de`): Goethe-Institut
  publishes free practice material (PDF + audio). Closed licence, personal use. Reading and listening are auto-scored; writing and speaking
  are scored by an LLM against the published criteria (07) with the rubric shown to the learner.

DW ABC, Deutschtrainer, "Harry – gefangen in der Zeit" (A1/A2), Jojo sucht das Glück; Grimm Grammar as
grammar reference; readers (Project Gutenberg, Wikisource, Klexikon, Standard Ebooks); community decks.

## Rules for every provider

- No third-party content in the repository, including fixtures and tests.
- No brand assets of the source used as SprachAnker branding; source name shown only as attribution.
- Polite crawling as above; stop and report on 403/429 instead of retrying aggressively.
- Licence and attribution recorded in the manifest and displayed in the UI.
