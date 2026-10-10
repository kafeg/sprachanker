# Research — exams

Facts gathered on 10 October 2026 for the plan's item "Exams": what exists, where, and what is still
to be checked before an importer is written. Nothing here is downloaded or imported yet.

## Leben in Deutschland / Einbürgerungstest (BAMF)

- The official catalogue is a PDF on bamf.de: "Gesamtfragenkatalog zum Test 'Leben in Deutschland' und
  zum 'Einbürgerungstest'", page dated 26.05.2025, linked from
  `bamf.de/SharedDocs/Anlagen/DE/Integration/Einbuergerung/gesamtfragenkatalog-lebenindeutschland.html`.
- 300 questions for every state and 160 by state (10 per state); the test asks 33 (3 of the state),
  passed with 17 right, 60 minutes (to be confirmed on BAMF's test page).
- Each question has four options; some show a picture (to be confirmed in the PDF).
- The PDF is one file of about 9 MB, marked accessible ("barrierefrei"), at
  `bamf.de/SharedDocs/Anlagen/DE/Integration/Einbuergerung/gesamtfragenkatalog-lebenindeutschland.pdf`.
  Reading it needs a PDF text extractor — not among the fixed technical choices (10) yet.
- The BAMF online test centre (`oet.bamf.de/ords/oetut/f?p=514`, an Oracle APEX application) shows
  the whole catalogue: a state chosen first, then question by question ("Aufgabe Nr.", a list to jump
  to one), one answer right, shown once one is marked. Pages are addressed by session, not by question:
  reading it means walking its form, question by question, for each state.
- Neither page states terms of use beyond "© BAMF" (the test centre: "Copyright © 2008"); the
  Impressum names the BAMF as the owner of unmarked images.
- The PDF ("Stand: 07.05.2025", 191 pages, tagged, made from Word) reads cleanly as text: "Teil I —
  Allgemeine Fragen" (Aufgabe 1–300), then a "Teil II" per state; each question its text and four
  options. **The right answers are not marked** (the options are unticked form boxes): they come only
  from the test centre. Some questions show a picture, and a few have four pictures as their options
  ("Bild 1" … "Bild 4"); the pictures are embedded images. A note says the wording may differ
  slightly from the questions asked in the test.

## Goethe-Zertifikat A1–B1 (Goethe-Institut)

- Free practice material per level on goethe.de (`…/prf/gzsd1/ueb.html` for A1 Start Deutsch 1, the
  same pattern for A2 and B1): a Modellsatz and Übungssätze as PDFs (about 5–6 MB each), the listening
  parts with audio, the answers in the PDF, and an accessible Modellsatz to work through online.
- **Open**: the terms (personal practice is the stated purpose); whether the online Modellsatz is
  structured HTML an importer can read (the PDFs are print layouts: listening, reading, writing and
  speaking parts mixed with instructions) — this decides whether any part is importable as exercises.
- telc and ÖSD publish model tests too: not looked at yet.

## Driving theory test (Germany)

- The official question catalogue for the theory test (Klasse B and others) is distributed by
  licensed partners of TÜV | DEKRA (learning apps, printed sheets); no free official copy was found.
  Not importable as things stand; looked at again only if a public source turns up.
