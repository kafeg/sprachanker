# Research — COERLL Deutsch im Blick

Facts observed on `coerll.utexas.edu/dib/` (5–6 October 2026). The provider imports the vocabulary (03).

## Licence

- The site footer shows the CC BY 4.0 badge linking `creativecommons.org/licenses/by/4.0/`; an older
  "CC BY-NC-ND 3.0" sentence is still in the HTML but commented out. The 2nd edition textbook (2017)
  is the CC BY 4.0 one (03); the 2013 edition MUST NOT be used.
- No `robots.txt` (404).

## Structure

- Ten chapters: `toc.php?k=<1..10>` (chapter table of contents; the chapter title is the banner's
  `alt="Kapitel N: …"`), `voc.php?k=<n>` (all vocabulary sections of a chapter, each after a comment
  `<!-- Vokabular: Kap N, section S: vs_SS -->`: a title of two spans `hi_*` (German, English), an
  `<audio>` whose `<source>` is on `media.la.utexas.edu/dib/audio/`, a table of German | English rows;
  94 sections in all), `wq.php?k=<n>&q=<n>` (web quests),
  `pho.php?k=<n>` (pronunciation), grammar links to the companion site Grimm Grammar
  (`coerll.utexas.edu/gg/`).
- Video interviews with native and non-native speakers per topic, with transcripts; chapter video zip
  `zip/vid_<nn>.zip` and an MP4 RSS feed `rss.php?k=<n>&a=mp4`. A transcript is `vidt.php?f=<id>`
  (parallel German and English); the video `media.la.utexas.edu/dib/video/<id>.mp4`.
- Headwords: "der Apfel (Äpfel)", "der Stift (die Stifte)", "die Butter (no plural)",
  "die Nudeln (plural only ?)", alternatives with " / ", phrases ("Notizen machen"), verbs bare.
- Exercises are **only in the textbook PDF** (`pdfs/k_<nn>.pdf`, full book on the UT repository and
  LibreTexts); there are no machine-readable interactive exercises on the site.
