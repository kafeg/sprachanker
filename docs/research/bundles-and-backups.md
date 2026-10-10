# Research — course bundles, library storage, backups

Facts and options gathered on 10 October 2026 for the open items "export/import of a profile",
"Anki decks … .apkg" and the owner's question whether courses should be kept or shared as bundles.
Nothing is built yet.

## How comparable systems store and package content

| System | On disk | To move it | Notes |
|---|---|---|---|
| Anki | SQLite collection + an unpacked `collection.media/` folder | `.apkg`/`.colpkg`: a zip of the collection, a media map and numbered media files | unpacked on import |
| Kolibri | a SQLite file per channel + files named by md5 | the same tree, copied to a drive; files already present are skipped | content-addressed |
| Kiwix ZIM | one file | the same file | compressed clusters: reading one entry decompresses its cluster |
| EPUB, H5P, SCORM | — | a zip with a manifest | |
| SQLite Archive | one SQLite file | the same | a row per file; faster than the file system only for small blobs |
| OCI images, restic | content-addressed blobs and an index | the same | dedup and hashes |

The two learning apps closest to ours store content unpacked and package it only to move it. Our
media (MP4, MP3, JPG) is already compressed, so archives gain nothing by compressing it.

## The library as measured (~/SprachAnker, read only)

- **Size.** 29 GB in 76,384 files, 49,823 of them JSON. Models take 4.3 GB; profiles about 1 MB.
  The disk had 18 GB free.
- **Nicos Weg.**
  - `raw/` 3.5 GB in 42,489 files; canonical and locale 187 MB; media 12 GB in 20,381 files.
  - Its 37 courses in 19 editions reference 10.45 GB of distinct media. A copy per course would
    be 127 GB.
  - One edition (A1 + A2) references about 6.7 GB, of which only 5–40 MB is its own.
- **Unreferenced media.** 1.56 GB of media is referenced by no course (files no URL points to any
  more are kept on purpose).
- **Across series**, only 23 MB of media is shared, so per-series dedup is enough.
- **Already close to content-addressed.**
  - `media.json` maps each URL to path, sha256, size and MIME.
  - The media store keeps one file per sha256.
  - The planned series manifest (`packages/schema/src/manifest.ts`) has
    `files: path → {sha256, size, mime, sourceUrl}` and a `contentVersion` per edition.

## Options

- **Storage: keep it unpacked (status quo).**
  - Media is served with Range requests straight from files.
  - Imports resume per file, and normalising rewrites single JSON files.
  - Removing an edition is a delete; APFS clones and Time Machine work per file.
  - Serving from archives would mean rewriting archives of many gigabytes on every import,
    normalisation or edition added. Time Machine would copy a whole archive on each change, and
    unpacking would need the space twice.
- **A course bundle, to move a downloaded course.** A zip with the series layout for the chosen
  editions:
  - `canonical/`, `locale/`;
  - the matching parts of `keys.json` and `media.json`;
  - only the media they reference, stored uncompressed;
  - `manifest.json` first (the Manifest schema with hashes);
  - `raw/` optionally.

  On import, every hash is checked; media already present with the same hash is skipped, so adding
  `a1-en` beside `a1-ru` adds about 110 MB rather than 6.7 GB. A path that exists with another hash
  stops the import, then come `media.json` / `keys.json` merged and `verify`.
  - ZIP64 is needed (an edition is over 4 GB). Whether fflate writes ZIP64 is to be confirmed;
    otherwise a small stored-only ZIP64 reader/writer.
  - Moving one's own copy between one's own machines is private use. Sharing with others depends
    on each source's terms (Deutsch im Blick is CC BY; DW is free access, not an open licence).
- **Profile export/import.** A zip holding:
  - the profile's SQLite made with `VACUUM INTO`, without its secrets;
  - its recordings;
  - a manifest with the format, app version, last migration, name and colour, the course keys and
    content versions used, and a sha256 per file.

  Import makes a new profile, migrated when opened; missing courses are listed to install.
- **Backups.**
  - Today `backup.ts` keeps a daily `VACUUM INTO` copy of each database for a week, and Time
    Machine covers the data root. A copy of a live WAL database can be torn; the daily copies are
    what a restore trusts.
  - Irreplaceable: `profiles/`, `server.sqlite`, and `secret.key` in app-data, outside the data
    root. Without the key, API keys in a restored backup cannot be read.
  - Can be fetched again: `library/` (the sources may have changed since).
  - Disposable: `models/` and `cache/`.

## Recommendation

1. Profile export/import first: the data that cannot be fetched again, the smallest piece, already
   an open item.
2. A course bundle second, together with the series manifest and `verify` of hashes. The bundle's
   manifest is that manifest, so no new entity is needed.
3. Keep the library unpacked. Do not serve from archives, compress media, build a dedup or backup
   store of our own, bundle across series, or put secrets in any export.

## Open questions for the owner

1. Sharing bundles with other people, or only between one's own machines?
2. `raw/` in a bundle by default?
3. Pruning the unreferenced media (only after checking what old passes and cards name)?
4. File extensions (`.sacourse`, `.saprofile`)?
5. Does a profile import replace a profile, or always make a new one?
6. A `backup` command that gathers the profile exports, `server.sqlite` and `secret.key`, or a
   documented list?
