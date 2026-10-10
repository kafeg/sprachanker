# courses/ (+ packages/course-kit, apps/cli authoring)

Content providers and our enrichment. Spec: `docs/spec/03-providers.md`, `docs/spec/02-course-format.md`.
Research about sources: `docs/research/`.

## Layout

```
packages/course-kit/src/
  provider.ts          # the provider contract: import options, report, progress, course offers, wanted,
                       # CourseProvider; libraryFile (a file by kind: its path from its keys, its schema;
                       # an exam's sources too), libraryWriter / writeLibraryFiles
  importing.ts         # rawPages (raw pages kept once, counted, their newest time), importReport / emptyReport
  http.ts              # the polite fetcher (robots.txt, retries, IMPORTER_USER_AGENT; a browsing session
                       # for sites run by forms)
  robots.ts            # robots.txt rules
  pool.ts              # runPool: work with a bounded number in flight
  media-index.ts       # fetchMedia (a series' media.json and media store), mediaRef, urlFileName, mediaPath,
                       # failed and gone media
  media-store.ts       # media files under readable names, one file per content
  files.ts             # atomic writes, temporary names, streamed hashes
  library.ts           # the library read from its folder, validated
  library-view.ts      # LibraryView: what the app reads (courses, lessons, exams), NotInstalledError;
                       # no Node APIs: the server's app imports it alone (`@sprachanker/course-kit/view`)
  verify.ts            # a course's integrity and counts (LibraryView.check)
  canonical-json.ts    # canonical JSON (hashes) and library files' JSON
  fingerprint.ts       # exercise fingerprints
  exercise-draft.ts    # draftExercise, Unmapped, unknownExercise, draftOrUnknown (a mapping run)
  key-map.ts           # keys kept by source id (`occurrences` for an id met twice)
  vocab.ts             # Headword, shapeHeadword (the one part-of-speech rule), germanGender, a lesson's
                       # vocabulary entries (keys, duplicates, translations), skippedWords
  text.ts              # plain text of HTML, entities decoded, characters of no width; scripts told apart
  html.ts              # the HTML sanitiser, bold lines as section titles, escaping
  dom.ts               # a tolerant HTML tree for broken pages (findAll, innerHtml)
  language.ts          # which of a course's two languages a text is in
courses/
  _shared/rules/       # grammar rules registry (<lang>.yaml) — the only place rules are defined (spec 02);
                       # checked by the fixture's test, read by the app: planned
  _fixture/            # invented course covering every exercise type, two editions (tests, e2e); src/:
                       # course, locales, media (synthetic), library (written as an import would)
  dw/                  # DW Learn German (series dw.nicos-weg, dw.deutschtrainer; CLI ids dw-<series>), a course
                       # per DW course and language (a1-ru, a1-en, …; raw pages by DW course): src/: catalog,
                       # apollo (a page's state), pages, media (DW's media URLs and names), stream (HLS
                       # fallback), normalise/ (run, course, lesson, exercise, context, text, vocab), import
  coerll-dib/          # COERLL Deutsch im Blick (coerll.dib): vocabulary sections → lessons without pages;
                       # src/: catalog, parse (HTML), normalise (pure), import
  lingust-english/     # Lingust «Правильный английский» (lingust.ru, ru → en): grammar pages, recordings
                       # as `speech_selfrate`, gap/respond exercises from the tooltip answer keys; src/:
                       # catalog, parse/ (page, course-index, lesson, snippets, vocab, exercise, verbs),
                       # exercise (source exercise → our types), text (its lines' scripts), render (pages),
                       # normalise, import
  voa-english-usa/     # VOA «Так говорят в Америке» (golosameriki.com, ru → en): 106 lessons from a catalog of
                       # archive article paths; dialogue, words, notes, lesson MP3; src/: catalog, parse,
                       # normalise, import
  bamf-lid/            # BAMF «Leben in Deutschland» (bamf.lid, de-de): an exam course; src/: catalog, pdf
                       # (pdf.js: lines and pictures), questions (the catalogue PDF's questions), centre
                       # (BAMF's test centre: pages read, walked as its APEX forms post), png (pictures
                       # saved), normalise, import
  goethe/              # Goethe-Zertifikat model tests A1, A2, B1 (goethe.zertifikat): exams of modules; src/:
                       # catalog (levels, score sheets' bands), page (a module page as blocks; a Schreiben or
                       # Sprechen page as its parts), teile (Teile and questions), solutions (a Teil's
                       # solution page), options (an answer matched to its option), writing (the Schreiben
                       # page: tasks, forms, criteria), writing-exam (its Teile as sections), speaking (the
                       # Sprechen page: parts, cards, candidate A's and B's), speaking-exam (its parts as
                       # sections), criteria (an open answer's rubric), normalise, import; test/pages.ts
                       # synthetic
  voa-lets-learn-english/ # VOA Learning English «Let's Learn English» (en → en, levels 1–2): videos, transcript,
                       # bold words, quiz answers from the result pages (GET), speaking videos as
                       # `speech_selfrate`; src/: catalog, parse, import, normalise/: media (renditions),
                       # vocab (bold words), plan (what each section becomes), units, exercise, course
```

## Planned

- `sa-starter-en/`: our authored course and an open-data importer (plan, "More sources").

## Rules

- Providers depend only on their own folder, `schema` and `course-kit` (never another provider) and
  MUST satisfy the normalisation contract (spec 02).
- `course-kit` never imports a provider, its tests included: they write their own synthetic library
  (`packages/course-kit/test/mini-library.ts`).
- Import and normalisation are deterministic code over the source: no LLM, no generated content. A
  language pair of a source course is a course of its own (spec 01).
- **Never commit third-party content**: no texts, media, raw page JSON, PDFs — also not in fixtures.
  Fixtures are hand-written and only shaped like the source.
- `fetch` writes raw + media; `normalise` is offline and deterministic. Fixing a normaliser must not
  require re-downloading. A provider's offers carry a measured size; it reports progress
  (`rawPages`, `fetchMedia`'s `progress`).
- Unknown source structures become `unknown` + report entries, never silent drops (words left out:
  `skippedWords`). Library files are made with `libraryFile` (never a path or schema of one's own)
  and written through `libraryWriter` / `rawPages` / `fetchMedia` (atomic), never with a plain
  `writeFile` — the fixture course too.
- Helpers more than one provider needs live in `course-kit` (keys and option ids in `schema`); a
  provider never keeps its own copy: exercises are built with `draftExercise` (checked against their
  type's schema where they are made; `Unmapped` for what cannot be mapped, `unknownExercise` in its
  place — `draftOrUnknown` around a mapping does both), keys that stay by source id with `openKeyMap`, two scripts told apart with `CYRILLIC`,
  `latinLetters`, `splitAtCyrillic`.
- Enrichment references keys and fingerprints only (its check, `enrich check`, is planned).
- Crawling: respect robots.txt, identifiable User-Agent, stop on 403/429; no fixed rate limit. Allowed:
  a `Referer` of the source's own page for its media when it refuses hotlinks (Lingust).
- A provider's index exports its `CourseProvider` (course-kit: id, series folder, `stable` when ready
  for learning — without it the provider is experimental —, offers, import; DW one per series); the server lists them (`packages/server/src/providers.ts`) and tests every one
  against the contract.
- New provider = new folder exporting a `CourseProvider` (experimental until it declares `stable`), listed in the server's providers (the
  contract test covers it) + its own normaliser tests; no engine/UI changes
  unless a new exercise type is needed (root rule 2).
