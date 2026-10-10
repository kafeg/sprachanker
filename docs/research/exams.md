# Research — exams

Facts gathered on 10 October 2026 for the plan's item "Exams": what exists, where, and how it could be
imported. Nothing is imported yet; scratch parsers and saved pages were kept outside the repo.

## Leben in Deutschland / Einbürgerungstest (BAMF)

- **The catalogue.** "Gesamtfragenkatalog zum Test 'Leben in Deutschland' und zum
  'Einbürgerungstest'", one PDF of about 9 MB ("Stand: 07.05.2025", 191 pages, tagged), at
  `bamf.de/SharedDocs/Anlagen/DE/Integration/Einbuergerung/gesamtfragenkatalog-lebenindeutschland.pdf`.
  - Content: "Teil I — Allgemeine Fragen" (Aufgabe 1–300), then a "Teil II" per state (16 × 10). Each
    question has four options.
  - The test asks 33 questions, 3 of them about the learner's state. 17 right pass it for
    naturalisation; for the Leben in Deutschland certificate 15 are enough.
  - The 2025 edition differs from the 24.06.2024 one in exactly four questions: 14, 72 (Scholz →
    Merz), 73 and 248. These tell whether a dataset is current.
- **The PDF marks no answers.** `/AcroForm` has no fields, and all 1840 boxes are the same glyphs in
  the same colour.
