# courses/ (+ packages/course-kit, apps/cli authoring)

Content providers and our enrichment. Spec: `docs/spec/03-providers.md`, `docs/spec/02-course-format.md`.
Research about sources: `docs/research/`.

## Layout (target)

```
packages/course-kit/   # library format (LibraryView), fetcher, media store + media.json fetching (media file
                       # names of URLs), manifest, fingerprints, verify, HTML sanitiser and escaping, plain
                       # text of HTML and entity decoding; provider.ts: the
                       # provider contract (import options/report/progress, course offers, wanted,
                       # libraryWriter / writeLibraryFiles, storedPage, pageCounter); files.ts: atomic
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
  lingust-english/      # Lingust «Правильный английский» (lingust.ru, ru → en): grammar pages, recordings as
                       # selfrate, gap/respond exercises from the tooltip answer keys; src/: dom.ts (HTML
                       # tree), parse/ (page, course-index, lesson, snippets, vocab, exercise, verbs),
                       # exercise.ts (source exercise → our types), normalise, import.ts
  voa-english-usa/      # VOA «Так говорят в Америке» (golosameriki.com, ru → en): 106 lessons from a catalog of
                       # archive article paths (src/catalog.ts); dialogue, words, notes, lesson MP3
  voa-lets-learn-english/ # VOA Learning English «Let's Learn English» (en → en, levels 1–2): videos, transcript,
                       # bold words, quiz answers from the result pages (GET), speaking videos as selfrate;
                       # src/normalise/: media (renditions), vocab (bold words), plan (what each section
                       # becomes), units, exercise, course (files)
  sa-starter-en/       # after MVP: our authored course + open-data importer
  bamf-lid/            # exam: Leben in Deutschland
```

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
  require re-downloading. A provider exports its `OFFERS` (with a measured size), reports progress
  (`pageCounter`, `fetchMedia`'s `progress`).
- Unknown source structures become `unknown` + report entries, never silent drops (words left out:
  `skippedWords`). Library files are written through `libraryWriter` / `storedPage` / `fetchMedia`
  (atomic), never with a plain `writeFile`.
- Helpers more than one provider needs live in `course-kit` (keys and option ids in `schema`); a
  provider never keeps its own copy.
- Enrichment references keys and fingerprints only; run `bun run cli -- enrich check` after editing it.
- Crawling: respect robots.txt, identifiable User-Agent, stop on 403/429; no fixed rate limit. Allowed:
  a `Referer` of the source's own page for its media when it refuses hotlinks (Lingust).
- A provider's index exports its importer and its series key (`SERIES`; DW: `seriesId(series)`), which
  the server's provider table uses for the library folder.
- New provider = new folder implementing the provider contract + contract tests; no engine/UI changes
  unless a new exercise type is needed (root rule 2).
