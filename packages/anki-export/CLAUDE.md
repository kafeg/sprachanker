# packages/anki-export

Anki's deck packages (`.apkg`). Spec: `docs/spec/04-engine.md` ("Decks"). Depends on `packages/schema`
and `fflate` only; runtime-free — SQLite and zstd come from the caller (`ApkgRuntime`: the server's
`src/runtime/decks.ts`).

## Layout

```
src/
  apkg.ts      # readApkg: the zip, the collection (anki21b zstd, else anki21, else anki2; a WAL header
               # read as a rollback journal), note types and decks (tables or `col` JSON), notes in
               # order, media by name (JSON list or the newest format's protobuf; zstd files) on demand
               # — whether it holds one known without unpacking it —,
               # a batch at a time; at most UNPACKED_MAX bytes unpacked at once — a batch's files, zstd
               # ones as they unpack, counted together (ApkgTooLarge)
  fields.ts    # a field's role by its name: word, translation, plural, part of speech, or a language's
               # text, example sentence or audio (`german`, `sentence_1_german`, `audio_german`);
               # fieldLanguages; fieldText (HTML → text, `[sound:…]` out), soundOf
  words.ts     # noteWords: a note's word, translation in the language chosen, audio and the deck's
               # examples, else the first two fields; posOf (decks' parts of speech and noun codes:
               # nf, die (pl)…); lexemeOf: lemma, part of speech, gender by schema's rules
  index.ts
test/
  apkg.ts      # buildApkg: synthetic packages in both formats (bun:sqlite, fflate) and the Bun runtime;
               # exported as `@sprachanker/anki-export/testing` for the server's tests and e2e
```

## Planned

- `.apkg` export (plan, "Anki decks and word images").

## Rules

- Never a third-party deck in the repository, not even in tests: packages are built in the test.
- A word's lexeme is made by schema's `shapeHeadword` / `germanGender`, as the courses make theirs, so
  a deck's word and a course's link to one card.
