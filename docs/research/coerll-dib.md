# Research — COERLL Deutsch im Blick

Facts observed on `coerll.utexas.edu/dib/` (5 October 2026, chapter 1 only). Re-verify before building
the `coerll-dib` provider (stage 11).

## Licence

- The site footer shows the CC BY 4.0 badge linking `creativecommons.org/licenses/by/4.0/`; an older
  "CC BY-NC-ND 3.0" sentence is still in the HTML but commented out. The 2nd edition textbook (2017)
  is the CC BY 4.0 one (03); the 2013 edition MUST NOT be used.
- No `robots.txt` (404).

## Structure

- Ten chapters: `toc.php?k=<1..10>` (chapter table of contents), `voc.php?k=<n>&s=<section>`
  (vocabulary by section, German ↔ English, with audio), `wq.php?k=<n>&q=<n>` (web quests),
  `pho.php?k=<n>` (pronunciation), grammar links to the companion site Grimm Grammar
  (`coerll.utexas.edu/gg/`).
- Video interviews with native and non-native speakers per topic, with transcripts; chapter video zip
  `zip/vid_<nn>.zip` and an MP4 RSS feed `rss.php?k=<n>&a=mp4`.
- Exercises are **only in the textbook PDF** (`pdfs/k_<nn>.pdf`, full book on the UT repository and
  LibreTexts); there are no machine-readable interactive exercises on the site.

## Consequence for the schema

A DiB edition maps to vocabulary entries, videos with transcripts and HTML tabs; exercises would be our
own (enrichment or an authored course), not imported. This exercises the schema's language
independence (`en-de` edition, English learner strings) but not its exercise types.
