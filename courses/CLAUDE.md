# courses/ (+ packages/course-kit, apps/cli authoring)

Content providers and our enrichment. Spec: `docs/spec/03-providers.md`, `docs/spec/02-course-format.md`.
Research about sources: `docs/research/`.

## Layout (target)

```
packages/course-kit/   # library format (LibraryView), fetcher, media store + media.json fetching, manifest,
                       # fingerprints, verify, HTML sanitiser
courses/
  _shared/rules/       # grammar rules registry (<lang>.yaml) — the only place rules are defined (spec 02)
  _fixture/            # invented course covering every exercise type, two editions (tests, e2e)
  dw/                  # DW Learn German (series dw.nicos-weg, dw.deutschtrainer; CLI ids dw-<series>):
                       # src/: catalog, pages, media, stream (HLS fallback), normalise/, import.ts; test/
  coerll-dib/          # after MVP
  sa-starter-en/       # after MVP: our authored course + open-data importer
  bamf-lid/            # exam: Leben in Deutschland
```

## Rules

- Providers depend only on `schema` and `course-kit` and MUST satisfy the normalisation contract (spec 02).
- **Never commit third-party content**: no texts, media, raw page JSON, PDFs — also not in fixtures.
  Fixtures are hand-written and only shaped like the source.
- `fetch` writes raw + media; `normalise` is offline and deterministic. Fixing a normaliser must not
  require re-downloading.
- Unknown source structures become `unknown` + report entries, never silent drops.
- Enrichment references keys and fingerprints only; run `bun run cli -- enrich check` after editing it.
- Crawling: respect robots.txt, identifiable User-Agent, stop on 403/429; no fixed rate limit.
- New provider = new folder implementing the provider contract + contract tests; no engine/UI changes
  unless a new exercise type is needed (root rule 2).
