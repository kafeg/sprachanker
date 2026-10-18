# packages/anki-export

Anki's deck packages (`.apkg`): read, and written. Depends on `packages/schema` and `fflate` only; runtime-free — SQLite and zstd come from the caller (`ApkgRuntime`: the server's
`src/runtime/apkg.ts`; the phone app: `apps/mobile/src/sql.ts`).

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
  write.ts     # writeApkg: Anki's legacy package — collection.anki2 (schema 11: note type, deck, options
               # as JSON in `col`), the media map —, the caller zipping it with the media files by number;
               # one note type (Front, Back, Audio, Example; NOTE_TYPE_ID the same in every export), two new
               # cards a note (none for an empty side), the audio on the word's side; noteGuid, ankiId
               # (stable ids from a seed), sha1 (Anki's checksum)
  index.ts
scripts/
  anki-check.ts   # a package written here imported by Anki's own library (anki_import.py, Python —
                  # `pip install anki==26.5`, `ANKI_PYTHON`): notes, cards, media, an update; with a
                  # path, that package's counts. Not in CI
test/
  apkg.ts      # buildApkg: synthetic packages in both formats (bun:sqlite, fflate) and the Bun runtime;
               # exported as `@sprachanker/anki-export/testing` for the server's tests and e2e
```

## Rules

- Never a third-party deck in the repository, not even in tests: packages are built in the test.
- A word's lexeme is made by schema's `shapeHeadword` / `germanGender`, as the courses make theirs, so
  a deck's word and a course's link to one card.
- A package written is the legacy format (collection.anki2, no `meta`): every Anki and AnkiDroid imports
  it. A change to the note type keeps NOTE_TYPE_ID and its field names, so a package imported again
  updates the notes there (Anki matches them by guid, updating those older than the package).
- After a change to write.ts: `bun packages/anki-export/scripts/anki-check.ts` with Anki's library.