- **The PDF parses cleanly.** `pdftotext -layout` gives exactly 300 + 160 questions with four options.
  To clean up:
  - page footers;
  - numbering that leaks into stems ("184. ");
  - five photo credits inside stems (kept as the picture's attribution);
  - options wrapped over several lines.

  One stem appears five times with different options, so keys are numbers, never text.
- **Pictures in the PDF.** 43 questions have pictures:
  - 19 have four picture options, left to right = "Bild 1" … "Bild 4": questions 21, 209 and 226,
    and each state's coat-of-arms question;
  - 24 have one picture: 55, 70, 130, 176, 181, 187, 216 and 235, and each state's map question
    (labelled 1–4).

  `pdftohtml -xml` gives their boxes. Most images have alpha masks, so a crop rendered with
  `pdftoppm` is simpler than `pdfimages`.
- **The right answers are in the BAMF online test centre** (`oet.bamf.de/ords/oetut/f?p=514`,
  Oracle APEX).
  - Each option row carries a hidden "richtige Antwort" / "falsche Antwort" marker in the HTML
    before any choice.
  - The question text itself is served only as a picture.
  - Its option order matches the PDF in all 460 questions. The wording differs in about 112 option
    lists, mostly the order of gender pairs.
- **Reading the test centre needs a browser.** A plain HTTP replay of the APEX form returned its
  error page. Headless Chromium worked at once: choose a state → question 1 → next; jump to 301 for
  the state's ten.
  - The whole catalogue is about 1,000 requests: 300 general, then 16 states × 10.
  - That is about 17 minutes at one request a second.
- **Datasets on GitHub.** None is clean enough to import alone:
  - **youssefeghaly/einbuergerungstest** (JSON, BAMF numbering, 2025, picture crops): no licence.
  - **TheMaestr-o/einbuergerungstest** (JSON, 2025, Russian too): its data is excluded from its
    MIT licence.
  - **leben-in-deutschland/leben-in-deutschland-app** (MIT including data): own numbering, typos,
    question 14 still the 2024 text.
  - **abdullahbutt/leben-in-deutschland-test**: CC BY-NC, edited texts, one wrong answer.
  - **@cemusta/burgertest** on npm (MIT): words glued by PDF extraction, three wrong answers.

  Answer keys that agree with the test centre on 460 of 460: youssefeghaly, TheMaestr-o, and
  adalbero's test-centre scrape of February 2026. They make a cross-check, not a source.
- **Websites.** einbuergerungstest-online.eu / lebenindeutschland.eu (one operator) show every
  answer in HTML, with no terms and no JSON. lebenindeutschland.org shows the MIT dataset.
- **Legal status (as stated, not advice).**
  - The catalogue is Anlage 1 of the EinbTestV regulation, and §5(1) UrhG exempts regulations from
    copyright. But the regulation text online is older than the 2025 PDF.
  - Neither the BAMF catalogue page nor the test centre states terms of use.
  - BAMF's Impressum claims its unmarked images. The test centre names IQB as the compiler of its
    content and pictures. Five photos credit the Bundestag and the Bundesregierung.
- **Importer sketch (provider `bamf-lid`).**
  1. Fetch the PDF and keep it raw with its hash; refuse a "Stand" date that is not known.
  2. Walk the test centre with headless Chromium about once a second, keeping its pages raw.
  3. Normalise the PDF into questions, options, state sections and cropped pictures (with their
     attribution).
  4. Join each answer by (section, number). Check that the right option's words agree in both
     sources, ignoring order, and fail on any mismatch.
  5. Keys like `general-014`, `BE-01`.
  6. `verify`: 460 questions, four options each, 43 with pictures, every answer resolved.

  Headless Chromium is not among the fixed technical choices yet (10).

## Goethe-Zertifikat A1–B1 (Goethe-Institut)

- **The online model tests are the source to start with.** Accessible ("barrierefrei") versions are
  at `bfu.goethe.de/a1_sd1/`, `bfu.goethe.de/a2_mod_2MX5/` and `bfu.goethe.de/b1_mod/`.
  - **Pages:** plain XHTML forms. One page per module (`hoeren.php`, `lesen.php`, `schreiben.php`,
    `sprechen.php`), one form per Teil, one `<fieldset>` per item.
  - **Items:** the question is the legend; the options are radio labels.
  - **Media:** each item has its own audio. Picture options have `alt` text. Reading texts shown as
    pictures link a `longdesc` page with the full text.
  - **Answers:** a plain GET of a module's solution page (`hoeren_l1.php`, …) returns the answers as
    text, with accepted alternatives ("4 / vier", "Sonntag / nächsten Sonntag").
  - **Cross-check:** the A1 model test is the same as telc's "Start Deutsch 1 Übungstest 1".
  - www.goethe.de answers scripts with 403; the bfu pages, the PDFs and the audio CDN
    (`goethemp4s.akamaized.net`) do not.
- **The PDFs.** Modellsatz and Übungssätze per level, with the Hören module as one MP4 of about
  17–40 minutes.
  - The answers are a marked answer sheet: the right box has a thicker border, a picture rather
    than text.
  - The PDFs are encrypted "copy: no"; `pdftotext` still extracts them.
- **Exam structure** (Durchführungsbestimmungen):

  | Level | Modules | Scoring and pass mark |
  |---|---|---|
  | A1 | Hören (3 Teile, 6/4/5 items, about 20 min); Lesen (3 Teile, 5/5/5, 25 min); Schreiben (a form worth 5 points and a message worth 10, 20 min); Sprechen (group, 15 min) | each part out of 15, × 1.66, out of 100; pass at 60 |
  | A2 | Lesen (4 Teile, 20 items, 30 min); Hören (4 Teile, 20 items, 30 min); Schreiben (2 Teile, 30 min); Sprechen (pairs, 15 min) | each part × 1.25 = 25 points; pass at 60 overall, with at least 45/75 written and 15/25 spoken |
  | B1 | Lesen (5 Teile, 65 min), Hören (4 Teile, about 40 min), Schreiben (60 min), Sprechen (15 min), taken as separate modules | 30 items in Lesen and Hören each, converted by a table; each module out of 100, passed at 60 |
- **Terms.** The PDFs state only "© Goethe-Institut e.V."; no licence or permission was found.
  Fetching on the learner's machine for their own practice and never committing it is the same
  footing as DW.
- **Mapping to our exercise types.** No new exercise type is needed:
  - a/b/c, richtig/falsch and ja/nein → `single_choice`;
  - matching with a shared "none fits" → `gap_choice`;
  - the A1 form → `gap_text`;
  - writing → `respond` with the exam's criteria;
  - speaking → `respond` (speech) or `speech_selfrate`. Paired and group speaking cannot be scored
    automatically.

  What is new is the exam layer: modules → Teile → items, time limits, how often a recording
  plays, points per item, the conversion and the pass rules.

## telc, DTZ, ÖSD

- **telc** (Deutsch A1, A2, B1, A2·B1, A1 für Zuwanderer): one ZIP per exam on telc.net, holding a
  PDF and one MP3 for the whole test.
  - The answer key is text ("Aufgabe 1 c", "+"/"–"), and the Hörtexte are included.
  - Its stated terms: free to download, "urheberrechtlich geschützt".
- **DTZ** (now g.a.s.t.): Übungssatz 1 and 2 as PDF + MP3, with a text key.
  - The result is a level, not a pass: Hören + Lesen 33–45 = B1, 20–32 = A2.
  - Its stated terms forbid any use g.a.s.t. has not allowed.
- **ÖSD** (ZA1, ZA2, ZB1): PDFs per subtest, MP3s per Hören task, and keys as tables with
  non-linear conversion tables. Its online trainer (`test-training-digital.osd.at`) was not
  explored.
- **Importing the PDF tests.** It needs a PDF reader among the fixed technical choices. A
  whole-test MP3 is either cut by its pauses or played whole, as in the real exam.

## Driving theory test (Germany)

- The official question catalogue for the theory test (Klasse B and others) is distributed by
  licensed partners of TÜV | DEKRA (learning apps, printed sheets). No free official copy was found.
- Not importable as things stand; looked at again only if a public source turns up.
