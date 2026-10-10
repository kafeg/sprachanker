# courses/ (+ packages/course-kit, apps/cli authoring)

Content providers and our enrichment. Spec: `docs/spec/03-providers.md`, `docs/spec/02-course-format.md`.
Research about sources: `docs/research/`.

## Layout

```
packages/course-kit/   # library format (LibraryView: courses, lessons, exams), fetcher (with a browsing session
                       # for sites run by forms), media store + media.json fetching (media file
                       # names of URLs), manifest, fingerprints, verify, HTML sanitiser and escaping, plain
                       # text of HTML and entity decoding; dom.ts: a tolerant HTML tree for broken pages;
                       # provider.ts: the
                       # provider contract (import options/report/progress, course offers, wanted,
                       # libraryFile (a file by kind: path from its keys, its schema), libraryWriter /
                       # writeLibraryFiles, storedPage, pageCounter, CourseProvider);
                       # exercise-draft.ts: draftExercise, Unmapped, unknownExercise; key-map.ts: keys
                       # kept by source id (`occurrences` for an id met twice); text.ts: plain text,
                       # scripts told apart; files.ts: atomic
                       # writes, temporary names, streamed hashes;
                       # verify.ts: a course's integrity and counts (LibraryView.check); vocab.ts:
                       # Headword, shapeHeadword (the one part-of-speech rule), a lesson's vocabulary
                       # entries (keys, duplicates, translations), skippedWords
courses/
  _shared/rules/       # grammar rules registry (<lang>.yaml) — the only place rules are defined (spec 02)
  _fixture/            # invented course covering every exercise type, two editions (tests, e2e)
  dw/                  # DW Learn German (series dw.nicos-weg, dw.deutschtrainer; CLI ids dw-<series>), a course
                       # per DW course and language (a1-ru, a1-en, …; raw pages by DW course):
                       # src/: catalog, pages, media, stream (HLS fallback), normalise/, import.ts; test/
  coerll-dib/          # COERLL Deutsch im Blick (coerll.dib): vocabulary sections → lessons without pages;
                       # src/: catalog, parse (HTML), normalise (pure), import.ts; test/
  lingust-english/      # Lingust «Правильный английский» (lingust.ru, ru → en): grammar pages, recordings
                       # as `speech_selfrate`, gap/respond exercises from the tooltip answer keys;
                       # src/: parse/ (page, course-index, lesson, snippets, vocab,
                       # exercise, verbs), exercise.ts (source exercise → our types), normalise, import.ts
  voa-english-usa/      # VOA «Так говорят в Америке» (golosameriki.com, ru → en): 106 lessons from a catalog of
                       # archive article paths (src/catalog.ts); dialogue, words, notes, lesson MP3
  bamf-lid/            # BAMF «Leben in Deutschland» (bamf.lid, de-de): an exam course; src/: catalog, pdf (pdf.js:
                       # lines and pictures), catalogue (questions from the PDF), centre (BAMF's test centre:
                       # pages read, walked as its APEX forms post), png (pictures saved), normalise, import.ts
  goethe/              # Goethe-Zertifikat model tests A1, A2, B1 (goethe.zertifikat): exams of modules; src/:
                       # catalog (levels), page (a module page as blocks), teile (Teile and questions),
                       # solutions (a Teil's solution page), normalise, import.ts; test/pages.ts synthetic
  voa-lets-learn-english/ # VOA Learning English «Let's Learn English» (en → en, levels 1–2): videos, transcript,
                       # bold words, quiz answers from the result pages (GET), speaking videos as
                       # `speech_selfrate`; src/normalise/: media (renditions), vocab (bold words), plan
                       # (what each section becomes), units, exercise, course (files)
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
  (`pageCounter`, `fetchMedia`'s `progress`).
- Unknown source structures become `unknown` + report entries, never silent drops (words left out:
  `skippedWords`). Library files are made with `libraryFile` (never a path or schema of one's own)
  and written through `libraryWriter` / `storedPage` / `fetchMedia` (atomic), never with a plain
  `writeFile` — the fixture course too.
- Helpers more than one provider needs live in `course-kit` (keys and option ids in `schema`); a
  provider never keeps its own copy: exercises are built with `draftExercise` (checked against their
  type's schema where they are made; `Unmapped` for what cannot be mapped, `unknownExercise` in its
  place), keys that stay by source id with `openKeyMap`, two scripts told apart with `CYRILLIC`,
  `latinLetters`, `splitAtCyrillic`.
- Enrichment references keys and fingerprints only (its check, `enrich check`, is planned).
- Crawling: respect robots.txt, identifiable User-Agent, stop on 403/429; no fixed rate limit. Allowed:
  a `Referer` of the source's own page for its media when it refuses hotlinks (Lingust).
- A provider's index exports its `CourseProvider` (course-kit: id, series folder, offers, import; DW
  one per series); the server lists them (`packages/server/src/providers.ts`) and tests every one
  against the contract.
- New provider = new folder exporting a `CourseProvider`, listed in the server's providers (the
  contract test covers it) + its own normaliser tests; no engine/UI changes
  unless a new exercise type is needed (root rule 2).
